// @loewen-digital/fullstack
// Main entry point — re-exports added as modules are implemented

export type { FullstackConfig } from './config/types.js'
export { defineConfig, loadConfig, env, resolveDriver } from './config/index.js'

export type { ErrorContext, SerializedError } from './errors/types.js'
export {
  FullstackError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
  ConflictError,
  RateLimitError,
  InternalError,
  ConfigError,
  DatabaseError,
  AuthError,
  MailError,
  StorageError,
  serializeError,
  errorToResponse,
  isFullstackError,
} from './errors/index.js'
