import { runAxiCli } from "axi-sdk-js";
import { accountsCommand } from "./accounts.js";
import { authCommand } from "./commands/auth.js";
import {
  boardsCommand,
  BOARDS_HELP,
  sprintsCommand,
  SPRINTS_HELP,
} from "./commands/boards.js";
import { issuesCommand } from "./commands/issues.js";
import { projectsCommand, PROJECTS_HELP } from "./commands/projects.js";
import { usersCommand, USERS_HELP } from "./commands/users.js";
import { VERSION } from "./version.js";

export const DESCRIPTION = "Manage Jira Cloud resources for agents.";
export const TOP_HELP = `usage: jra-axi <command> [flags]
commands[7]:
  accounts, auth, issues, projects, boards, sprints, users
output:
  Default output is TOON. Use --json on auth for JSON.
  Use --tui on accounts for a human terminal dashboard.
examples:
  jra-axi accounts add --id work --site example --email agent@example.com --token-env JIRA_API_TOKEN
  jra-axi accounts --tui
  jra-axi issues list --project AXI
  jra-axi issues view AXI-1
  jra-axi projects list --account work
  jra-axi sprints list --board 42 --state active
`;

type MainOptions = {
  argv?: string[];
  stdout?: { write: (chunk: string) => unknown };
  binPath?: string;
};

export async function main(options: MainOptions = {}): Promise<void> {
  const argv = options.argv ?? process.argv.slice(2);
  // `jra-axi --tui` is an alias for `jra-axi accounts --tui`: the same human
  // dashboard, reachable without naming the accounts command.
  const routedArgv = argv[0] === "--tui" ? ["accounts", ...argv] : argv;
  await runAxiCli({
    argv: routedArgv,
    ...(options.stdout ? { stdout: options.stdout } : {}),
    description: DESCRIPTION,
    version: VERSION,
    topLevelHelp: TOP_HELP,
    commands: {
      accounts: accountsCommand,
      auth: authCommand,
      issues: (args) => issuesCommand(args),
      projects: projectsCommand,
      boards: boardsCommand,
      sprints: sprintsCommand,
      users: usersCommand,
    },
    home: async () => ({
      help: [
        "Run `jra-axi issues list` to search issues",
        "Run `jra-axi accounts add --help` to add a Jira Cloud account",
        "Run `jra-axi projects list` to list Jira projects",
        "Run `jra-axi users whoami` to show the current Jira identity",
      ],
    }),
    getCommandHelp: (command) =>
      command === "accounts" || command === "auth"
        ? TOP_HELP
        : command === "projects"
          ? PROJECTS_HELP
          : command === "boards"
            ? BOARDS_HELP
            : command === "sprints"
              ? SPRINTS_HELP
              : command === "users"
                ? USERS_HELP
                : undefined,
  });
}
