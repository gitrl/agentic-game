import type { NextFunction, Request, Response } from "express";
import { AppError } from "../core/errors.js";
import type { GameService } from "../services/gameService.js";
import { sendSseEvent, setupSse } from "../utils/sse.js";

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
    const body = req.body as { choiceId?: string; userInput?: string };
    const choiceId = body?.choiceId?.trim();
    const userInput = body?.userInput;

    if (!choiceId && !userInput?.trim()) {
      next(new AppError(400, "choiceId or userInput is required", "ACTION_INPUT_REQUIRED"));
      return;
    }

    setupSse(res);
    if (typeof res.flushHeaders === "function") {
      res.flushHeaders();
    }

    let closed = false;
    res.on("close", () => {
      closed = true;
    });

    sendSseEvent(res, "status", { message: "已接收行动，正在处理..." });

    // 先发 input_feedback 占位：真流式下 inputFeedback 会在 turn 结束后才有完整内容
    // 但 narrative_delta 要能边生成边转发，所以这里不能等 inputFeedback
    // 做法：先让 narrative_delta 流出去，input_feedback 在最后一起发（前端已能容忍顺序）
    try {
      const { result, inputFeedback } = await gameService.processTurn(
        sessionId,
        { choiceId, userInput },
        {
          onNarrativeDelta: (text: string) => {
            if (closed) return;
            sendSseEvent(res, "narrative_delta", { text });
          }
        }
      );

      if (closed) {
        return;
      }

      sendSseEvent(res, "input_feedback", inputFeedback);
      sendSseEvent(res, "choices", { choices: result.choices });
      sendSseEvent(res, "state_patch", {
        turn: result.turn,
        stats: result.stats,
        flags: result.flags,
        evidencePool: result.evidencePool,
        npcRelations: result.npcRelations,
        verdictOutlook: result.verdictOutlook,
        rebirth: result.rebirth,
        statChanges: result.statChanges,
        events: result.events
      });
      sendSseEvent(res, "progress", result.progress);
      sendSseEvent(res, "token_usage", result.tokenUsage);
      sendSseEvent(res, "done", { summary: result.summary });
      if (result.gameOver) {
        sendSseEvent(res, "game_over", {
          endingType: result.endingType,
          endingNarrative: result.endingNarrative
        });
      }
      res.end();
    } catch (error) {
      // 参数校验类错误可能在 setupSse 之前返回；其余错误走 SSE error 事件
      if (!res.headersSent) {
        next(error);
        return;
      }
      // If SSE is already streaming, send error as SSE event
      const message = error instanceof AppError
        ? error.message
        : "AI 服务异常，请重试。";
      sendSseEvent(res, "error", { message, retryable: true });
      res.end();
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
      label: snapshot.label,
      createdAt: snapshot.createdAt
    });
  };

  const listSaves = async (req: Request, res: Response) => {
    const saves = await gameService.listSaves(req.params.id);
    res.json({ saves });
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
    listSaves,
    loadSave,
    getReplay
  };
};
