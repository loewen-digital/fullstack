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

// Phase 2: Standalone Modules

export type {
  FieldRule,
  RuleObject,
  RulesMap,
  ValidationError as FieldValidationError,
  ValidationResult,
  InferValidated,
  CustomRule,
} from './validation/index.js'
export { validate, defineRules } from './validation/index.js'

export type { LogLevel, LogEntry, LogTransport, LoggerConfig, LoggerInstance } from './logging/index.js'
export { createLogger, consoleTransport, fileTransport, externalTransport } from './logging/index.js'

export type { EventMap, EventListener, EventBusInstance } from './events/index.js'
export { createEventBus, defineEvents } from './events/index.js'

export type { I18nConfig, I18nInstance } from './i18n/index.js'
export { createI18n, loadTranslations } from './i18n/index.js'
