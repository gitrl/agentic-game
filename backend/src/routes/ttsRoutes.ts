import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { TtsService } from "../services/ttsService.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError } from "../core/errors.js";

export const createTtsRoutes = (): Router => {
  const router = Router();
  const ttsService = new TtsService();

  router.post(
    "/tts",
    asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
      const { text } = req.body as { text?: string };
      if (!text?.trim()) {
        throw new AppError(400, "text 参数不能为空", "TTS_INPUT_REQUIRED");
      }

      const audio = await ttsService.synthesize(text.trim());
      res.set({
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audio.length),
        "Cache-Control": "public, max-age=3600"
      });
      res.send(audio);
    })
  );

  return router;
};
