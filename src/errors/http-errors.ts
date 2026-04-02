import type { ErrorContext } from './types.js'

/**
 * Base error class for all @loewen-digital/fullstack errors.
 * Adds `code`, `statusCode`, and `context` to the standard Error.
 */
export class FullstackError extends Error {
  readonly code: string
  readonly statusCode: number
  readonly context: ErrorContext

  constructor(message: string, code: string, statusCode: number, context: ErrorContext = {}) {
    super(message)
    this.name = this.constructor.name
    this.code = code
    this.statusCode = statusCode
    this.context = context
    // Maintain proper prototype chain in transpiled environments
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

// ─── HTTP Errors ────────────────────────────────────────────────────────────

export class NotFoundError extends FullstackError {
  constructor(message = 'Not found', context?: ErrorContext) {
    super(message, 'NOT_FOUND', 404, context)
  }
}

export class UnauthorizedError extends FullstackError {
  constructor(message = 'Unauthorized', context?: ErrorContext) {
    super(message, 'UNAUTHORIZED', 401, context)
  }
}

export class ForbiddenError extends FullstackError {
  constructor(message = 'Forbidden', context?: ErrorContext) {
    super(message, 'FORBIDDEN', 403, context)
  }
}

export class ValidationError extends FullstackError {
  readonly errors: Record<string, string[]>

  constructor(errors: Record<string, string[]>, message = 'Validation failed') {
    super(message, 'VALIDATION_ERROR', 422, { errors })
    this.errors = errors
  }
}

export class ConflictError extends FullstackError {
  constructor(message = 'Conflict', context?: ErrorContext) {
    super(message, 'CONFLICT', 409, context)
  }
}

export class RateLimitError extends FullstackError {
  readonly retryAfter?: number

  constructor(message = 'Too many requests', retryAfter?: number) {
    super(message, 'RATE_LIMIT_EXCEEDED', 429, retryAfter !== undefined ? { retryAfter } : {})
    this.retryAfter = retryAfter
  }
}

export class InternalError extends FullstackError {
  constructor(message = 'Internal server error', context?: ErrorContext) {
    super(message, 'INTERNAL_ERROR', 500, context)
  }
}

// ─── Module-specific Errors ─────────────────────────────────────────────────

export class ConfigError extends FullstackError {
  constructor(message: string, context?: ErrorContext) {
    super(message, 'CONFIG_ERROR', 500, context)
  }
}

export class DatabaseError extends FullstackError {
  constructor(message: string, context?: ErrorContext) {
    super(message, 'DATABASE_ERROR', 500, context)
  }
}

export class AuthError extends FullstackError {
  constructor(message: string, context?: ErrorContext) {
    super(message, 'AUTH_ERROR', 401, context)
  }
}

export class MailError extends FullstackError {
  constructor(message: string, context?: ErrorContext) {
    super(message, 'MAIL_ERROR', 500, context)
  }
}

export class StorageError extends FullstackError {
  constructor(message: string, context?: ErrorContext) {
    super(message, 'STORAGE_ERROR', 500, context)
  }
}
