// Validation types — Task 2.1

export type RuleString = string

export interface RuleObject {
  required?: boolean
  optional?: boolean
  nullable?: boolean
  type?: 'string' | 'number' | 'boolean' | 'array' | 'object'
  min?: number
  max?: number
  email?: boolean
  url?: boolean
  uuid?: boolean
  date?: boolean
  before?: string | Date
  after?: string | Date
  in?: unknown[]
  regex?: RegExp | string
  confirmed?: boolean
  [key: string]: unknown
}

export type FieldRule = RuleString | RuleObject

export type RulesMap = Record<string, FieldRule>

export interface ValidationError {
  field: string
  rule: string
  message: string
}

export type ValidationSuccess<T> = { ok: true; data: T }
export type ValidationFailure = { ok: false; errors: ValidationError[] }
export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure

export interface CustomRule {
  name: string
  validate(value: unknown, param: string | undefined, data: Record<string, unknown>): boolean | Promise<boolean>
  message(field: string, param: string | undefined): string
}

// Type inference — map rule definitions to TypeScript types
type InferFieldType<R extends FieldRule> =
  R extends string
    ? InferFromString<R>
    : R extends RuleObject
      ? InferFromObject<R>
      : unknown

type InferFromString<S extends string> =
  S extends `${string}nullable${string}`
    ? InferBaseFromString<S> | null
    : InferBaseFromString<S>

type InferBaseFromString<S extends string> =
  S extends `${string}number${string}` ? number :
  S extends `${string}boolean${string}` ? boolean :
  S extends `${string}array${string}` ? unknown[] :
  S extends `${string}object${string}` ? Record<string, unknown> :
  string

type InferFromObject<R extends RuleObject> =
  R extends { nullable: true }
    ? InferBaseFromObject<R> | null
    : InferBaseFromObject<R>

type InferBaseFromObject<R extends RuleObject> =
  R extends { type: 'number' } ? number :
  R extends { type: 'boolean' } ? boolean :
  R extends { type: 'array' } ? unknown[] :
  R extends { type: 'object' } ? Record<string, unknown> :
  string

type IsRequired<R extends FieldRule> =
  R extends string
    ? R extends `${string}optional${string}` ? false : true
    : R extends { optional: true } ? false : true

export type InferValidated<Rules extends RulesMap> = {
  [K in keyof Rules as IsRequired<Rules[K]> extends true ? K : never]: InferFieldType<Rules[K]>
} & {
  [K in keyof Rules as IsRequired<Rules[K]> extends false ? K : never]?: InferFieldType<Rules[K]>
}
