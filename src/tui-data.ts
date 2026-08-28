import { JiraClient } from "./client.js";
import { tokenForAccount } from "./accounts.js";
import type { Account } from "./types.js";

/**
 * Human dashboard data loader: presentation only. Every field here is
 * something the TOON/JSON surfaces can already report; this module derives
 * nothing new from Jira, it just shapes per-account reads for the renderer.
 */

export type ConnectionStatus = "connected" | "expired" | "unreachable";

export type AccountSummary = {
  id: string;
  site: string;
  email: string;
  connection: ConnectionStatus;
  detail?: string;
  assigned?: number;
  overdue?: number;
  inReview?: number;
  blocked?: number;
  sprint?: { name: string; daysLeft?: number };
};

export type TuiSummary = {
  generatedAt: string;
  accounts: AccountSummary[];
};

export type TuiClient = Pick<
  JiraClient,
  "rest" | "approximateSearchCount" | "listClassic"
>;

export type TuiDataDeps = {
  tokenForAccount: (account: Account) => Promise<string>;
  createClient: (account: Account, token: string) => TuiClient;
};

const defaultDeps: TuiDataDeps = {
  tokenForAccount,
  createClient: (account, token) => new JiraClient(account, token),
};

const MINE = "assignee = currentUser()";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function safeCount(client: TuiClient, jql: string): Promise<number> {
  try {
    return (await client.approximateSearchCount(jql)) ?? 0;
  } catch {
    return 0;
  }
}

type SprintDetails = { id: number; name: string; endDate?: unknown };

async function loadSprint(
  client: TuiClient,
  boardId: string,
): Promise<{ name: string; daysLeft?: number } | undefined> {
  try {
    const sprints = await client.listClassic<SprintDetails>(
      `/board/${encodeURIComponent(boardId)}/sprint`,
      "agile",
      50,
      { state: "active" },
    );
    const active = sprints[0];
    if (!active) return undefined;
    const end =
      typeof active.endDate === "string" ? Date.parse(active.endDate) : NaN;
    if (!Number.isFinite(end)) return { name: active.name };
    const daysLeft = Math.max(0, Math.ceil((end - Date.now()) / 86_400_000));
    return { name: active.name, daysLeft };
  } catch {
    return undefined;
  }
}

async function loadAccountSummary(
  account: Account,
  deps: TuiDataDeps,
): Promise<AccountSummary> {
  const base = { id: account.id, site: account.baseUrl, email: account.email };
  let token: string;
  try {
    token = await deps.tokenForAccount(account);
  } catch (error) {
    return { ...base, connection: "unreachable", detail: messageOf(error) };
  }
  const client = deps.createClient(account, token);
  try {
    await client.rest("/myself");
  } catch (error) {
    const message = messageOf(error);
    return {
      ...base,
      connection: /401|rejected|unauthorized/i.test(message)
        ? "expired"
        : "unreachable",
      detail: message,
    };
  }
  const assigned = await safeCount(client, `${MINE} AND resolution = Unresolved`);
  const overdue = await safeCount(
    client,
    `${MINE} AND resolution = Unresolved AND duedate < now()`,
  );
  const inReview = await safeCount(
    client,
    `${MINE} AND resolution = Unresolved AND (status = "In Review" OR status = "Review")`,
  );
  const blocked = await safeCount(
    client,
    `${MINE} AND resolution = Unresolved AND status = Blocked`,
  );
  const sprint = account.defaultBoardId
    ? await loadSprint(client, account.defaultBoardId)
    : undefined;
  return {
    ...base,
    connection: "connected",
    assigned,
    overdue,
    inReview,
    blocked,
    ...(sprint ? { sprint } : {}),
  };
}

/** Loads one account at a time; never fans out requests across accounts. */
export async function loadTuiSummary(
  accounts: Account[],
  deps: TuiDataDeps = defaultDeps,
): Promise<TuiSummary> {
  const rows: AccountSummary[] = [];
  for (const account of accounts) rows.push(await loadAccountSummary(account, deps));
  return { generatedAt: new Date().toISOString(), accounts: rows };
}
