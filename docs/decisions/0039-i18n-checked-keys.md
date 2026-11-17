# 0039 · i18n: `t` takes the keys of all locales together, and a test finds the gaps

## Context

#46 wants a key that does not exist refused when the code is checked, and leaves open whether a
locale that lacks a key of another one is a type error or a test's finding. Eddy chose the test.

## Decision

`t` and `tn` take every key some locale has a text for; `missingKeys(messages)` lists what each
locale lacks. A type error would forbid the fallback for checked catalogs (a `de-CH` that only
overrides `de`) and print a few hundred keys in one message. The type follows the lookup exactly:
a name with a dot counts only at the top of a catalog, arrays by index, numbers as names.
`onMissing` is told and changes nothing: the key stays the answer, and it may throw.

## Consequences

A made-up key, or one built at runtime, no longer compiles on an instance with known messages; the
plain `I18nInstance` takes any string. A key only another locale has compiles and prints the key:
the test or `onMissing` catches it. 1,200 keys per locale cost 0.06 s of checking.
