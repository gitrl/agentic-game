import type { NextFunction, Request, Response } from "express";
import { AppError, isAppError } from "../core/errors.js";

export const notFoundHandler = (_req: Request, _res: Response, next: NextFunction) => {
  next(new AppError(404, "Route not found", "ROUTE_NOT_FOUND"));
};

export const errorHandler = (
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  if (isAppError(error)) {
    res.status(error.statusCode).json({
      error: error.message,
      code: error.code
    });
    return;
  }

  // eslint-disable-next-line no-console
  console.error("Unhandled backend error:", error);

  res.status(500).json({
    error: "Internal server error",
    code: "INTERNAL_SERVER_ERROR"
  });
};
