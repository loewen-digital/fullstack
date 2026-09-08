# 0001 · A pushed tag is the release: trusted publishing, notes from `CHANGELOG.md`

## Context

`publish.yml` published on tags with an `NPM_TOKEN` secret; `changelog.yml` let git-cliff generate release
notes from commit messages (`cliff.toml`). npm has revoked classic tokens and expires granular ones, and the
loop curates `CHANGELOG.md` by hand. flatdb settled this in its decision 0010; every library releases alike.

## Decision

One `release.yml` on `push: tags: v*`: the tag must equal the `package.json` version, tests and build run,
`npm publish` goes through npm trusted publishing (OIDC, `id-token: write`, provenance automatic), and
`gh release create` takes the `## v<version>` section of `CHANGELOG.md` as title and notes. No secret, no
cliff config. Canonical copy: `agent-loop/snippets/release.yml`.

## Consequences

The first version is published by hand, then the trusted publisher is registered once on npmjs.com; the
`NPM_TOKEN` secret goes after the first green release. A release is: move the Unreleased lines, bump,
commit, tag, push. Commit messages need not be release-notes quality.
