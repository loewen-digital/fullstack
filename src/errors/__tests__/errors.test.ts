import { describe, it, expect } from 'vitest'
import {
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
} from '../http-errors.js'
import { serializeError, errorToResponse, isFullstackError } from '../handler.js'

describe('FullstackError', () => {
  it('sets name, message, code, statusCode, context', () => {
    const err = new FullstackError('oops', 'TEST_ERROR', 400, { foo: 'bar' })
    expect(err.name).toBe('FullstackError')
    expect(err.message).toBe('oops')
    expect(err.code).toBe('TEST_ERROR')
    expect(err.statusCode).toBe(400)
    expect(err.context).toEqual({ foo: 'bar' })
    expect(err).toBeInstanceOf(Error)
  })

  it('defaults context to empty object', () => {
    const err = new FullstackError('x', 'X', 500)
    expect(err.context).toEqual({})
  })
})

describe('HTTP error classes', () => {
  const cases = [
    { Cls: NotFoundError, code: 'NOT_FOUND', status: 404, defaultMsg: 'Not found' },
    { Cls: UnauthorizedError, code: 'UNAUTHORIZED', status: 401, defaultMsg: 'Unauthorized' },
    { Cls: ForbiddenError, code: 'FORBIDDEN', status: 403, defaultMsg: 'Forbidden' },
    { Cls: ConflictError, code: 'CONFLICT', status: 409, defaultMsg: 'Conflict' },
    { Cls: InternalError, code: 'INTERNAL_ERROR', status: 500, defaultMsg: 'Internal server error' },
    { Cls: ConfigError, code: 'CONFIG_ERROR', status: 500, defaultMsg: 'Config failed' },
    { Cls: DatabaseError, code: 'DATABASE_ERROR', status: 500, defaultMsg: 'DB failed' },
    { Cls: AuthError, code: 'AUTH_ERROR', status: 401, defaultMsg: 'Auth failed' },
    { Cls: MailError, code: 'MAIL_ERROR', status: 500, defaultMsg: 'Mail failed' },
    { Cls: StorageError, code: 'STORAGE_ERROR', status: 500, defaultMsg: 'Storage failed' },
  ] as const

  for (const { Cls, code, status, defaultMsg } of cases) {
    it(`${Cls.name} — correct code and statusCode`, () => {
      const err = new (Cls as new (msg: string) => FullstackError)(defaultMsg)
      expect(err.code).toBe(code)
      expect(err.statusCode).toBe(status)
      expect(err).toBeInstanceOf(FullstackError)
    })
  }

  it('NotFoundError uses default message', () => {
    expect(new NotFoundError().message).toBe('Not found')
  })

  it('NotFoundError accepts custom message', () => {
    expect(new NotFoundError('User not found').message).toBe('User not found')
  })
})

describe('ValidationError', () => {
  it('stores field errors and uses 422', () => {
    const errs = { email: ['required', 'invalid email'] }
    const err = new ValidationError(errs)
    expect(err.statusCode).toBe(422)
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(err.errors).toEqual(errs)
    expect(err.context).toEqual({ errors: errs })
  })
})

describe('RateLimitError', () => {
  it('stores retryAfter', () => {
    const err = new RateLimitError('Too many', 60)
    expect(err.statusCode).toBe(429)
    expect(err.retryAfter).toBe(60)
    expect(err.context).toEqual({ retryAfter: 60 })
  })

  it('works without retryAfter', () => {
    const err = new RateLimitError()
    expect(err.retryAfter).toBeUndefined()
    expect(err.context).toEqual({})
  })
})

describe('serializeError()', () => {
  it('serializes FullstackError', () => {
    const err = new NotFoundError('User not found', { id: 42 })
    const result = serializeError(err)
    expect(result).toEqual({
      error: 'NOT_FOUND',
      message: 'User not found',
      statusCode: 404,
      context: { id: 42 },
    })
  })

  it('omits context when empty', () => {
    const result = serializeError(new NotFoundError())
    expect(result.context).toBeUndefined()
  })

  it('serializes plain Error', () => {
    const result = serializeError(new Error('boom'))
    expect(result).toEqual({ error: 'INTERNAL_ERROR', message: 'boom', statusCode: 500 })
  })

  it('serializes unknown values', () => {
    const result = serializeError('string error')
    expect(result).toEqual({ error: 'UNKNOWN_ERROR', message: 'string error', statusCode: 500 })
  })
})

describe('errorToResponse()', () => {
  it('returns a Response with correct status and JSON body', async () => {
    const res = errorToResponse(new NotFoundError('Not here'))
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toBe('application/json')
    const body = await res.json() as { error: string; message: string }
    expect(body.error).toBe('NOT_FOUND')
    expect(body.message).toBe('Not here')
  })
})

describe('isFullstackError()', () => {
  it('returns true for FullstackError instances', () => {
    expect(isFullstackError(new NotFoundError())).toBe(true)
  })

  it('returns true when code matches', () => {
    expect(isFullstackError(new NotFoundError(), 'NOT_FOUND')).toBe(true)
  })

  it('returns false when code does not match', () => {
    expect(isFullstackError(new NotFoundError(), 'FORBIDDEN')).toBe(false)
  })

  it('returns false for plain Error', () => {
    expect(isFullstackError(new Error('x'))).toBe(false)
  })

  it('returns false for non-errors', () => {
    expect(isFullstackError('oops')).toBe(false)
  })
})
