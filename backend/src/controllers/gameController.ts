import type { NextFunction, Request, Response } from "express";
import { AppError } from "../core/errors.js";
import type { GameService } from "../services/gameService.js";
import { delay, sendSseEvent, setupSse, splitNarrative } from "../utils/sse.js";

export const createGameController = (gameService: GameService) => {
  const health = (_req: Request, res: Response) => {
    res.json({ ok: true });
  };

  const createSession = async (_req: Request, res: Response) => {
    const session = await gameService.createSession();
    res.status(201).json(session);
  };

  const initSession = async (req: Request, res: Response) => {
    const sessionId = req.params.id;
    const payload = req.body as {
      name: string;
      role: string;
      talent: string;
      starterItem: string;
    };
    const result = await gameService.initializeSession(sessionId, payload);
    res.json(result);
  };

  const sessionAction = async (req: Request, res: Response, next: NextFunction) => {
    const sessionId = req.params.id;
    const body = req.body as { choiceId?: string };
    const choiceId = body?.choiceId?.trim();
    if (!choiceId) {
      next(new AppError(400, "choiceId is required", "CHOICE_REQUIRED"));
      return;
    }

    try {
      const result = await gameService.processTurn(sessionId, choiceId);
      setupSse(res);
      if (typeof res.flushHeaders === "function") {
        res.flushHeaders();
      }

      let closed = false;
      res.on("close", () => {
        closed = true;
      });

      const chunks = splitNarrative(result.narrative, 34);
      for (const chunk of chunks) {
        if (closed) {
          return;
        }
        sendSseEvent(res, "narrative_delta", { text: chunk });
        await delay(80);
      }

      if (closed) {
        return;
      }

      sendSseEvent(res, "choices", { choices: result.choices });
      sendSseEvent(res, "state_patch", {
        turn: result.turn,
        stats: result.stats,
        flags: result.flags,
        evidencePool: result.evidencePool,
        npcRelations: result.npcRelations,
        verdictOutlook: result.verdictOutlook,
        statChanges: result.statChanges,
        events: result.events
      });
      sendSseEvent(res, "progress", result.progress);
      sendSseEvent(res, "token_usage", result.tokenUsage);
      sendSseEvent(res, "done", { summary: result.summary });
      res.end();
    } catch (error) {
      next(error);
    }
  };

  const getState = async (req: Request, res: Response) => {
    const state = await gameService.getState(req.params.id);
    res.json(state);
  };

  const createSave = async (req: Request, res: Response) => {
    const snapshot = await gameService.createSave(req.params.id);
    res.status(201).json({
      saveId: snapshot.saveId,
      sessionId: snapshot.sessionId,
      createdAt: snapshot.createdAt
    });
  };

  const loadSave = async (req: Request, res: Response) => {
    const body = req.body as { saveId?: string };
    const saveId = body?.saveId?.trim() ?? "";
    const result = await gameService.loadSave(saveId);
    res.json(result);
  };

  const getReplay = async (req: Request, res: Response) => {
    const replay = await gameService.getReplay(req.params.id);
    res.json(replay);
  };

  return {
    health,
    createSession,
    initSession,
    sessionAction,
    getState,
    createSave,
    loadSave,
    getReplay
  };
};
