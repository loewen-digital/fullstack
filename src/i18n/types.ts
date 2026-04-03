// i18n types — Task 2.4

export interface I18nConfig {
  /** Default locale, e.g. 'en' */
  locale?: string
  /** Fallback locale when a key is missing in the active locale */
  fallback?: string
  /** Pre-loaded translations keyed by locale */
  messages?: Record<string, Record<string, unknown>>
  /** Directory path to load JSON translation files from (Node only) */
  directory?: string
}

export interface I18nInstance {
  /** Translate a key with optional interpolation params */
  t(key: string, params?: Record<string, string | number>): string
  /** Translate with pluralization; count selects which plural form */
  tn(key: string, count: number, params?: Record<string, string | number>): string
  /** Switch the active locale */
  locale(name: string): void
  /** Return the currently active locale */
  getLocale(): string
  /** Format a number per the active locale */
  number(value: number, options?: Intl.NumberFormatOptions): string
  /** Format a date per the active locale */
  date(value: Date | string | number, options?: Intl.DateTimeFormatOptions): string
}
