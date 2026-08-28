import { describe, expect, it } from "vitest";
import { JiraClient, type FetchLike } from "../../src/client.js";
import {
  ASSIGNED_ISSUE_JQL,
  ASSIGNED_JQL,
  BLOCKED_JQL,
  IN_REVIEW_JQL,
  OVERDUE_JQL,
  assignedSummaries,
  type AssignedClient,
} from "../../src/queries/assigned.js";
import type { Account } from "../../src/types.js";

const account = (id: string): Account => ({
  id,
  baseUrl: `https://${id}.atlassian.net`,
  email: "agent@example.com",
  tokenSource: { kind: "env", ref: "TOKEN" },
  default: false,
  deployment: "cloud",
  authScheme: "basic",
});

type Call = { method: string; path: string; jql?: string };

function issue(key: string, summary: string, status: string) {
  return {
    id: key,
    key,
    fields: { summary, status: { name: status } },
  };
}

function errorResponse(message: string): Response {
  return new Response(JSON.stringify({ errorMessages: [message] }), {
    status: 400,
    headers: { "content-type": "application/json" },
  });
}

function fetcherFor(
  counts: Record<string, number | Error>,
  issuesByJql: Record<string, ReturnType<typeof issue>[] | Error>,
  calls: Call[],
): FetchLike {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname.replace(/^\/rest\/api\/3/, "");
    const body = init?.body
      ? (JSON.parse(String(init.body)) as { jql?: string })
      : {};
    const jql = body.jql;
    calls.push({ method, path, jql });
    if (path === "/search/approximate-count") {
      const result = counts[jql ?? ""];
      if (result instanceof Error) return errorResponse(result.message);
      return new Response(JSON.stringify({ count: result ?? 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (path === "/search/jql") {
      const issues = issuesByJql[jql ?? ""];
      if (issues instanceof Error) return errorResponse(issues.message);
      return new Response(JSON.stringify({ issues: issues ?? [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`Unexpected ${method} ${path}`);
  }) as FetchLike;
}

function depsFor(
  accounts: Account[],
  counts: Record<string, number | Error>,
  issuesByJql: Record<string, ReturnType<typeof issue>[] | Error>,
  calls: Call[],
) {
  const fetcher = fetcherFor(counts, issuesByJql, calls);
  return {
    readAccounts: async () => accounts,
    tokenForAccount: async () => "token",
    createClient: (item: Account) => new JiraClient(item, "token", { fetcher }),
  };
}

describe("assignedSummaries", () => {
  it("returns per-account counts and capped issues ordered by the assigned query", async () => {
    const calls: Call[] = [];
    const summaries = await assignedSummaries(
      depsFor(
        [account("work")],
        {
          [ASSIGNED_JQL]: 12,
          [OVERDUE_JQL]: 2,
          [IN_REVIEW_JQL]: 1,
          [BLOCKED_JQL]: 0,
        },
        {
          [ASSIGNED_ISSUE_JQL]: [
            issue("AXI-2", "Newer", "In Progress"),
            issue("AXI-1", "Older", "To Do"),
          ],
        },
        calls,
      ),
    );
    expect(summaries).toEqual([
      {
        accountId: "work",
        assigned: 12,
        overdue: 2,
        inReview: 1,
        blocked: 0,
        issues: [
          { key: "AXI-2", summary: "Newer", status: "In Progress" },
          { key: "AXI-1", summary: "Older", status: "To Do" },
        ],
        status: "connected",
      },
    ]);
    expect(calls.some((call) => call.jql === ASSIGNED_JQL)).toBe(true);
    expect(calls.some((call) => call.jql === OVERDUE_JQL)).toBe(true);
    expect(calls.some((call) => call.jql === IN_REVIEW_JQL)).toBe(true);
    expect(calls.some((call) => call.jql === BLOCKED_JQL)).toBe(true);
    expect(calls.some((call) => call.jql === ASSIGNED_ISSUE_JQL)).toBe(true);
  });

  it("skips extra queries when assigned count is 0", async () => {
    const calls: Call[] = [];
    const summaries = await assignedSummaries(
      depsFor([account("work")], { [ASSIGNED_JQL]: 0 }, {}, calls),
    );
    expect(summaries).toEqual([
      {
        accountId: "work",
        assigned: 0,
        overdue: 0,
        inReview: 0,
        blocked: 0,
        issues: [],
        status: "connected",
      },
    ]);
    expect(calls.every((call) => call.jql === ASSIGNED_JQL)).toBe(true);
  });

  it("degrades in-review to 0 when the site has no such status", async () => {
    const calls: Call[] = [];
    const summaries = await assignedSummaries(
      depsFor(
        [account("work")],
        {
          [ASSIGNED_JQL]: 3,
          [OVERDUE_JQL]: 0,
          [IN_REVIEW_JQL]: new Error(
            'The value "In Review" does not exist for the field "status".',
          ),
          [BLOCKED_JQL]: 1,
        },
        {
          [IN_REVIEW_JQL]: new Error(
            'The value "In Review" does not exist for the field "status".',
          ),
          [ASSIGNED_ISSUE_JQL]: [issue("AXI-1", "Fix auth", "To Do")],
        },
        calls,
      ),
    );
    expect(summaries[0].inReview).toBe(0);
    expect(summaries[0].assigned).toBe(3);
    expect(summaries[0].blocked).toBe(1);
    expect(summaries[0].status).toBe("connected");
  });

  it("marks an account unreachable when an optional count fails", async () => {
    const summaries = await assignedSummaries(
      depsFor(
        [account("work")],
        {
          [ASSIGNED_JQL]: 3,
          [OVERDUE_JQL]: 0,
          [IN_REVIEW_JQL]: new Error("Jira rate limited /search/jql"),
        },
        { [IN_REVIEW_JQL]: new Error("Jira rate limited /search/jql") },
        [],
      ),
    );
    expect(summaries[0]).toMatchObject({
      accountId: "work",
      status: "unreachable",
      assigned: 0,
      issues: [],
    });
  });

  it("serializes per-account calls and does not fail the whole view on one error", async () => {
    const order: string[] = [];
    let inflight = 0;
    let maxInflight = 0;
    const work: AssignedClient = {
      approximateSearchCount: async () => {
        inflight++;
        maxInflight = Math.max(maxInflight, inflight);
        order.push("work-start");
        await Promise.resolve();
        inflight--;
        order.push("work-end");
        return 1;
      },
      searchJql: async () => ({
        issues: [issue("AXI-1", "Fix", "To Do")],
      }),
    };
    const personal: AssignedClient = {
      approximateSearchCount: async () => {
        inflight++;
        maxInflight = Math.max(maxInflight, inflight);
        order.push("personal-start");
        inflight--;
        throw new Error("401 unauthorized");
      },
      searchJql: async () => {
        throw new Error("401 unauthorized");
      },
    };
    const summaries = await assignedSummaries({
      readAccounts: async () => [account("work"), account("personal")],
      tokenForAccount: async () => "token",
      createClient: (item) => (item.id === "work" ? work : personal),
    });
    expect(maxInflight).toBe(1);
    expect(order.indexOf("work-end")).toBeLessThan(
      order.indexOf("personal-start"),
    );
    expect(summaries[0].status).toBe("connected");
    expect(summaries[1]).toMatchObject({
      accountId: "personal",
      status: "expired",
      assigned: 0,
      issues: [],
    });
  });

  it("caps the issue list at the default of 10", async () => {
    const many = Array.from({ length: 15 }, (_, index) =>
      issue(`AXI-${index + 1}`, `Item ${index + 1}`, "To Do"),
    );
    const summaries = await assignedSummaries(
      depsFor(
        [account("work")],
        {
          [ASSIGNED_JQL]: 15,
          [OVERDUE_JQL]: 0,
          [IN_REVIEW_JQL]: 0,
          [BLOCKED_JQL]: 0,
        },
        { [ASSIGNED_ISSUE_JQL]: many },
        [],
      ),
    );
    expect(summaries[0].issues).toHaveLength(10);
    expect(summaries[0].issues[0].key).toBe("AXI-1");
    expect(summaries[0].issues[9].key).toBe("AXI-10");
  });
});
