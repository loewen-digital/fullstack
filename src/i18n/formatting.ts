// Number/date formatting — Task 2.4

export function formatNumber(
  locale: string,
  value: number,
  options?: Intl.NumberFormatOptions
): string {
  return new Intl.NumberFormat(locale, options).format(value)
}

export function formatDate(
  locale: string,
  value: Date | string | number,
  options?: Intl.DateTimeFormatOptions
): string {
  const date = value instanceof Date ? value : new Date(value)
  return new Intl.DateTimeFormat(locale, options).format(date)
}
