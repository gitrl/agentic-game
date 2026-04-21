import cors from "cors";
import express from "express";
import type { GameService } from "./services/gameService.js";
import { createSessionRoutes } from "./routes/sessionRoutes.js";
import { createTtsRoutes } from "./routes/ttsRoutes.js";
import { errorHandler, notFoundHandler } from "./middlewares/errorHandler.js";

export const createApp = (gameService: GameService) => {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(createSessionRoutes(gameService));
  app.use(createTtsRoutes());

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
