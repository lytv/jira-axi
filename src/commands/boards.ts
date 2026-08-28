import { AxiError } from "axi-sdk-js";
import { readAccounts, resolveAccount, tokenForAccount } from "../accounts.js";
import { JiraClient } from "../client.js";
import type { Account, JiraBoard, JiraSprint } from "../types.js";

export const BOARDS_HELP = `usage: jra-axi boards list [flags]
flags:
  --project <key-or-id>        Limit boards to a project
  --account <id>               Account ID. Default: selected configured account
examples:
  jra-axi boards list
  jra-axi boards list --project AXI
  jra-axi boards list --project AXI --account work
`;

export const SPRINTS_HELP = `usage: jra-axi sprints <list|view> [flags]
commands:
  list --board <id>            List sprints for a board
  view <ID>                    Show one sprint
flags:
  --board <id>                 Board ID. Required for list
  --state <active|future|closed> Limit listed sprints by state
  --account <id>               Account ID. Default: selected configured account
examples:
  jra-axi sprints list --board 42
  jra-axi sprints list --board 42 --state active
  jra-axi sprints view 7 --account work
`;

type BoardsDependencies = {
  readAccounts: () => Promise<Account[]>;
  tokenForAccount: (account: Account) => Promise<string>;
  createClient: (account: Account, token: string) => JiraClient;
};

const dependencies: BoardsDependencies = {
  readAccounts,
  tokenForAccount,
  createClient: (account, token) => new JiraClient(account, token),
};

type BoardDetails = JiraBoard & {
  location?: { projectKey?: unknown };
};
type SprintDetails = JiraSprint & {
  goal?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  completeDate?: unknown;
  originBoardId?: unknown;
};

function usage(group: "boards" | "sprints", message: string): AxiError {
  return new AxiError(message, "VALIDATION_ERROR", [
    `Run \`jra-axi ${group} --help\``,
  ]);
}

function flags(
  group: "boards" | "sprints",
  args: string[],
  valid: string[],
): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!flag.startsWith("--"))
      throw usage(group, `Unexpected argument ${flag}`);
    if (!valid.includes(flag)) throw usage(group, `Unknown flag ${flag}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--"))
      throw usage(group, `${flag} requires a value`);
    values.set(flag, value);
    index++;
  }
  return values;
}

async function clientFor(
  accountId: string | undefined,
  options: BoardsDependencies,
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

function boardRow(board: BoardDetails): Record<string, unknown> {
  return {
    id: board.id,
    name: board.name,
    ...(typeof board.type === "string" ? { type: board.type } : {}),
    ...(typeof board.location?.projectKey === "string"
      ? { project: board.location.projectKey }
      : {}),
  };
}

function sprintRow(sprint: SprintDetails): Record<string, unknown> {
  return {
    id: sprint.id,
    name: sprint.name,
    ...(typeof sprint.state === "string" ? { state: sprint.state } : {}),
    ...(typeof sprint.startDate === "string"
      ? { start: sprint.startDate }
      : {}),
    ...(typeof sprint.endDate === "string" ? { end: sprint.endDate } : {}),
  };
}

export async function boardsCommand(
  args: string[],
  options: BoardsDependencies = dependencies,
): Promise<Record<string, unknown>> {
  const [subcommand, ...rest] = args;
  if (subcommand !== "list") throw usage("boards", "Use boards list");
  const values = flags("boards", rest, ["--project", "--account"]);
  const { account, client } = await clientFor(values.get("--account"), options);
  const project = values.get("--project");
  const boards = await client.listClassic<BoardDetails>("/board", "agile", 50, {
    projectKeyOrId: project,
  });
  return boardsResult(account, boards);
}

function boardsResult(
  account: Account,
  boards: BoardDetails[],
): Record<string, unknown> {
  return boards.length === 0
    ? {
        account: account.id,
        count: 0,
        boards: [],
        message: `No boards found for account ${account.id}`,
      }
    : {
        account: account.id,
        count: boards.length,
        boards: boards.map(boardRow),
        help: [
          `Run \`jra-axi sprints list --board ${boards[0].id}\` to list board sprints`,
          "Run `jra-axi boards list --project <KEY>` to limit boards by project",
        ],
      };
}

export async function sprintsCommand(
  args: string[],
  options: BoardsDependencies = dependencies,
): Promise<Record<string, unknown>> {
  const [subcommand, ...rest] = args;
  if (subcommand === "list") {
    const values = flags("sprints", rest, ["--board", "--state", "--account"]);
    const board = values.get("--board");
    if (!board) throw usage("sprints", "--board is required");
    const state = values.get("--state");
    if (state && !["active", "future", "closed"].includes(state))
      throw usage("sprints", "--state must be active, future, or closed");
    const { account, client } = await clientFor(
      values.get("--account"),
      options,
    );
    const sprints = await client.listClassic<SprintDetails>(
      `/board/${encodeURIComponent(board)}/sprint`,
      "agile",
      50,
      { state },
    );
    return sprints.length === 0
      ? {
          account: account.id,
          board,
          count: 0,
          sprints: [],
          message: `No sprints found for board ${board} on account ${account.id}`,
        }
      : {
          account: account.id,
          board,
          count: sprints.length,
          sprints: sprints.map(sprintRow),
          help: [
            `Run \`jra-axi sprints view ${sprints[0].id}\` to see sprint details`,
            `Run \`jra-axi sprints list --board ${board} --state active\` to show active sprints`,
          ],
          ...(state ? { state } : {}),
        };
  }
  if (subcommand === "view") {
    const id = rest[0];
    if (!id || id.startsWith("--"))
      throw usage("sprints", "sprints view requires ID");
    const values = flags("sprints", rest.slice(1), ["--account"]);
    const { account, client } = await clientFor(
      values.get("--account"),
      options,
    );
    const sprint = (await client.agile(
      `/sprint/${encodeURIComponent(id)}`,
    )) as SprintDetails;
    return {
      account: account.id,
      sprint: {
        ...sprintRow(sprint),
        ...(typeof sprint.completeDate === "string"
          ? { completed: sprint.completeDate }
          : {}),
        ...(typeof sprint.originBoardId === "number"
          ? { board: sprint.originBoardId }
          : {}),
      },
    };
  }
  throw usage("sprints", "Use sprints list --board <ID> or sprints view <ID>");
}
