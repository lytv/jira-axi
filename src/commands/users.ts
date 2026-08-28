import { AxiError } from "axi-sdk-js";
import { readAccounts, resolveAccount, tokenForAccount } from "../accounts.js";
import { JiraClient } from "../client.js";
import type { Account, JiraUser } from "../types.js";

export const USERS_HELP = `usage: jra-axi users <whoami|search> [flags]
commands:
  whoami                       Show the current Jira identity
  search --query <text>        List matching Jira users
flags:
  --query <text>               Search text. Required for search
  --account <id>               Account ID. Default: selected configured account
examples:
  jra-axi users whoami
  jra-axi users search --query "Taylor"
  jra-axi users search --query "Taylor" --account work
`;

type UsersDependencies = {
  readAccounts: () => Promise<Account[]>;
  tokenForAccount: (account: Account) => Promise<string>;
  createClient: (account: Account, token: string) => JiraClient;
};

const dependencies: UsersDependencies = {
  readAccounts,
  tokenForAccount,
  createClient: (account, token) => new JiraClient(account, token),
};

function usage(message: string): AxiError {
  return new AxiError(message, "VALIDATION_ERROR", [
    "Run `jra-axi users --help`",
  ]);
}

function flags(args: string[], valid: string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!flag.startsWith("--")) throw usage(`Unexpected argument ${flag}`);
    if (!valid.includes(flag)) throw usage(`Unknown flag ${flag}`);
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
  options: UsersDependencies,
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

function userRow(user: JiraUser): Record<string, unknown> {
  return {
    accountId: user.accountId,
    ...(typeof user.displayName === "string" ? { name: user.displayName } : {}),
    ...(typeof user.emailAddress === "string"
      ? { email: user.emailAddress }
      : {}),
  };
}

async function searchUsers(
  client: JiraClient,
  query: string,
): Promise<JiraUser[]> {
  const maxResults = 50;
  const users: JiraUser[] = [];
  for (let startAt = 0; ; startAt += maxResults) {
    const page = (await client.rest("/user/search", {
      query: { query, startAt, maxResults },
    })) as JiraUser[];
    users.push(...page);
    if (page.length < maxResults) return users;
  }
}

export async function usersCommand(
  args: string[],
  options: UsersDependencies = dependencies,
): Promise<Record<string, unknown>> {
  const [subcommand, ...rest] = args;
  if (subcommand === "whoami") {
    const values = flags(rest, ["--account"]);
    const { account, client } = await clientFor(
      values.get("--account"),
      options,
    );
    const user = (await client.rest("/myself")) as JiraUser;
    return { account: account.id, user: userRow(user) };
  }
  if (subcommand === "search") {
    const values = flags(rest, ["--query", "--account"]);
    const query = values.get("--query");
    if (!query) throw usage("--query is required");
    const { account, client } = await clientFor(
      values.get("--account"),
      options,
    );
    const users = await searchUsers(client, query);
    return users.length === 0
      ? {
          account: account.id,
          query,
          count: 0,
          users: [],
          message: `No users found for ${JSON.stringify(query)} on account ${account.id}`,
        }
      : {
          account: account.id,
          query,
          count: users.length,
          users: users.map(userRow),
          help: [
            "Use accountId when a Jira command requires a user identity",
            "Run `jra-axi users whoami` to show the current identity",
          ],
        };
  }
  throw usage("Use users whoami or users search --query <text>");
}
