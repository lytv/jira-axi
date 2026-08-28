import { AxiError } from "axi-sdk-js";
import {
  assignedSummaries,
  type AssignedAccountSummary,
  type AssignedQueryDeps,
} from "../queries/assigned.js";
import { render } from "../render.js";

export const HOME_HELP = `usage: jra-axi home [flags]
description: Show assigned-to-me issues across configured Jira Cloud accounts
flags:
  --json                       JSON output instead of TOON
examples:
  jra-axi
  jra-axi home
  jra-axi home --json
`;

export type HomeDeps = AssignedQueryDeps;

function usage(message: string, suggestions: string[] = []): AxiError {
  return new AxiError(message, "VALIDATION_ERROR", suggestions);
}

function presentAccount(
  summary: AssignedAccountSummary,
): Record<string, unknown> {
  if (summary.status && summary.status !== "connected") {
    return {
      account: summary.accountId,
      status: summary.status,
      ...(summary.error ? { detail: summary.error } : {}),
    };
  }
  const counts = {
    account: summary.accountId,
    status: "connected",
    assigned: summary.assigned,
    overdue: summary.overdue,
    inReview: summary.inReview,
    blocked: summary.blocked,
  };
  if (summary.issues.length === 0) {
    return {
      ...counts,
      issues: `0 assigned issues on account ${summary.accountId}`,
    };
  }
  return { ...counts, issues: summary.issues };
}

function firstIssueKey(summaries: AssignedAccountSummary[]): string {
  for (const summary of summaries) {
    if (summary.issues[0]?.key) return summary.issues[0].key;
  }
  return "<KEY>";
}

export function homePayload(
  summaries: AssignedAccountSummary[],
): Record<string, unknown> {
  if (summaries.length === 0) {
    return {
      accounts: "No Jira Cloud accounts configured",
      help: [
        "Run `jra-axi accounts add --help` to add a Jira Cloud account",
        "Run `jra-axi accounts list`",
        "Run `jra-axi --help`",
      ],
    };
  }
  return {
    accounts: summaries.map(presentAccount),
    help: [
      `Run \`jra-axi issues view ${firstIssueKey(summaries)}\``,
      "Run `jra-axi accounts list`",
      "Run `jra-axi --help`",
    ],
  };
}

export async function homeCommand(
  args: string[] = [],
  deps: HomeDeps = {},
): Promise<Record<string, unknown> | string> {
  const json = args.includes("--json");
  if (args.some((arg) => arg !== "--json"))
    throw usage("home accepts only --json", ["Run `jra-axi home --json`"]);
  const payload = homePayload(await assignedSummaries(deps));
  return json ? render(payload, true) : payload;
}
