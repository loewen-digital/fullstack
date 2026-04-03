// Logging types — Task 2.2

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal'

export interface LogEntry {
  level: LogLevel
  message: string
  timestamp: string
  context?: Record<string, unknown>
  [key: string]: unknown
}

export interface LogTransport {
  log(entry: LogEntry): void | Promise<void>
}

export interface LoggerConfig {
  /** Minimum log level to emit. Default: 'debug' */
  level?: LogLevel
  /** Transports to write to. Default: [consoleTransport()] */
  transports?: LogTransport[]
  /** 'dev' = colored console output; 'prod' = JSON. Auto-detected from NODE_ENV if omitted. */
  format?: 'dev' | 'prod'
  /** Base context merged into every log entry */
  context?: Record<string, unknown>
}

export interface LoggerInstance {
  debug(message: string, context?: Record<string, unknown>): void
  info(message: string, context?: Record<string, unknown>): void
  warn(message: string, context?: Record<string, unknown>): void
  error(message: string, context?: Record<string, unknown>): void
  fatal(message: string, context?: Record<string, unknown>): void
  child(context: Record<string, unknown>): LoggerInstance
}
