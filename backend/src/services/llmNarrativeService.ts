import OpenAI from "openai";
import type { ActionResult, TokenUsage } from "../types/game.js";
import { readLlmConfig, type LlmConfig } from "../config/llmConfig.js";
import { NARRATIVE_SYSTEM_PROMPT } from "../prompts/narrativeSystemPrompt.js";

type EnhanceInput = {
  turnResult: ActionResult;
  sessionId: string;
};

type EnhanceOutput = {
  narrative: string;
  summary: string;
  tokenUsage?: TokenUsage;
};

type LlmJsonResponse = {
  narrative?: string;
  summary?: string;
};

export class LlmNarrativeService {
  private readonly config: LlmConfig;
  private readonly client: OpenAI | null;
  private consecutiveFailures = 0;
  private disabledUntilEpochMs = 0;
  private lastWarningEpochMs = 0;

  constructor(config?: LlmConfig) {
    this.config = config ?? readLlmConfig();

    if (this.config.enabled && this.config.apiKey) {
      this.client = new OpenAI({
        apiKey: this.config.apiKey,
        baseURL: this.config.baseURL,
        timeout: this.config.timeoutMs
      });
    } else {
      this.client = null;
    }
  }

  isEnabled(): boolean {
    if (!this.client) {
      return false;
    }
    return Date.now() >= this.disabledUntilEpochMs;
  }

  async enhanceTurn(input: EnhanceInput): Promise<EnhanceOutput | null> {
    if (!this.isEnabled()) {
      return null;
    }

    const { turnResult, sessionId } = input;

    const userPayload = {
      session_id: sessionId,
      turn: turnResult.turn,
      progress: turnResult.progress,
      base_narrative: turnResult.narrative,
      base_summary: turnResult.summary,
      stat_changes: turnResult.statChanges,
      events: turnResult.events,
      verdict_outlook: turnResult.verdictOutlook,
      rebirth: turnResult.rebirth
    };

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => {
      controller.abort();
    }, this.config.softTimeoutMs);

    let completion: Awaited<ReturnType<OpenAI["chat"]["completions"]["create"]>>;
    try {
      completion = await this.client!.chat.completions.create(
        {
          model: this.config.model,
          temperature: this.config.temperature,
          messages: [
            { role: "system", content: NARRATIVE_SYSTEM_PROMPT },
            { role: "user", content: JSON.stringify(userPayload, null, 2) }
          ],
          response_format: { type: "json_object" }
        },
        { signal: controller.signal }
      );
    } catch (error) {
      this.markFailure(error);
      return null;
    } finally {
      clearTimeout(timeoutHandle);
    }

    const content = completion.choices?.[0]?.message?.content?.trim();
    if (!content) {
      this.markFailure(new Error("LLM returned empty content."));
      return null;
    }

    const parsed = safeParse(content);
    if (!parsed?.narrative || !parsed?.summary) {
      this.markFailure(new Error("LLM JSON payload missing narrative/summary."));
      return null;
    }

    const narrative = parsed.narrative.trim().slice(0, 1200);
    const summary = parsed.summary.trim().slice(0, 220);

    if (!narrative || !summary) {
      this.markFailure(new Error("LLM narrative or summary is blank."));
      return null;
    }

    const promptTokens = completion.usage?.prompt_tokens ?? 0;
    const completionTokens = completion.usage?.completion_tokens ?? 0;

    this.markSuccess();
    return {
      narrative,
      summary,
      tokenUsage: {
        inputTokens: promptTokens,
        cachedInputTokens: 0,
        outputTokens: completionTokens
      }
    };
  }

  private markSuccess(): void {
    this.consecutiveFailures = 0;
    this.disabledUntilEpochMs = 0;
  }

  private markFailure(error: unknown): void {
    this.consecutiveFailures += 1;
    const now = Date.now();

    if (this.consecutiveFailures >= this.config.maxConsecutiveFailures) {
      this.disabledUntilEpochMs = now + this.config.cooldownMs;
    }

    if (now - this.lastWarningEpochMs < 30_000) {
      return;
    }
    this.lastWarningEpochMs = now;

    const message = this.describeError(error);
    const cooling =
      this.disabledUntilEpochMs > now
        ? `; cooling down ${Math.ceil((this.disabledUntilEpochMs - now) / 1000)}s`
        : "";

    // eslint-disable-next-line no-console
    console.warn(
      `[LLM] enhancement skipped: ${message}; failures=${this.consecutiveFailures}/${this.config.maxConsecutiveFailures}${cooling}`
    );
  }

  private describeError(error: unknown): string {
    if (error instanceof Error) {
      const name = error.name || "Error";
      const message = error.message || "unknown";
      return `${name}: ${message}`;
    }
    return "Unknown LLM error";
  }
}

const safeParse = (value: string): LlmJsonResponse | null => {
  try {
    return JSON.parse(value) as LlmJsonResponse;
  } catch {
    return null;
  }
};
