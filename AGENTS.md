# jira-axi

`jra-axi` is a TypeScript ESM CLI for Jira Cloud. Use `pnpm run build`, `pnpm run lint`, and `pnpm test` before a change is complete.

The client uses REST v3 for Jira resources and Agile 1.0 for boards and sprints. Issue search uses `/search/jql` with `nextPageToken` only.

Never store raw API tokens in account config. See `src/accounts.ts` for account schema and token-source rules.

Issue commands live in `src/commands/issues.ts`. Mutation and single-key commands resolve one account and never fan out across sites.

The human accounts dashboard (`jra-axi accounts --tui`, aliased at `jra-axi --tui`) is presentation only: `src/tui.ts` (pure renderer), `src/tui-live.ts` (injected-io live loop, `q`/Ctrl+C to quit), and `src/tui-data.ts` (per-account data loader, requests serialized one account at a time). It renders the same data the TOON/JSON surfaces report and must not change their contracts.

Home view lives in `src/commands/home.ts` and uses `src/queries/assigned.ts`. Home may fan out across accounts. Other commands must not.

Generate `skills/jra-axi/SKILL.md` with `pnpm run build:skill`. Do not hand-edit it. `pnpm run build:skill -- --check` fails on drift.

`jra-axi setup hooks` installs SessionStart hooks. See `src/commands/setup.ts`.

v1 surface and the out-of-scope list live in `VISION.md`. Cloud only. No Data Center, Server, or OAuth 3LO.

Releases are cut by release-please from conventional commits on `main`. Merging the bot release PR runs `npm publish --access public --provenance` in `.github/workflows/release-please.yml` via npm OIDC trusted publishing (`id-token: write`). Do not invent an `NPM_TOKEN`. Do not hand-edit `CHANGELOG.md` or `.release-please-manifest.json`.

## Maintaining this file

Keep only durable project facts here. Link to source files when they define details. Remove facts that no longer apply.
