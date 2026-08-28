import { AxiError } from "axi-sdk-js";
import { readAccounts, resolveAccount, tokenForAccount } from "../accounts.js";
import { JiraClient } from "../client.js";
import type { Account, JiraProject } from "../types.js";

export const PROJECTS_HELP = `usage: jra-axi projects <list|view> [flags]
commands:
  list                         List projects for one account
  view <KEY>                   Show one project
flags:
  --account <id>               Account ID. Default: selected configured account
examples:
  jra-axi projects list
  jra-axi projects list --account work
  jra-axi projects view AXI --account work
`;

type ProjectsDependencies = {
  readAccounts: () => Promise<Account[]>;
  tokenForAccount: (account: Account) => Promise<string>;
  createClient: (account: Account, token: string) => JiraClient;
};

const dependencies: ProjectsDependencies = {
  readAccounts,
  tokenForAccount,
  createClient: (account, token) => new JiraClient(account, token),
};

type ProjectDetails = JiraProject & {
  projectTypeKey?: unknown;
  lead?: { displayName?: unknown };
  url?: unknown;
};

function usage(message: string): AxiError {
  return new AxiError(message, "VALIDATION_ERROR", [
    "Run `jra-axi projects --help`",
  ]);
}

function accountFlag(args: string[]): string | undefined {
  if (args.length === 0) return undefined;
  if (args.length !== 2 || args[0] !== "--account" || !args[1]) {
    if (args[0]?.startsWith("--"))
      throw usage(`Unknown or incomplete flag ${args[0]}`);
    throw usage(`Unexpected argument ${args[0]}`);
  }
  return args[1];
}

async function clientFor(
  accountId: string | undefined,
  options: ProjectsDependencies,
): Promise<{ account: Account; client: JiraClient }> {
  const account = resolveAccount(await options.readAccounts(), accountId);
  return {
    account,
    client: options.createClient(
      account,
      await options.tokenForAccount(account),
    ),
  };
}

function projectRow(project: ProjectDetails): Record<string, unknown> {
  return {
    id: project.id,
    key: project.key,
    name: project.name,
    ...(typeof project.projectTypeKey === "string"
      ? { type: project.projectTypeKey }
      : {}),
  };
}

export async function projectsCommand(
  args: string[],
  options: ProjectsDependencies = dependencies,
): Promise<Record<string, unknown>> {
  const [subcommand, ...rest] = args;
  if (subcommand === "list") {
    const { account, client } = await clientFor(accountFlag(rest), options);
    const projects = await client.listClassic<ProjectDetails>("/project");
    return projects.length === 0
      ? {
          account: account.id,
          count: 0,
          projects: [],
          message: `No projects found for account ${account.id}`,
        }
      : {
          account: account.id,
          count: projects.length,
          projects: projects.map(projectRow),
          help: [
            "Run `jra-axi projects view <KEY>` to see project details",
            "Run `jra-axi boards list --project <KEY>` to list project boards",
          ],
        };
  }
  if (subcommand === "view") {
    const key = rest[0];
    if (!key || key.startsWith("--")) throw usage("projects view requires KEY");
    const { account, client } = await clientFor(
      accountFlag(rest.slice(1)),
      options,
    );
    const project = (await client.rest(
      `/project/${encodeURIComponent(key)}`,
    )) as ProjectDetails;
    return {
      account: account.id,
      project: {
        ...projectRow(project),
        ...(typeof project.lead?.displayName === "string"
          ? { lead: project.lead.displayName }
          : {}),
        ...(typeof project.url === "string" ? { url: project.url } : {}),
      },
    };
  }
  throw usage("Use projects list or projects view <KEY>");
}
