# jira-axi

`jra-axi` is a TypeScript ESM CLI for Jira Cloud. Use `pnpm run build`, `pnpm run lint`, and `pnpm test` before a change is complete.

The client uses REST v3 for Jira resources and Agile 1.0 for boards and sprints. Issue search uses `/search/jql` with `nextPageToken` only.

Never store raw API tokens in account config. See `src/accounts.ts` for account schema and token-source rules.

Issue commands live in `src/commands/issues.ts`. Mutation and single-key commands resolve one account and never fan out across sites.

The human accounts dashboard (`jra-axi accounts --tui`, aliased at `jra-axi --tui`) is presentation only: `src/tui.ts` (pure renderer), `src/tui-live.ts` (injected-io live loop, `q`/Ctrl+C to quit), and `src/tui-data.ts` (per-account data loader, requests serialized one account at a time). It renders the same data the TOON/JSON surfaces report and must not change their contracts.

## Maintaining this file

Keep only durable project facts here. Link to source files when they define details. Remove facts that no longer apply.
