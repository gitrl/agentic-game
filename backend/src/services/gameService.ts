import { createEmptyState, initializeGame, processAction } from "../engine/gameEngine.js";
import { AppError } from "../core/errors.js";
import type { GameRepository } from "../repositories/gameRepository.js";
import { LlmNarrativeService } from "./llmNarrativeService.js";
import { resolveTurnInput } from "./inputResolver.js";
import type {
  ActionPayload,
  ActionResult,
  InputFeedback,
  InitPayload,
  SaveSnapshot,
  TokenUsage
} from "../types/game.js";

const RECOVERY_CHOICES = [
  {
    id: "examine_evidence",
    title: "复核关键证据",
    description: "重新校准证据链，恢复流程稳定",
    impactHint: "稳定推进"
  },
  {
    id: "timeline_rebuild",
    title: "重构案发时间线",
    description: "从客观记录重建关键节点",
    impactHint: "修复偏移"
  },
  {
    id: "file_motion",
    title: "提出程序异议",
    description: "用程序工具恢复庭审秩序",
    impactHint: "控制风险"
  }
];

export class GameService {
  constructor(
    private readonly repository: GameRepository,
    private readonly llmNarrativeService = new LlmNarrativeService()
  ) {}

  async createSession(): Promise<{ sessionId: string }> {
    const sessionId = await this.repository.createSessionId();
    const state = createEmptyState(sessionId);
    await this.repository.upsertSession(state);
    return { sessionId };
  }

  async initializeSession(sessionId: string, payload: InitPayload) {
    const state = await this.requireSession(sessionId);
    const result = initializeGame(state, payload);
    await this.repository.upsertSession(state);
    return {
      sessionId: state.sessionId,
      ...result
    };
  }

  async processTurn(
    sessionId: string,
    payload: ActionPayload
  ): Promise<{ result: ActionResult; inputFeedback: InputFeedback }> {
    const state = await this.requireSession(sessionId);

    if (!state.initialized) {
      throw new AppError(400, "Session is not initialized", "SESSION_NOT_INITIALIZED");
    }
    if (!payload.choiceId?.trim() && !payload.userInput?.trim()) {
      throw new AppError(400, "choiceId or userInput is required", "ACTION_INPUT_REQUIRED");
    }

    const { resolvedChoiceId, feedback } = resolveTurnInput({
      choiceId: payload.choiceId,
      userInput: payload.userInput,
      currentChoices: state.currentChoices
    });

    try {
      const result = processAction(state, resolvedChoiceId);
      await this.applyLlmEnhancementIfEnabled(state, result);
      await this.repository.upsertSession(state);
      return {
        result,
        inputFeedback: feedback
      };
    } catch (error) {
      const recovered = this.buildRecoveryResult(state, resolvedChoiceId, error);
      await this.repository.upsertSession(state);
      return {
        result: recovered,
        inputFeedback: {
          ...feedback,
          status: "fallback",
          fallbackUsed: true,
          reason: `${feedback.reason} 引擎异常，已自动切换保底流程。`
        }
      };
    }
  }

  async getState(sessionId: string) {
    return this.requireSession(sessionId);
  }

  async createSave(sessionId: string): Promise<SaveSnapshot> {
    const state = await this.requireSession(sessionId);
    return this.repository.createSave(sessionId, state);
  }

  async loadSave(saveId: string): Promise<{ sessionId: string; fromSaveId: string; createdAt: string }> {
    if (!saveId.trim()) {
      throw new AppError(400, "saveId is required", "SAVE_ID_REQUIRED");
    }

    const snapshot = await this.repository.getSave(saveId);
    if (!snapshot) {
      throw new AppError(404, "Save not found", "SAVE_NOT_FOUND");
    }

    const newSessionId = await this.repository.createSessionId();
    const clonedState = JSON.parse(JSON.stringify(snapshot.state));
    clonedState.sessionId = newSessionId;
    await this.repository.upsertSession(clonedState);

    return {
      sessionId: newSessionId,
      fromSaveId: saveId,
      createdAt: snapshot.createdAt
    };
  }

  async getReplay(sessionId: string) {
    const state = await this.requireSession(sessionId);
    return {
      sessionId: state.sessionId,
      totalTurns: state.turn,
      replay: state.replay,
      tokenSummary: summarizeTokenUsage(state.replay.map((item) => item.tokenUsage))
    };
  }

  private async requireSession(sessionId: string) {
    const state = await this.repository.getSession(sessionId);
    if (!state) {
      throw new AppError(404, "Session not found", "SESSION_NOT_FOUND");
    }
    return state;
  }

  private buildRecoveryResult(
    state: Awaited<ReturnType<GameService["requireSession"]>>,
    choiceId: string,
    error: unknown
  ): ActionResult {
    const safeMessage = error instanceof Error ? error.message : "未知异常";

    const narrative = [
      "系统检测到本轮处理异常，已切换到保底流程以保证案件继续推进。",
      `异常摘要：${safeMessage}。`,
      `本轮选择“${choiceId}”已被记录，你可以继续从保底选项中推进剧情。`
    ].join("");

    const summary = "本轮触发异常保护，流程已安全恢复。";
    const statChanges = ["无状态变更（异常保护）"];
    const events = ["engine_recovery"];

    state.currentNarrative = narrative;
    state.currentChoices = state.currentChoices.length > 0 ? state.currentChoices : RECOVERY_CHOICES;
    state.historySummaries.push(summary);
    state.historySummaries = state.historySummaries.slice(-20);
    state.memory.shortWindow.push(narrative);
    state.memory.shortWindow = state.memory.shortWindow.slice(-6);

    const tokenUsage: TokenUsage = {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0
    };

    state.replay.push({
      turn: state.turn,
      playerAction: choiceId,
      narrativeSummary: summary,
      statChanges,
      events,
      tokenUsage,
      timestamp: new Date().toISOString()
    });

    return {
      narrative,
      summary,
      choices: state.currentChoices,
      progress: state.progress,
      statChanges,
      events,
      tokenUsage,
      turn: state.turn,
      stats: state.stats,
      flags: state.flags,
      evidencePool: state.evidencePool,
      npcRelations: state.npcRelations,
      verdictOutlook: state.verdictOutlook,
      rebirth: state.rebirth
    };
  }

  private async applyLlmEnhancementIfEnabled(
    state: Awaited<ReturnType<GameService["requireSession"]>>,
    result: ActionResult
  ): Promise<void> {
    if (!this.llmNarrativeService.isEnabled()) {
      return;
    }

    const enhanced = await this.llmNarrativeService.enhanceTurn({
      turnResult: result,
      sessionId: state.sessionId
    });

    if (!enhanced) {
      return;
    }

    result.narrative = enhanced.narrative;
    result.summary = enhanced.summary;
    if (enhanced.tokenUsage) {
      result.tokenUsage = enhanced.tokenUsage;
    }

    state.currentNarrative = enhanced.narrative;
    replaceLast(state.historySummaries, enhanced.summary);
    replaceLast(state.memory.shortWindow, enhanced.narrative);
    if (state.turn % 5 === 0) {
      replaceLast(state.memory.midSummary, enhanced.summary);
    }

    const replayTail = state.replay[state.replay.length - 1];
    if (replayTail) {
      replayTail.narrativeSummary = enhanced.summary;
      if (enhanced.tokenUsage) {
        replayTail.tokenUsage = enhanced.tokenUsage;
      }
    }
  }
}

const replaceLast = <T>(list: T[], value: T): void => {
  if (list.length === 0) {
    return;
  }
  list[list.length - 1] = value;
};

const summarizeTokenUsage = (rows: TokenUsage[]) => {
  const totals = rows.reduce(
    (acc, row) => {
      acc.inputTokens += row.inputTokens;
      acc.cachedInputTokens += row.cachedInputTokens;
      acc.outputTokens += row.outputTokens;
      return acc;
    },
    {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0
    }
  );

  const totalActions = rows.length;
  const totalCombined = totals.inputTokens + totals.cachedInputTokens + totals.outputTokens;

  return {
    totalActions,
    ...totals,
    avgPerAction: totalActions === 0 ? 0 : Number((totalCombined / totalActions).toFixed(2))
  };
};
