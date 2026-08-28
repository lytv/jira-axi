# @lytv/jira-axi

An AXI-shaped CLI for Jira Cloud agents.

## Install

```sh
pnpm add -g @lytv/jira-axi
```

## Usage

```sh
jra-axi accounts add --id work --site example --email agent@example.com --token-env JIRA_API_TOKEN
jra-axi auth
jra-axi issues list --project AXI
jra-axi issues view AXI-1
jra-axi projects list --account work
jra-axi boards list --project ENG
jra-axi sprints list --board 42 --state active
jra-axi users whoami
```

Run `jra-axi <command> --help` for flags and full examples.

Use `--token-env` for tokens. You can use `--token-file` with mode `0600`. Keychain token sources are not available in this build.
