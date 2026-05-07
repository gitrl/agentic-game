import OpenAI from "openai";
import type { GameState } from "../types/game.js";
import { readLlmConfig, type LlmConfig } from "../config/llmConfig.js";
import { MEMORY_AGENT_SYSTEM_PROMPT } from "../prompts/memoryAgentPrompt.js";

/**
 * Memory Agent：把连续 N 轮的原始素材压缩为一段阶段摘要。
 * 用便宜模型（默认 qwen-turbo）、非流式、异步触发，不阻塞主流程。
 */
export class MemoryAgentService {
  private readonly config: LlmConfig;
  private readonly client: OpenAI;
  /** 按 sessionId 串行化压缩，避免同一 session 的并发压缩互相覆盖 */
  private readonly inflight = new Map<string, Promise<void>>();

  constructor(config?: LlmConfig) {
    this.config = config ?? readLlmConfig();
    if (!this.config.apiKey) {
      throw new Error("MemoryAgentService requires OPENAI_API_KEY to be set");
    }
    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL,
      timeout: this.config.memoryTimeoutMs
    });
  }

  /**
   * 触发异步压缩。如果该 sessionId 已有压缩在跑，会 await 排队后执行。
   * 不抛异常——压缩失败只 warn，不影响主流程。
   */
  async compressPhase(
    state: GameState,
    fromTurn: number,
    toTurn: number
  ): Promise<void> {
    const prev = this.inflight.get(state.sessionId);
    const task = (async () => {
      if (prev) {
        try { await prev; } catch { /* 前任失败不影响本次 */ }
      }
      await this.runCompression(state, fromTurn, toTurn);
    })();
    this.inflight.set(state.sessionId, task);
    try {
      await task;
    } finally {
      if (this.inflight.get(state.sessionId) === task) {
        this.inflight.delete(state.sessionId);
      }
    }
  }

  private async runCompression(
    state: GameState,
    fromTurn: number,
    toTurn: number
  ): Promise<void> {
    const materials = this.collectMaterials(state, fromTurn, toTurn);
    if (materials.length === 0) {
      console.warn(`[MemoryAgent] 轮 ${fromTurn}-${toTurn} 无素材可压缩，跳过`);
      return;
    }

    const userContent = [
      `# 压缩范围：轮 ${fromTurn} - 轮 ${toTurn}`,
      "",
      "# 原始素材",
      "",
      ...materials.map((m) => `## 轮 ${m.turn}\n玩家行动：${m.playerAction}\n叙事摘要：${m.summary}${m.events.length ? `\n事件：${m.events.join("，")}` : ""}`)
    ].join("\n");

    let compressed: string;
    try {
      const response = await this.client.chat.completions.create({
        model: this.config.memoryModel,
        temperature: 0.3,
        max_tokens: 400,
        stream: false,
        messages: [
          { role: "system", content: MEMORY_AGENT_SYSTEM_PROMPT },
          { role: "user", content: userContent }
        ]
      });
      compressed = response.choices[0]?.message?.content?.trim() ?? "";
    } catch (err) {
      const msg = err instanceof Error ? err.message : "未知错误";
      console.warn(`[MemoryAgent] 压缩失败（轮 ${fromTurn}-${toTurn}）：${msg}`);
      return;
    }

    if (!compressed) {
      console.warn(`[MemoryAgent] 压缩返回空内容（轮 ${fromTurn}-${toTurn}），跳过`);
      return;
    }

    // 截断到 180 字作为硬安全上限（超出视为模型跑偏）
    const finalSummary = compressed.slice(0, 180);
    const labeled = `[轮${fromTurn}-${toTurn}] ${finalSummary}`;

    state.memory.midSummary.push(labeled);
    console.log(`[MemoryAgent] 阶段摘要写入（轮 ${fromTurn}-${toTurn}，${finalSummary.length} 字）`);
  }

  private collectMaterials(state: GameState, fromTurn: number, toTurn: number) {
    return state.replay
      .filter((r) => r.turn >= fromTurn && r.turn <= toTurn)
      .map((r) => ({
        turn: r.turn,
        playerAction: r.playerAction,
        summary: r.narrativeSummary,
        events: r.events
      }));
  }
}
