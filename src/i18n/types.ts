// i18n types — Task 2.4

/** Message catalogs by locale, each flat or nested: `{ en: { title: 'Notes', auth: { … } } }` */
export type Messages = Record<string, Record<string, unknown>>

/** A name as part of a key. One with a dot in it is only found at the top of a catalog */
type Dotless<Name extends string> = Name extends `${string}.${string}` ? never : Name

/** The names of an object that a key can carry: its own, numbers written out */
type Names<T> = Exclude<keyof T, symbol>

/** The keys `t` finds below `Prefix`: the names down to a text, joined by dots */
type KeysBelow<Value, Prefix extends string> = Value extends string
  ? Prefix
  : Value extends readonly (infer Entry)[]
    ? KeysBelow<Entry, `${Prefix}.${number}`>
    : Value extends object
      ? string extends keyof Value
        ? `${Prefix}.${string}`
        : {
            [Name in Names<Value>]: KeysBelow<Value[Name], `${Prefix}.${Dotless<`${Name}`>}`>
          }[Names<Value>]
      : never

/**
 * Every key of a catalog that `t` finds a text for: a name at the top (`'title'`, also one with
 * dots in it, `'auth.errors.invalid'`) or the names down to a text joined by dots. A catalog whose
 * names are not known when the code is checked (one that was loaded at runtime) has `string`.
 * For the keys of all locales together: `MessageKey<typeof messages[keyof typeof messages]>`.
 */
export type MessageKey<Catalog> = Catalog extends unknown
  ? string extends keyof Catalog
    ? string
    : {
        [Name in Names<Catalog>]: Catalog[Name] extends string
          ? `${Name}`
          : KeysBelow<Catalog[Name], Dotless<`${Name}`>>
      }[Names<Catalog>]
  : never

export interface I18nConfig<M extends Messages = Messages> {
  /** Default locale, e.g. 'en' */
  locale?: string
  /** Fallback locale when a key is missing in the active locale */
  fallback?: string
  /** Pre-loaded translations keyed by locale */
  messages?: M
  /**
   * Called each time a key has a text neither in the active locale nor in the fallback, right
   * before `t` or `tn` answer the key itself. `locale` is the active one. Log it, or throw in
   * tests and in development: what it throws leaves `t`.
   */
  onMissing?: (key: string, locale: string) => void
}

/**
 * `Key` is what `t` and `tn` take: the keys of the messages `createI18n` was given, where their
 * names are known when the code is checked, and any `string` otherwise. An instance with known
 * keys is assignable to the plain `I18nInstance`, for a key that is put together at runtime.
 */
export interface I18nInstance<Key extends string = string> {
  /** Translate a key with optional interpolation params */
  t(key: Key, params?: Record<string, string | number>): string
  /** Translate with pluralization; count selects which plural form */
  tn(key: Key, count: number, params?: Record<string, string | number>): string
  /** Switch the active locale */
  locale(name: string): void
  /** Return the currently active locale */
  getLocale(): string
  /** Format a number per the active locale */
  number(value: number, options?: Intl.NumberFormatOptions): string
  /** Format a date per the active locale */
  date(value: Date | string | number, options?: Intl.DateTimeFormatOptions): string
}

/** A key that one locale has a text for and another one lacks */
export interface MissingKey {
  /** The locale that lacks the text */
  locale: string
  key: string
}
