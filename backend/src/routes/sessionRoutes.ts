import { Router } from "express";
import type { GameService } from "../services/gameService.js";
import { createGameController } from "../controllers/gameController.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const createSessionRoutes = (gameService: GameService): Router => {
  const router = Router();
  const controller = createGameController(gameService);

  router.get("/health", controller.health);
  router.post("/sessions", asyncHandler(controller.createSession));
  router.post("/sessions/:id/init", asyncHandler(controller.initSession));
  router.post("/sessions/:id/actions", asyncHandler(controller.sessionAction));
  router.get("/sessions/:id/state", asyncHandler(controller.getState));
  router.post("/sessions/:id/save", asyncHandler(controller.createSave));
  router.post("/sessions/load", asyncHandler(controller.loadSave));
  router.get("/sessions/:id/replay", asyncHandler(controller.getReplay));

  return router;
};
