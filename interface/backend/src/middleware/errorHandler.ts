import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export const errorHandler = (
  
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  if (err instanceof ZodError) {
    res.status(400).json({ message: "Validation failed", details: err.flatten() });
    return;
  }
  
  const error = err as Error;
  console.error("ERROR HANDLER:", error);
  res.status(500).json({ message: error.message || "Internal server error" });
};
