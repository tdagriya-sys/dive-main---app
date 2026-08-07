import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { MulterError } from "multer";

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: "NOT_FOUND", message: `No route for ${req.method} ${req.path}` });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.code, message: err.message });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Invalid request.", issues: err.issues });
  }
  if (err instanceof MulterError) {
    return res.status(400).json({ error: "UPLOAD_ERROR", message: err.message });
  }
  if (err instanceof Error && /Unsupported file type/.test(err.message)) {
    return res.status(400).json({ error: "UNSUPPORTED_FILE_TYPE", message: err.message });
  }
  // eslint-disable-next-line no-console
  console.error(err);
  return res.status(500).json({ error: "INTERNAL_ERROR", message: "Something went wrong." });
}
