# 0037 · i18n: `loadTranslations` leaves the entry, without a re-export

## Context

#48: `@loewen-digital/fullstack/i18n` carried `loadTranslations`, which imports `node:fs`. A client
build that only takes `createI18n` warned twice per module. The issue proposes an entry of its own
and a re-export from the old one for one minor version.

## Decision

`loadTranslations` lives in `@loewen-digital/fullstack/i18n/node` and is gone from the i18n entry at
once. Tried first: with the re-export in place the bundler still follows it to `node:fs` and prints
the same two warnings, so a re-export keeps what the issue is about. The package root keeps
exporting it: the root is server code and reaches Node modules anyway. The build's smoke test walks
the imports of the built i18n entry and fails when they reach a Node module.

## Consequences

An app that loads catalogs from files changes one import, or takes it from the root. The guard
covers `./i18n` only: `/logging` warns the same way through its file transport and is not on it.
