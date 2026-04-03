// Pluralization — Task 2.4

/**
 * Select a plural form from a pipe-delimited string based on count.
 *
 * Formats supported:
 *  - "apple|apples"               — zero/one uses form[0], others use form[1]
 *  - "no apples|one apple|apples" — zero=form[0], one=form[1], many=form[2]
 *
 * Each form may contain :count which is replaced by the actual number.
 */
export function pluralize(value: string, count: number): string {
  const forms = value.split('|')

  let form: string
  if (forms.length === 1) {
    form = forms[0] ?? value
  } else if (forms.length === 2) {
    form = (count === 1 ? forms[0] : forms[1]) ?? value
  } else {
    // 3+ forms: index 0 = zero, 1 = one, 2+ = many
    if (count === 0) form = forms[0] ?? value
    else if (count === 1) form = forms[1] ?? value
    else form = forms[2] ?? forms[1] ?? value
  }

  return form.replace(/:count/g, String(count))
}
