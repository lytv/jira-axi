# @lyrks/jira-axi

An AXI-shaped CLI for Jira Cloud agents.

jra-axi talks to Jira Cloud only (`*.atlassian.net`). It does not support Jira Data Center or Server.

## Why not wrap acli?

Atlassian CLI (`acli`) already searches with JQL and manages comments. jra-axi is a native AXI client, not an acli wrapper. AXI owns compact TOON and JSON output, native multi-account config plus a human TUI, worklog commands, and ADF encoding for descriptions, comments, and worklog text. You can still import Cloud sites from acli or jira-cli into jra-axi accounts.

## Install

**Agent skill (recommended)**

Install the skill in the [Agent Skills](https://agentskills.io) format with [`npx skills`](https://github.com/vercel-labs/skills):

```sh
npx skills add lytv/jira-axi --skill jra-axi -g
```

The skill teaches your agent to run the CLI through `npx -y @lyrks/jira-axi` on demand.
`-g` installs the skill for all projects (for example `~/.claude/skills/`). Drop `-g` to install for the current project only.

**Direct use**

```sh
npx -y @lyrks/jira-axi
```

**Global install**

```sh
pnpm add -g @lyrks/jira-axi
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
jra-axi                                                          # assigned-to-me home
jra-axi home --json                                              # same home as JSON
jra-axi accounts add --id work --site example --email agent@example.com --token-env JIRA_API_TOKEN
jra-axi accounts list
jra-axi accounts import --from acli --token-env JIRA_API_TOKEN
jra-axi accounts default work
jra-axi accounts --tui                                           # human dashboard
jra-axi --tui                                                    # alias for accounts --tui
jra-axi auth
jra-axi auth --json
jra-axi issues list --project AXI
jra-axi issues list --jql "assignee = currentUser()" --limit 20
jra-axi issues view AXI-1
jra-axi issues view AXI-1 --full                                 # untruncated description and comments
jra-axi issues create --project AXI --type Task --summary "Fix login"
jra-axi issues transition AXI-1 --list
jra-axi issues transition AXI-1 --status "In Progress"
jra-axi issues comment AXI-1 --body "Started"
jra-axi projects list --account work
jra-axi boards list --project ENG
jra-axi sprints list --board 42 --state active
jra-axi users whoami
jra-axi setup hooks
```

Run `jra-axi <command> --help` for flags and full examples.

Default stdout is compact TOON. Use `--json` on `home` and `auth` for JSON. Use `--full` on `issues view` for untruncated description and comment text.

Use `--token-env` for tokens. You can use `--token-file` with mode `0600`. Keychain token sources are not available in this build.

### Commands

| Command    | Description                                                                  |
| ---------- | ---------------------------------------------------------------------------- |
| (none)     | Assigned-to-me home across configured Cloud accounts                         |
| `accounts` | Add, list, import, default, remove, and `--tui` dashboard                    |
| `auth`     | Check account connectivity without printing token values                     |
| `issues`   | List, view, create, update, assign, transition, comment, link, worklog, meta |
| `projects` | List and view projects                                                       |
| `boards`   | List boards                                                                  |
| `sprints`  | List and view sprints                                                        |
| `users`    | `whoami` and user search                                                     |
| `setup`    | Install optional agent SessionStart hooks                                    |

## Development

```sh
pnpm install
pnpm run build
pnpm run lint
pnpm run format:check
pnpm test
pnpm run build:skill -- --check
```

## License

MIT
