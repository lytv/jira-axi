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
```

Use `--token-env` for tokens. You can use `--token-file` with mode `0600`. Keychain token sources are not available in this build.
