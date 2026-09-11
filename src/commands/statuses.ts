import { AxiError } from "axi-sdk-js";
import { readAccounts, resolveAccount, tokenForAccount } from "../accounts.js";
import { JiraClient } from "../client.js";
import type { Account, JiraProject } from "../types.js";

export const STATUSES_HELP = `usage: jra-axi statuses create [flags]
Create a project-scoped status for a team-managed Jira Cloud project.
flags:
  --project <key-or-id>        Team-managed project key or ID. Required
  --name <name>                Status name. Required
  --account <id>               Account ID. Default: selected configured account
examples:
  jra-axi statuses create --project KAN --name Res
  jra-axi statuses create --project KAN --name "Ready for QA" --account work
`;

type StatusesDependencies = {
  readAccounts: () => Promise<Account[]>;
  tokenForAccount: (account: Account) => Promise<string>;
  createClient: (account: Account, token: string) => JiraClient;
};

const dependencies: StatusesDependencies = {
  readAccounts,
  tokenForAccount,
  createClient: (account, token) => new JiraClient(account, token),
};

type ProjectDetails = JiraProject & { simplified?: unknown };
type StatusDetails = {
  id?: unknown;
  name?: unknown;
  statusCategory?: unknown;
};

function usage(message: string): AxiError {
  return new AxiError(message, "VALIDATION_ERROR", [
    "Run `jra-axi statuses --help`",
  ]);
}

function flags(args: string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!flag.startsWith("--")) throw usage(`Unexpected argument ${flag}`);
    if (!["--project", "--name", "--account"].includes(flag))
      throw usage(`Unknown flag ${flag}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--"))
      throw usage(`${flag} requires a value`);
    values.set(flag, value);
    index++;
  }
  return values;
}

async function clientFor(
  accountId: string | undefined,
  options: StatusesDependencies,
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

function statusRow(status: StatusDetails): Record<string, unknown> {
  return {
    ...(typeof status.id === "string" ? { id: status.id } : {}),
    ...(typeof status.name === "string" ? { name: status.name } : {}),
    ...(typeof status.statusCategory === "string"
      ? { category: status.statusCategory }
      : {}),
  };
}

export async function statusesCommand(
  args: string[],
  options: StatusesDependencies = dependencies,
): Promise<Record<string, unknown>> {
  const [subcommand, ...rest] = args;
  if (subcommand !== "create")
    throw usage("Use statuses create --project <KEY> --name <name>");
  const values = flags(rest);
  const project = values.get("--project");
  const name = values.get("--name");
  if (!project) throw usage("--project is required");
  if (!name?.trim()) throw usage("--name is required");
  const { account, client } = await clientFor(values.get("--account"), options);
  const details = (await client.rest(
    `/project/${encodeURIComponent(project)}`,
  )) as ProjectDetails;
  if (details.simplified === false)
    throw usage(`${project} is not a team-managed project`);
  const existing = (await client.rest("/statuses/byNames", {
    query: { name, projectId: details.id },
  })) as StatusDetails[];
  if (existing.length > 0) {
    return {
      account: account.id,
      project,
      status: statusRow(existing[0]),
      created: false,
      message: `Status ${JSON.stringify(name)} already exists in project ${project} (no-op)`,
    };
  }
  const created = (await client.rest("/statuses", {
    method: "POST",
    body: {
      scope: { type: "PROJECT", project: { id: details.id } },
      statuses: [{ name, statusCategory: "TODO" }],
    },
  })) as StatusDetails[];
  if (!created[0])
    throw new AxiError("Jira did not return the created status", "JIRA_ERROR");
  return {
    account: account.id,
    project,
    status: statusRow(created[0]),
    created: true,
    help: [
      `Run \`jra-axi issues list --project ${project} --status ${JSON.stringify(name)}\` to find issues with this status`,
    ],
  };
}
