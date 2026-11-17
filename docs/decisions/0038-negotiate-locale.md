# 0038 · i18n: `negotiateLocale` matches a language both ways and skips what it cannot read

## Context

#47 asks for weights, the order of the header, `de-CH` as `de`, and no `*` or `q=0`. It leaves
open what `de` gets from an app that only speaks `de-DE`, what a malformed entry counts as, and how
much of a header that a client controls is read.

## Decision

Ranges go by weight, then by position. For each: the locale that says the same, then one that says
more (`de` → `de-DE`), then both with one part less (RFC 4647 lookup). So `de-CH` gets `de-DE` too;
strict lookup would send a German reader to the default. An entry that is not RFC 9110's range with
an optional weight is skipped, not read as weight 1. So is a tag of more than 35 characters (RFC
5646 4.4.1): one of 50,000 parts overflowed the stack in a test. No handle in the SvelteKit adapter.

## Consequences

`zh-TW` gets `zh-CN` from an app whose only Chinese that is. `*` and no match answer `undefined`:
the default, and whether an account, a cookie or the address comes first, stay with the app.
