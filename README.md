# @lytv/jira-axi

An AXI-shaped CLI for Jira Cloud agents.

## Install

**Agent skill (recommended)**

Install the skill in the [Agent Skills](https://agentskills.io) format with [`npx skills`](https://github.com/vercel-labs/skills):

```sh
npx skills add lytv/jira-axi --skill jra-axi -g
```

The skill teaches your agent to run the CLI through `npx -y @lytv/jira-axi` on demand.
`-g` installs the skill for all projects (for example `~/.claude/skills/`). Drop `-g` to install for the current project only.

**Direct use**

```sh
npx -y @lytv/jira-axi
```

**Global install**

```sh
pnpm add -g @lytv/jira-axi
```

A global install is required for SessionStart hooks.

## Skill

The package includes `skills/jra-axi/SKILL.md`. It is generated from `src/skill.ts`. Do not edit the markdown by hand.

```sh
pnpm run build:skill
pnpm run build:skill -- --check
```

`--check` fails if the committed skill has drifted from `src/skill.ts`.

## Session hooks

Want assigned-to-me counts and account connectivity in every agent session? Install the CLI globally, then:

```sh
jra-axi setup hooks
```

This installs a SessionStart hook for Claude Code, Codex, and OpenCode. The command is flag-only. It does not prompt. Restart the agent session after you run it. The hook runs the home view: bin path, account connectivity, and compact assigned counts per account.

## Usage

```sh
jra-axi
jra-axi accounts add --id work --site example --email agent@example.com --token-env JIRA_API_TOKEN
jra-axi accounts --tui
jra-axi auth
jra-axi issues list --project AXI
jra-axi issues view AXI-1
jra-axi projects list --account work
jra-axi boards list --project ENG
jra-axi sprints list --board 42 --state active
jra-axi users whoami
jra-axi setup hooks
```

Run `jra-axi <command> --help` for flags and full examples.

Use `--token-env` for tokens. You can use `--token-file` with mode `0600`. Keychain token sources are not available in this build.
