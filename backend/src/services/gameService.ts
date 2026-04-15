import {
  createEmptyState,
  initializeGame,
  evaluateVerdictOutlook,
  maybeTriggerRebirth,
  checkGameOver,
  updateMemoryBundles,
  deriveProgress,
  snapshotState,
  normalizeChanges
} from "../engine/gameEngine.js";
import { AppError } from "../core/errors.js";
import type { GameRepository } from "../repositories/gameRepository.js";
import { AgentService } from "./agentService.js";
import type {
  ActionPayload,
  ActionResult,
  InputFeedback,
  InitPayload,
  SaveSnapshot,
  TokenUsage
} from "../types/game.js";
import { writeMemoryFile } from "../utils/memoryFileWriter.js";

export class GameService {
  private readonly agentService: AgentService;

  constructor(
    private readonly repository: GameRepository
  ) {
    this.agentService = new AgentService();
  }

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
    writeMemoryFile(state);
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
    if (state.gameOver) {
      throw new AppError(400, "游戏已结束，无法继续行动。", "GAME_OVER");
    }
    if (!payload.choiceId?.trim() && !payload.userInput?.trim()) {
      throw new AppError(400, "choiceId or userInput is required", "ACTION_INPUT_REQUIRED");
    }

    // Snapshot state before LLM changes
    const before = snapshotState(state);

    // Increment turn and progress
    state.turn += 1;
    state.progress = deriveProgress(state.turn);

    // Write memory file BEFORE LLM call so it can read the latest context
    await writeMemoryFile(state);

    // Call the Agent (LLM with tools) — this is the core agentic flow
    // LLM decides: narrative, stat changes, choices, evidence, NPC, memory
    const agentResult = await this.agentService.processTurn(state, {
      choiceId: payload.choiceId,
      userInput: payload.userInput
    });

    // Post-processing: code-enforced game rules
    const events: string[] = [];
    const statChanges: string[] = [];

    // Evaluate verdict outlook based on updated stats
    state.verdictOutlook = evaluateVerdictOutlook(state);

    // Check rebirth trigger (code formula)
    maybeTriggerRebirth(state, events, statChanges);

    // Re-evaluate after potential rebirth
    state.verdictOutlook = evaluateVerdictOutlook(state);

    // Check game over (code formula)
    checkGameOver(state, events);

    // Update narrative state
    state.currentNarrative = agentResult.narrative;
    state.historySummaries.push(agentResult.summary);
    state.historySummaries = state.historySummaries.slice(-20);

    // Update memory bundles
    updateMemoryBundles(state, agentResult.narrative, agentResult.summary);

    // Build normalized stat changes for replay
    const normalizedChanges = normalizeChanges(before, state, statChanges);

    // Determine player action title for replay
    const playerActionTitle = payload.choiceId
      ? (before as unknown as { stats: unknown })
        ? agentResult.inputFeedback.resolvedChoiceTitle
        : payload.choiceId
      : (payload.userInput ?? "自然语言输入");

    // Record replay entry
    state.replay.push({
      turn: state.turn,
      playerAction: playerActionTitle,
      narrativeSummary: agentResult.summary,
      statChanges: normalizedChanges,
      events,
      tokenUsage: agentResult.tokenUsage,
      timestamp: new Date().toISOString()
    });

    // Persist state and memory
    await this.repository.upsertSession(state);
    writeMemoryFile(state);

    // Build result
    const result: ActionResult = {
      narrative: agentResult.narrative,
      summary: agentResult.summary,
      choices: state.currentChoices,
      progress: state.progress,
      statChanges: normalizedChanges,
      events,
      tokenUsage: agentResult.tokenUsage,
      turn: state.turn,
      stats: state.stats,
      flags: state.flags,
      evidencePool: state.evidencePool,
      npcRelations: state.npcRelations,
      verdictOutlook: state.verdictOutlook,
      rebirth: state.rebirth,
      gameOver: state.gameOver,
      endingType: state.endingType,
      endingNarrative: state.endingNarrative
    };

    return {
      result,
      inputFeedback: agentResult.inputFeedback
    };
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
}

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
