import { Request, Response, NextFunction } from 'express';
import { AppError } from '../lib/errors';
import { config } from '../config';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Log error
  console.error('Error:', err);

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      code: err.code,
      message: err.message,
      details: err.details,
    });
    return;
  }

  // Zod validation errors
  if (err.name === 'ZodError') {
    res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      details: (err as unknown as { errors: unknown }).errors,
    });
    return;
  }

  // PostgreSQL errors
  if ((err as { code?: string }).code === '23505') {
    // Unique violation
    res.status(409).json({
      code: 'CONFLICT',
      message: 'Resource already exists',
    });
    return;
  }

  if ((err as { code?: string }).code === '23503') {
    // Foreign key violation
    res.status(400).json({
      code: 'BAD_REQUEST',
      message: 'Referenced resource does not exist',
    });
    return;
  }

  // Default error
  res.status(500).json({
    code: 'INTERNAL_ERROR',
    message: config.env === 'production' ? 'Internal server error' : err.message,
  });
}
