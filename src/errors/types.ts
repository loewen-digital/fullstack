export interface ErrorContext {
  [key: string]: unknown
}

export interface SerializedError {
  error: string
  message: string
  statusCode: number
  context?: ErrorContext
}
