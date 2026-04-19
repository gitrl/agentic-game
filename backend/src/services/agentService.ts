import OpenAI from "openai";
import type {
  GameState,
  ActionResult,
  InputFeedback,
  TokenUsage,
  Choice
} from "../types/game.js";
import { readLlmConfig, type LlmConfig } from "../config/llmConfig.js";
import { AGENT_SYSTEM_PROMPT } from "../prompts/agentSystemPrompt.js";
import { WORLD_CONTEXT } from "../prompts/worldContext.js";
import { buildChapterContext } from "../prompts/chapterScripts.js";
import { TOOL_DEFINITIONS } from "../tools/definitions.js";
import { executeToolCall, type ToolCallRecord } from "../tools/executor.js";
import { readMemoryFile } from "../utils/memoryFileWriter.js";
import { AppError } from "../core/errors.js";

type AgentTurnResult = {
  narrative: string;
  summary: string;
  toolCalls: ToolCallRecord[];
  tokenUsage: TokenUsage;
  inputFeedback: InputFeedback;
};

const MAX_TOOL_ROUNDS = 3;
const MAX_MEMORY_CONTEXT_CHARS = 1400;
const MAX_RECENT_SUMMARIES = 2;
const MAX_EVIDENCE_ITEMS = 4;
const MAX_LAST_CHOICES = 4;

export class AgentService {
  private readonly config: LlmConfig;
  private readonly client: OpenAI;

  constructor(config?: LlmConfig) {
    this.config = config ?? readLlmConfig();

    if (!this.config.apiKey) {
      throw new Error("AgentService requires OPENAI_API_KEY to be set");
    }

    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL,
      timeout: this.config.timeoutMs
    });
  }

  async processTurn(
    state: GameState,
    playerAction: { choiceId?: string; userInput?: string }
  ): Promise<AgentTurnResult> {
    // 解析/验证失败时自动重试 1 次
    try {
      return await this.executeAgentLoop(state, playerAction);
    } catch (error) {
      const code = error instanceof AppError ? error.code : "";
      const retryable = ["LLM_NO_NARRATIVE", "LLM_INVALID_NARRATIVE", "LLM_MISSING_TOOL"].includes(code);
      if (!retryable) throw error;
      console.warn(`[AgentService] ${code}，自动重试 1 次...`);
      return await this.executeAgentLoop(state, playerAction);
    }
  }

  private async executeAgentLoop(
    state: GameState,
    playerAction: { choiceId?: string; userInput?: string }
  ): Promise<AgentTurnResult> {
    const memoryContext = await readMemoryFile(state.sessionId);
    const userMessage = this.buildUserContext(state, playerAction, memoryContext);
    const toolsForTurn = this.buildToolsForTurn(playerAction);

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: AGENT_SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(userMessage, null, 2) }
    ];

    const allToolCalls: ToolCallRecord[] = [];
    let totalPromptTokens = 0;
    let totalCachedTokens = 0;
    let totalCompletionTokens = 0;
    let finalContent = "";

    // Tool-calling loop: keep rounds low to reduce latency
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let completion: OpenAI.ChatCompletion;
      try {
        completion = await (this.client.chat.completions.create as Function)({
          model: this.config.model,
          temperature: this.config.temperature,
          messages,
          tools: toolsForTurn,
          tool_choice: "auto",
          enable_thinking: this.config.thinkingEnabled,
          thinking_budget: this.config.thinkingBudget
        }) as OpenAI.ChatCompletion;
      } catch (error) {
        const msg = error instanceof Error ? error.message : "未知错误";
        throw new AppError(502, `AI 服务调用失败: ${msg}，请重试。`, "LLM_ERROR");
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const usage = completion.usage as any;
      const cachedTokens: number = usage?.prompt_tokens_details?.cached_tokens ?? 0;
      totalPromptTokens += (usage?.prompt_tokens ?? 0) - cachedTokens;
      totalCachedTokens += cachedTokens;
      totalCompletionTokens += usage?.completion_tokens ?? 0;

      const choice = completion.choices[0];
      if (!choice) {
        throw new AppError(502, "AI 服务返回为空，请重试。", "LLM_EMPTY_RESPONSE");
      }

      const assistantMsg = choice.message;

      // Collect any content
      if (assistantMsg.content) {
        finalContent += assistantMsg.content;
      }

      // If no tool calls, we're done
      if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
        break;
      }

      // Execute tool calls
      messages.push(assistantMsg);

      for (const toolCall of assistantMsg.tool_calls) {
        const record = executeToolCall(
          toolCall.function.name,
          toolCall.function.arguments,
          state
        );
        allToolCalls.push(record);

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(summarizeToolResult(record))
        });
      }

      // If finish_reason is "stop", we're done even if there were tool calls
      if (choice.finish_reason === "stop") {
        break;
      }
    }

    // Parse narrative from final content
    const { narrative, summary } = this.parseNarrativeResponse(finalContent);

    // Build input feedback from resolve_player_input tool call if present
    const inputFeedback = this.buildInputFeedback(playerAction, allToolCalls, state);

    // Validate required tool calls
    this.validateRequiredTools(allToolCalls);

    return {
      narrative,
      summary,
      toolCalls: allToolCalls,
      tokenUsage: {
        inputTokens: totalPromptTokens,
        cachedInputTokens: totalCachedTokens,
        outputTokens: totalCompletionTokens
      },
      inputFeedback
    };
  }

  private buildUserContext(
    state: GameState,
    playerAction: { choiceId?: string; userInput?: string },
    memoryContext: string
  ) {
    // Resolve player action description
    let actionDesc: { type: string; choiceId?: string; choiceTitle?: string; userInput?: string };

    if (playerAction.choiceId) {
      const matched = state.currentChoices.find((c) => c.id === playerAction.choiceId);
      actionDesc = {
        type: "choice",
        choiceId: playerAction.choiceId,
        choiceTitle: matched?.title ?? playerAction.choiceId
      };
    } else {
      actionDesc = {
        type: "natural_language",
        userInput: playerAction.userInput
      };
    }

    const nextTurn = state.turn + 1;
    const progress = this.deriveProgress(nextTurn);

    const recentSummaries = state.historySummaries
      .slice(-MAX_RECENT_SUMMARIES)
      .map((s) => s.slice(0, 90));
    const compactChoices = state.currentChoices.slice(0, MAX_LAST_CHOICES).map((c) => ({
      id: c.id,
      title: c.title,
      impactHint: c.impactHint
    }));

    return {
      turn: nextTurn,
      progress,
      player: {
        name: state.player.name,
        role: state.player.role,
        talent: state.player.talent
      },
      playerAction: actionDesc,
      stats: state.stats,
      flags: state.flags,
      evidencePool: this.buildEvidenceContext(state.evidencePool),
      npcRelations: state.npcRelations,
      verdictOutlook: state.verdictOutlook,
      rebirth: state.rebirth,
      recentHistory: recentSummaries.length > 0
        ? recentSummaries.map((s, i) => `[轮${nextTurn - recentSummaries.length + i}] ${s}`).join("\n")
        : "(暂无历史)",
      memoryContext: truncateContext(memoryContext, MAX_MEMORY_CONTEXT_CHARS) || "(暂无记忆记录)",
      lastChoices: compactChoices,
      worldContext: WORLD_CONTEXT,
      chapterScript: buildChapterContext(Math.max(state.maxRevealedChapter ?? 1, progress.chapter))
    };
  }

  private buildEvidenceContext(evidencePool: GameState["evidencePool"]) {
    const priority = new Map([
      ["challenged", 3],
      ["verified", 2],
      ["unverified", 1]
    ]);

    return evidencePool
      .map((e, index) => ({ evidence: e, index }))
      .sort((a, b) => {
        const p = (priority.get(b.evidence.status) ?? 0) - (priority.get(a.evidence.status) ?? 0);
        if (p !== 0) return p;
        if (a.evidence.reliability !== b.evidence.reliability) {
          return b.evidence.reliability - a.evidence.reliability;
        }
        return b.index - a.index;
      })
      .slice(0, MAX_EVIDENCE_ITEMS)
      .map(({ evidence }) => ({
        id: evidence.id,
        title: evidence.title,
        reliability: evidence.reliability,
        status: evidence.status,
        note: evidence.note.slice(0, 80)
      }));
  }

  private buildToolsForTurn(playerAction: { choiceId?: string; userInput?: string }) {
    if (playerAction.userInput?.trim()) {
      return TOOL_DEFINITIONS;
    }
    return TOOL_DEFINITIONS.filter(
      (tool) => !(tool.type === "function" && tool.function.name === "resolve_player_input")
    );
  }

  private deriveProgress(turn: number) {
    const SCENES_PER_CHAPTER = 10;
    const CHAPTER_TITLES = ["回溯醒来", "前案重演", "证链反噬", "终局对证", "改判黎明"];
    const chapter = Math.min(Math.floor(turn / SCENES_PER_CHAPTER) + 1, CHAPTER_TITLES.length);
    const chapterTitle = CHAPTER_TITLES[chapter - 1];
    const sceneInChapter = (turn % SCENES_PER_CHAPTER) + 1;
    return { chapter, chapterTitle, sceneInChapter, maxScenesInChapter: SCENES_PER_CHAPTER };
  }

  private parseNarrativeResponse(content: string): { narrative: string; summary: string } {
    if (!content.trim()) {
      throw new AppError(502, "AI 未返回叙事内容，请重试。", "LLM_NO_NARRATIVE");
    }

    // Try to parse as JSON
    try {
      const parsed = JSON.parse(content.trim()) as { narrative?: string; summary?: string };
      if (parsed.narrative && parsed.summary) {
        return {
          narrative: parsed.narrative.slice(0, 800),
          summary: parsed.summary.slice(0, 80)
        };
      }
    } catch {
      // Not JSON — try to extract from text
    }

    // Try to find JSON embedded in text
    const jsonMatch = content.match(/\{[\s\S]*"narrative"[\s\S]*"summary"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as { narrative?: string; summary?: string };
        if (parsed.narrative && parsed.summary) {
          return {
            narrative: parsed.narrative.slice(0, 800),
            summary: parsed.summary.slice(0, 80)
          };
        }
      } catch {
        // ignore
      }
    }

    throw new AppError(502, "AI 返回的叙事格式无效，请重试。", "LLM_INVALID_NARRATIVE");
  }

  private buildInputFeedback(
    playerAction: { choiceId?: string; userInput?: string },
    toolCalls: ToolCallRecord[],
    state: GameState
  ): InputFeedback {
    const resolveCall = toolCalls.find((tc) => tc.name === "resolve_player_input");

    if (playerAction.choiceId) {
      const matched = state.currentChoices.find((c) => c.id === playerAction.choiceId);
      return {
        mode: "choice_id",
        status: matched ? "resolved" : "fallback",
        rawInput: playerAction.choiceId,
        normalizedInput: playerAction.choiceId,
        resolvedChoiceId: playerAction.choiceId,
        resolvedChoiceTitle: matched?.title ?? playerAction.choiceId,
        confidence: matched ? 1.0 : 0.5,
        fallbackUsed: !matched,
        reason: matched ? "选项ID直接匹配" : "选项ID未找到，AI自行解读"
      };
    }

    // Natural language input
    const rawInput = playerAction.userInput ?? "";
    if (resolveCall) {
      const args = resolveCall.args as { resolvedChoiceId?: string; interpretation?: string; confidence?: number };
      return {
        mode: "user_input",
        status: "resolved",
        rawInput,
        normalizedInput: rawInput.trim(),
        resolvedChoiceId: args.resolvedChoiceId ?? "ai_interpreted",
        resolvedChoiceTitle: args.interpretation ?? "AI解读",
        confidence: args.confidence ?? 0.7,
        fallbackUsed: false,
        reason: `AI 理解: ${args.interpretation ?? rawInput}`
      };
    }

    return {
      mode: "user_input",
      status: "resolved",
      rawInput,
      normalizedInput: rawInput.trim(),
      resolvedChoiceId: "ai_interpreted",
      resolvedChoiceTitle: "AI 自由解读",
      confidence: 0.6,
      fallbackUsed: false,
      reason: "AI 直接根据输入生成响应"
    };
  }

  private validateRequiredTools(toolCalls: ToolCallRecord[]): void {
    const calledNames = new Set(toolCalls.map((tc) => tc.name));

    if (!calledNames.has("update_stats")) {
      throw new AppError(502, "AI 未调用 update_stats 工具，请重试。", "LLM_MISSING_TOOL");
    }
    if (!calledNames.has("generate_choices")) {
      throw new AppError(502, "AI 未调用 generate_choices 工具，请重试。", "LLM_MISSING_TOOL");
    }
  }
}

/** 截断文本到指定字符数上限，保留开头和结尾 */
function truncateContext(text: string, maxChars: number): string {
  if (!text || text.length <= maxChars) {
    return text;
  }
  const headSize = Math.floor(maxChars * 0.7);
  const tailSize = maxChars - headSize - 20;
  return text.slice(0, headSize) + "\n\n...(中间内容已省略)...\n\n" + text.slice(-tailSize);
}

function summarizeToolResult(record: ToolCallRecord): unknown {
  const result = record.result as Record<string, unknown>;

  switch (record.name) {
    case "update_stats":
      return { ok: true, applied: result.applied ?? null };
    case "generate_choices": {
      const choices = Array.isArray(result.choices) ? result.choices as Array<{ id?: string }> : [];
      return { ok: true, stored: result.stored ?? choices.length, choiceIds: choices.map((c) => c.id ?? "") };
    }
    case "resolve_player_input":
      return { ok: true, resolvedChoiceId: result.resolvedChoiceId ?? null, confidence: result.confidence ?? null };
    case "update_evidence":
      return { ok: true, action: result.action ?? null, evidenceId: (result.evidence as { id?: string } | undefined)?.id ?? null };
    case "shift_npc_relation":
      return { ok: true, npcId: result.npcId ?? null, trustAfter: result.trustAfter ?? null };
    case "write_memory_anchor":
      return { ok: result.stored ?? false, total: result.total ?? null };
    default:
      return result;
  }
}
