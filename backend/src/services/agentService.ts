import OpenAI from "openai";
import type { GameState, InputFeedback, TokenUsage } from "../types/game.js";
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

export type AgentStreamOptions = {
  onNarrativeDelta?: (text: string) => void;
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
    playerAction: { choiceId?: string; userInput?: string },
    options?: AgentStreamOptions
  ): Promise<AgentTurnResult> {
    // 解析/验证失败时自动重试 1 次（仅在尚未流式输出任何内容时才安全重试）
    let streamed = false;
    const wrappedOptions: AgentStreamOptions = {
      onNarrativeDelta: (text: string) => {
        streamed = true;
        options?.onNarrativeDelta?.(text);
      }
    };
    try {
      return await this.executeAgentLoop(state, playerAction, wrappedOptions);
    } catch (error) {
      const code = error instanceof AppError ? error.code : "";
      const retryable = !streamed && ["LLM_NO_NARRATIVE", "LLM_MISSING_TOOL"].includes(code);
      if (!retryable) throw error;
      console.warn(`[AgentService] ${code}，自动重试 1 次...`);
      return await this.executeAgentLoop(state, playerAction, options);
    }
  }

  private async executeAgentLoop(
    state: GameState,
    playerAction: { choiceId?: string; userInput?: string },
    options?: AgentStreamOptions
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

    // Tool-calling loop (流式): 每轮开 stream:true，tool_calls 增量累积，content 增量转发
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let stream: AsyncIterable<any>;
      try {
        stream = (await (this.client.chat.completions.create as Function)({
          model: this.config.model,
          temperature: this.config.temperature,
          messages,
          tools: toolsForTurn,
          tool_choice: "auto",
          enable_thinking: this.config.thinkingEnabled,
          thinking_budget: this.config.thinkingBudget,
          stream: true,
          stream_options: { include_usage: true }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        })) as AsyncIterable<any>;
      } catch (error) {
        const msg = error instanceof Error ? error.message : "未知错误";
        throw new AppError(502, `AI 服务调用失败: ${msg}，请重试。`, "LLM_ERROR");
      }

      // 本轮累积
      type ToolCallAcc = { id?: string; name?: string; args: string };
      const toolCallsAcc = new Map<number, ToolCallAcc>();
      let roundContent = "";
      let finishReason: string | null = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let roundUsage: any = null;

      try {
        for await (const chunk of stream) {
          const choice = chunk.choices?.[0];
          if (choice) {
            const delta = choice.delta;
            if (delta?.content) {
              roundContent += delta.content;
              // 直接流式转发 content delta 给前端（哪怕本轮有 tool_calls 也一起发——
              // qwen 常会在同一轮内并行产出 narrative 文本和 tool_calls，不能过滤掉）
              options?.onNarrativeDelta?.(delta.content);
            }
            if (delta?.tool_calls && Array.isArray(delta.tool_calls)) {
              for (const tc of delta.tool_calls) {
                const idx: number = tc.index ?? 0;
                let acc = toolCallsAcc.get(idx);
                if (!acc) {
                  acc = { id: tc.id, name: tc.function?.name, args: "" };
                  toolCallsAcc.set(idx, acc);
                } else {
                  if (tc.id) acc.id = tc.id;
                  if (tc.function?.name) acc.name = tc.function.name;
                }
                if (tc.function?.arguments) acc.args += tc.function.arguments;
              }
            }
            if (choice.finish_reason) {
              finishReason = choice.finish_reason;
            }
          }
          if (chunk.usage) {
            roundUsage = chunk.usage;
          }
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : "未知错误";
        throw new AppError(502, `AI 流式响应中断: ${msg}，请重试。`, "LLM_ERROR");
      }

      if (roundUsage) {
        const cachedTokens: number = roundUsage.prompt_tokens_details?.cached_tokens ?? 0;
        totalPromptTokens += (roundUsage.prompt_tokens ?? 0) - cachedTokens;
        totalCachedTokens += cachedTokens;
        totalCompletionTokens += roundUsage.completion_tokens ?? 0;
      }

      // 如果是纯叙事轮（无工具调用），content 已全部转发，本轮结束
      if (toolCallsAcc.size === 0) {
        finalContent += roundContent;
        break;
      }

      // 构造含 tool_calls 的 assistant message 写回对话历史
      const assistantToolCalls = Array.from(toolCallsAcc.entries())
        .sort(([a], [b]) => a - b)
        .map(([, tc]) => ({
          id: tc.id ?? "",
          type: "function" as const,
          function: {
            name: tc.name ?? "",
            arguments: tc.args || "{}"
          }
        }));

      messages.push({
        role: "assistant",
        content: roundContent || null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tool_calls: assistantToolCalls as any
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      // 执行工具调用
      for (const tc of assistantToolCalls) {
        const record = executeToolCall(tc.function.name, tc.function.arguments, state);
        allToolCalls.push(record);
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(summarizeToolResult(record))
        });
      }

      // 罕见情况：同一轮 finish_reason=stop 且也有 tool_calls，视为结束
      if (finishReason === "stop") {
        finalContent += roundContent;
        break;
      }
    }

    // narrative 现在是纯文本（非 JSON），summary 走 submit_summary 工具
    const narrative = finalContent.trim();
    if (!narrative) {
      throw new AppError(502, "AI 未返回叙事内容，请重试。", "LLM_NO_NARRATIVE");
    }

    // Build input feedback from resolve_player_input tool call if present
    const inputFeedback = this.buildInputFeedback(playerAction, allToolCalls, state);

    // Validate required tool calls（包含 submit_summary）
    this.validateRequiredTools(allToolCalls);

    // 从 submit_summary 工具调用中取出 summary
    const summary = this.extractSummary(allToolCalls) ?? narrative.slice(0, 40);

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

  private extractSummary(toolCalls: ToolCallRecord[]): string | null {
    const rec = toolCalls.find((tc) => tc.name === "submit_summary");
    if (!rec) return null;
    const res = rec.result as { summary?: string };
    return res?.summary?.trim() || null;
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
    if (!calledNames.has("submit_summary")) {
      throw new AppError(502, "AI 未调用 submit_summary 工具，请重试。", "LLM_MISSING_TOOL");
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
    case "submit_summary":
      return { ok: result.stored ?? false };
    case "write_memory_anchor":
      return { ok: result.stored ?? false, total: result.total ?? null };
    default:
      return result;
  }
}
