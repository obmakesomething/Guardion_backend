export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(400, 'BAD_REQUEST', message, details);
    this.name = 'BadRequestError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(401, 'UNAUTHORIZED', message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, 'FORBIDDEN', message);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    const message = id ? `${resource} with id ${id} not found` : `${resource} not found`;
    super(404, 'NOT_FOUND', message, { resource, id });
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(409, 'CONFLICT', message, details);
    this.name = 'ConflictError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(422, 'VALIDATION_ERROR', message, details);
    this.name = 'ValidationError';
  }
}

export class InternalError extends AppError {
  constructor(message = 'Internal server error') {
    super(500, 'INTERNAL_ERROR', message);
    this.name = 'InternalError';
  }
}

// State machine errors
export class InvalidStateTransitionError extends AppError {
  constructor(from: string, to: string, reason?: string) {
    const message = reason
      ? `Cannot transition from ${from} to ${to}: ${reason}`
      : `Cannot transition from ${from} to ${to}`;
    super(400, 'INVALID_STATE_TRANSITION', message, { from, to });
    this.name = 'InvalidStateTransitionError';
  }
}
