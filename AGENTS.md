# jira-axi

`jra-axi` is a TypeScript ESM CLI for Jira Cloud. Use `pnpm run build`, `pnpm run lint`, and `pnpm test` before a change is complete.

The client uses REST v3 for Jira resources and Agile 1.0 for boards and sprints. Issue search uses `/search/jql` with `nextPageToken` only.

Never store raw API tokens in account config. See `src/accounts.ts` for account schema and token-source rules.

## Maintaining this file

Keep only durable project facts here. Link to source files when they define details. Remove facts that no longer apply.
