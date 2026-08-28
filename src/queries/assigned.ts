import { readAccounts, tokenForAccount } from "../accounts.js";
import { JiraClient } from "../client.js";
import type { Account, JiraIssue } from "../types.js";

export const DEFAULT_ISSUE_LIMIT = 10;
export const ASSIGNED_JQL =
  "assignee = currentUser() AND resolution = Unresolved";
export const OVERDUE_JQL = `${ASSIGNED_JQL} AND duedate < now()`;
export const IN_REVIEW_JQL = `${ASSIGNED_JQL} AND (status = "In Review" OR status = "Review")`;
export const BLOCKED_JQL = `${ASSIGNED_JQL} AND (status = Blocked OR status = "Blocked")`;
export const ASSIGNED_ISSUE_JQL = `${ASSIGNED_JQL} ORDER BY updated DESC`;
const COUNT_FIELDS = ["key", "status", "duedate"];
const ISSUE_FIELDS = ["summary", "status", "duedate"];

export type AssignedIssue = {
  key: string;
  summary: string;
  status: string;
};

export type AssignedAccountSummary = {
  accountId: string;
  assigned: number;
  overdue: number;
  inReview: number;
  blocked: number;
  issues: AssignedIssue[];
  status?: "connected" | "expired" | "unreachable";
  error?: string;
};

export type AssignedClient = Pick<
  JiraClient,
  "searchJql" | "approximateSearchCount"
>;

export type AssignedQueryDeps = {
  readAccounts?: () => Promise<Account[]>;
  tokenForAccount?: (account: Account) => Promise<string>;
  createClient?: (account: Account, token: string) => AssignedClient;
  issueLimit?: number;
};

function named(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const name = (value as { name?: unknown }).name;
  return typeof name === "string" ? name : undefined;
}

function issueRow(issue: JiraIssue): AssignedIssue {
  return {
    key: issue.key,
    summary:
      typeof issue.fields.summary === "string" ? issue.fields.summary : "",
    status: named(issue.fields.status) ?? "",
  };
}

function errorStatus(message: string): "expired" | "unreachable" {
  return /401|rejected|unauthorized/i.test(message) ? "expired" : "unreachable";
}

async function countJql(client: AssignedClient, jql: string): Promise<number> {
  try {
    const count = await client.approximateSearchCount(jql);
    if (typeof count === "number") return count;
  } catch {
    /* Fall back to a bounded search. */
  }
  const { issues } = await client.searchJql(jql, COUNT_FIELDS, 50, 50);
  return issues.length;
}

async function optionalCount(
  client: AssignedClient,
  jql: string,
): Promise<number> {
  try {
    return await countJql(client, jql);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/value .+ does not exist for the field ["']?status/i.test(message)) {
      return 0;
    }
    throw error;
  }
}

async function summaryForAccount(
  account: Account,
  deps: AssignedQueryDeps,
): Promise<AssignedAccountSummary> {
  const limit = deps.issueLimit ?? DEFAULT_ISSUE_LIMIT;
  try {
    const token = await (deps.tokenForAccount ?? tokenForAccount)(account);
    const client = (deps.createClient ?? defaultClient)(account, token);
    const assigned = await countJql(client, ASSIGNED_JQL);
    if (assigned === 0) {
      return {
        accountId: account.id,
        assigned: 0,
        overdue: 0,
        inReview: 0,
        blocked: 0,
        issues: [],
        status: "connected",
      };
    }
    const overdue = await countJql(client, OVERDUE_JQL);
    const inReview = await optionalCount(client, IN_REVIEW_JQL);
    const blocked = await optionalCount(client, BLOCKED_JQL);
    const { issues } = await client.searchJql(
      ASSIGNED_ISSUE_JQL,
      ISSUE_FIELDS,
      Math.min(50, limit),
      limit,
    );
    return {
      accountId: account.id,
      assigned,
      overdue,
      inReview,
      blocked,
      issues: issues.slice(0, limit).map(issueRow),
      status: "connected",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      accountId: account.id,
      assigned: 0,
      overdue: 0,
      inReview: 0,
      blocked: 0,
      issues: [],
      status: errorStatus(message),
      error: message,
    };
  }
}

function defaultClient(account: Account, token: string): AssignedClient {
  return new JiraClient(account, token);
}

export async function assignedSummaries(
  deps: AssignedQueryDeps = {},
): Promise<AssignedAccountSummary[]> {
  const accounts = await (deps.readAccounts ?? readAccounts)();
  const summaries: AssignedAccountSummary[] = [];
  for (const account of accounts) {
    summaries.push(await summaryForAccount(account, deps));
  }
  return summaries;
}
