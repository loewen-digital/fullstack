# 0022 The docs are an assets-only Worker

## Context

The docs were the Cloudflare Pages project `fullstack-docs-vitepress`. Since 2026-10-06 every
loewen-digital repository deploys to Workers with Static Assets, never Pages: Pages gets nothing
new, and the one Cloudflare token has to work the same way for every repository.

## Decision

`docs/wrangler.jsonc` declares the assets-only Worker `fullstack-docs`: no `main`, VitePress's
`404.html` through `not_found_handling`, `account_id` in the config so the workflow needs only
`CLOUDFLARE_API_TOKEN`. `.github/workflows/docs.yml` runs `wrangler deploy` on every push to `main`
that touches the docs, as before. No Preview per pull request: `preview.yml` is for apps.

## Consequences

The docs live at https://fullstack-docs.loewen-digital.workers.dev, linked from README and changelog.
The old address redirects there through one last Pages deploy of a `_redirects` file; the Pages
projects `fullstack-docs-vitepress` and `fullstack-docs-starlight` can go.
