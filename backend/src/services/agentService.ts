import OpenAI from "openai";
import type { GameState, InputFeedback, TokenUsage } from "../types/game.js";
import { readLlmConfig, type LlmConfig } from "../config/llmConfig.js";
import { AGENT_SYSTEM_PROMPT } from "../prompts/agentSystemPrompt.js";
import { WORLD_CONTEXT } from "../prompts/worldContext.js";
import { buildChapterContext, getSceneType, SCENE_TYPE_HINTS } from "../prompts/chapterScripts.js";
import { TOOL_DEFINITIONS } from "../tools/definitions.js";
import { executeToolCall, type ToolCallRecord } from "../tools/executor.js";
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
const MAX_RECENT_SUMMARIES = 5;
const MAX_EVIDENCE_ITEMS = 10;
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
    const userMessage = this.buildUserContext(state, playerAction);
    const toolsForTurn = this.buildToolsForTurn(playerAction);

    // System message 里合并 AGENT_SYSTEM_PROMPT + WORLD_CONTEXT，两者都是永不变的稳定前缀，
    // 合并后可作为连续字节命中 prompt cache。WORLD_CONTEXT 原本放在 user message 尾部，
    // 但 user message 里其它字段每轮变化，导致整个 user body 无法命中缓存。
    const systemContent = `${AGENT_SYSTEM_PROMPT}\n\n# 世界观设定（固定）\n\n${WORLD_CONTEXT}`;

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: systemContent },
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
        const cachedTokens: number =
          roundUsage.prompt_tokens_details?.cached_tokens ??
          roundUsage.prompt_cache_hit_tokens ??
          roundUsage.cached_tokens ??
          0;
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

    // LLM 偶尔会在叙事里描写 NPC，却漏掉 shift_npc_relation。
    // 这类遗漏不该中断整轮，自动补一个 0 delta 关系记录即可保持状态机可审计。
    this.repairMissingNpcRelationTools(allToolCalls, narrative, state);

    // Validate required tool calls（包含 submit_summary 与条件强制 shift_npc_relation）
    this.validateRequiredTools(allToolCalls, narrative);

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
    playerAction: { choiceId?: string; userInput?: string }
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

    const recentSummaries = state.historySummaries.slice(-MAX_RECENT_SUMMARIES);
    const compactChoices = state.currentChoices.slice(0, MAX_LAST_CHOICES).map((c) => ({
      id: c.id,
      title: c.title,
      impactHint: c.impactHint
    }));

    // 字段顺序按 "稳定→追加式→每轮变" 排列，使 JSON.stringify 后前缀尽可能稳定，
    // 命中 prompt cache。V8 保证非数字键按插入顺序序列化。
    return {
      // ─── 稳定前缀（游戏内/章节内不变，前几轮会缓存命中）─────────────────
      player: {
        name: state.player.name,
        role: state.player.role,
        talent: state.player.talent
      },
      chapterScript: buildChapterContext(Math.max(state.maxRevealedChapter ?? 1, progress.chapter)),

      // ─── 追加式中段（大多数轮次无变化或只在尾部追加）─────────────────────
      longAnchors: state.memory.longAnchors,
      midSummary: state.memory.midSummary,
      knownTruths: state.rebirth.knownTruths,

      // ─── 每轮变动尾部（放在最后，前缀失效只从这里开始）──────────────────
      stats: state.stats,
      flags: state.flags,
      verdictOutlook: state.verdictOutlook,
      rebirth: {
        loop: state.rebirth.loop,
        memoryRetention: state.rebirth.memoryRetention,
        fate: state.rebirth.fate
      },
      npcRelations: state.npcRelations,
      evidencePool: this.buildEvidenceContext(state.evidencePool),
      recentHistory: recentSummaries.length > 0
        ? recentSummaries.map((s, i) => `[轮${nextTurn - recentSummaries.length + i}] ${s}`).join("\n")
        : "(暂无历史)",
      lastChoices: compactChoices,
      playerAction: actionDesc,
      turn: nextTurn,
      progress,
      currentScene: this.buildCurrentSceneContext(progress)
    };
  }

  /**
   * 根据当前章节与场景号查出场景类型，构建给 LLM 的"主舞台"提示。
   * 强制 LLM 按预设节律切换法庭/调查/接触/个人场景，
   * 杜绝"散庭后…"万能转场导致的物理逻辑断裂。
   */
  private buildCurrentSceneContext(progress: { chapter: number; sceneInChapter: number }) {
    const sceneType = getSceneType(progress.chapter, progress.sceneInChapter);
    return {
      type: sceneType,
      hint: SCENE_TYPE_HINTS[sceneType]
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
        note: evidence.note
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

  private validateRequiredTools(toolCalls: ToolCallRecord[], narrative: string): void {
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

    // 条件强制：叙事提到任一 NPC 关键词 → 必须调用 shift_npc_relation 至少一次
    // 防止"叙事在动、状态机不动"的脱钩问题
    const NPC_KEYWORDS = [
      "周锐鸣", "检察官",
      "陈若澜", "审判长", "法官",
      "廖盈舟", "证人",
      "许岚", "调查员"
    ];
    const mentionedNpc = NPC_KEYWORDS.find((kw) => narrative.includes(kw));
    if (mentionedNpc && !calledNames.has("shift_npc_relation")) {
      throw new AppError(
        502,
        `AI 叙事中提到 NPC "${mentionedNpc}" 但未调用 shift_npc_relation，请重试。`,
        "LLM_MISSING_TOOL"
      );
    }
  }

  private repairMissingNpcRelationTools(
    toolCalls: ToolCallRecord[],
    narrative: string,
    state: GameState
  ): void {
    const npcMentionRules = [
      {
        npcId: "chiefProsecutor",
        keywords: ["周锐鸣", "检察官", "公诉人"]
      },
      {
        npcId: "presidingJudge",
        keywords: ["陈若澜", "审判长", "法官"]
      },
      {
        npcId: "keyWitness",
        keywords: ["廖盈舟", "关键证人", "证人"]
      },
      {
        npcId: "investigatorXu",
        keywords: ["许岚", "调查员", "老刑侦"]
      }
    ];

    const shiftedNpcIds = new Set(
      toolCalls
        .filter((tc) => tc.name === "shift_npc_relation")
        .map((tc) => (tc.args as { npcId?: string }).npcId)
        .filter((npcId): npcId is string => Boolean(npcId))
    );

    for (const rule of npcMentionRules) {
      const mentioned = rule.keywords.some((keyword) => narrative.includes(keyword));
      if (!mentioned || shiftedNpcIds.has(rule.npcId)) {
        continue;
      }

      const record = executeToolCall(
        "shift_npc_relation",
        JSON.stringify({
          npcId: rule.npcId,
          trustDelta: 0,
          reason: "自动补记：叙事提到该 NPC，但模型漏调关系工具"
        }),
        state
      );
      toolCalls.push(record);
      shiftedNpcIds.add(rule.npcId);
      console.warn(`[AgentService] 自动补记 NPC 关系工具：${rule.npcId}`);
    }
  }
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
    case "recall_memory":
      return {
        ok: true,
        scope: result.scope ?? null,
        matched: result.matched ?? 0,
        returned: result.returned ?? 0,
        results: result.results ?? []
      };
    default:
      return result;
  }
}
