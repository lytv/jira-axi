import { runAxiCli } from "axi-sdk-js";
import { accountsCommand } from "./accounts.js";
import { authCommand } from "./commands/auth.js";
import { VERSION } from "./version.js";

export const DESCRIPTION = "Manage Jira Cloud accounts and authentication for agents.";
export const TOP_HELP = `usage: jra-axi [accounts|auth] [flags]
commands[2]:
  accounts, auth
output:
  Default output is TOON. Use --json on auth for JSON.
examples:
  jra-axi accounts add --id work --site example --email agent@example.com --token-env JIRA_API_TOKEN
  jra-axi accounts list
  jra-axi auth
`;

type MainOptions = { argv?: string[]; stdout?: { write: (chunk: string) => unknown }; binPath?: string };

export async function main(options: MainOptions = {}): Promise<void> {
  await runAxiCli({
    argv: options.argv ?? process.argv.slice(2),
    ...(options.stdout ? { stdout: options.stdout } : {}),
    description: DESCRIPTION,
    version: VERSION,
    topLevelHelp: TOP_HELP,
    commands: { accounts: accountsCommand, auth: authCommand },
    home: async () => ({ help: ["Run `jra-axi accounts add --help` to add a Jira Cloud account", "Run `jra-axi auth` to test configured accounts"] }),
    getCommandHelp: (command) => command === "accounts" || command === "auth" ? TOP_HELP : undefined,
  });
}
