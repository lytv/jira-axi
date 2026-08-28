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

Use an environment variable or a keychain reference for tokens. File token storage is a last resort and must use mode `0600`.
