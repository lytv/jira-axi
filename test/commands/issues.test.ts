import { describe, expect, it } from "vitest";
import { AxiError } from "axi-sdk-js";
import { toAdf } from "../../src/adf.js";
import { JiraClient, type FetchLike } from "../../src/client.js";
import { issuesCommand, type IssuesDeps } from "../../src/commands/issues.js";
import type { Account } from "../../src/types.js";

const account = (id: string, isDefault = false): Account => ({
  id,
  baseUrl: `https://${id}.atlassian.net`,
  email: "agent@example.com",
  tokenSource: { kind: "env", ref: "TOKEN" },
  default: isDefault,
  deployment: "cloud",
  authScheme: "basic",
});

type Call = { method: string; path: string; body?: unknown; query?: unknown };
type Route = {
  method?: string;
  path: string | RegExp;
  body?: unknown;
  status?: number;
};

function adfParagraph(text: string) {
  return {
    version: 1,
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

function fetcherFor(routes: Route[], calls: Call[]): FetchLike {
  const remaining = [...routes];
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname.replace(/^\/rest\/api\/3/, "");
    const query = Object.fromEntries(url.searchParams);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({
      method,
      path,
      body,
      query: Object.keys(query).length ? query : undefined,
    });
    const index = remaining.findIndex((route) => {
      const wanted = (route.method ?? "GET").toUpperCase();
      if (wanted !== method) return false;
      return typeof route.path === "string"
        ? path === route.path
        : route.path.test(path);
    });
    if (index === -1) throw new Error(`Unexpected ${method} ${path}`);
    const route = remaining.splice(index, 1)[0];
    const status = route.status ?? (route.body === undefined ? 204 : 200);
    return new Response(
      route.body === undefined ? undefined : JSON.stringify(route.body),
      { status, headers: { "content-type": "application/json" } },
    );
  }) as FetchLike;
}

function createDeps(
  routes: Route[],
  accounts: Account[] = [account("work", true)],
): { deps: IssuesDeps; calls: Call[] } {
  const calls: Call[] = [];
  const fetcher = fetcherFor(routes, calls);
  return {
    calls,
    deps: {
      readAccounts: async () => accounts,
      tokenForAccount: async () => "token",
      createClient: (item) => new JiraClient(item, "token", { fetcher }),
    },
  };
}

async function expectUsage(
  args: string[],
  deps: IssuesDeps,
  pattern: RegExp,
): Promise<AxiError> {
  try {
    await issuesCommand(args, deps);
  } catch (error) {
    expect(error).toBeInstanceOf(AxiError);
    const axi = error as AxiError;
    expect(axi.code).toBe("VALIDATION_ERROR");
    expect(axi.message).toMatch(pattern);
    return axi;
  }
  throw new Error("expected usage error");
}

describe("issues list", () => {
  it("lists issues with the default schema and approximate count", async () => {
    const { deps, calls } = createDeps([
      {
        method: "POST",
        path: "/search/jql",
        body: {
          issues: [
            {
              id: "1",
              key: "AXI-1",
              fields: {
                summary: "Fix auth",
                status: { name: "To Do" },
                assignee: { displayName: "Ada", accountId: "ada" },
              },
            },
            {
              id: "2",
              key: "AXI-2",
              fields: {
                summary: "Add pager",
                status: { name: "In Progress" },
                assignee: null,
              },
            },
          ],
        },
      },
      {
        method: "POST",
        path: "/search/approximate-count",
        body: { count: 12 },
      },
    ]);
    const result = await issuesCommand(["list", "--project", "AXI"], deps);
    expect(result.count).toBe("2 of 12 total (approximate)");
    expect(result.issues).toEqual([
      {
        key: "AXI-1",
        summary: "Fix auth",
        status: "To Do",
        assignee: "Ada",
      },
      {
        key: "AXI-2",
        summary: "Add pager",
        status: "In Progress",
        assignee: null,
      },
    ]);
    expect(result.help).toEqual([
      "Run `jra-axi issues view <key>` for details",
    ]);
    expect(calls[0].body).toMatchObject({
      jql: "project = AXI ORDER BY updated DESC",
      fields: ["summary", "status", "assignee"],
    });
    expect(JSON.stringify(calls[0].body)).not.toContain("startAt");
  });

  it("names the JQL and account id when the list is empty", async () => {
    const { deps, calls } = createDeps([
      { method: "POST", path: "/search/jql", body: { issues: [] } },
    ]);
    const result = await issuesCommand(
      ["list", "--jql", "project = EMPTY"],
      deps,
    );
    expect(result.issues).toBe(
      '0 results for JQL "(project = EMPTY)" on account work',
    );
    expect(
      calls.some((call) => call.path === "/search/approximate-count"),
    ).toBe(false);
  });
});

describe("issues view", () => {
  const longText = "x".repeat(801);
  const exactText = "y".repeat(800);

  it("truncates description and comments and suggests --full", async () => {
    const { deps } = createDeps([
      {
        path: "/issue/AXI-1",
        body: {
          id: "1",
          key: "AXI-1",
          fields: {
            summary: "Fix auth",
            status: { name: "To Do" },
            assignee: { displayName: "Ada", accountId: "ada" },
            description: adfParagraph(longText),
            comment: {
              total: 1,
              comments: [
                {
                  id: "10",
                  body: adfParagraph(longText),
                  author: { accountId: "ada", displayName: "Ada" },
                },
              ],
            },
            issuelinks: [{ id: "l1" }, { id: "l2" }],
            parent: { key: "AXI-100" },
          },
        },
      },
    ]);
    const result = await issuesCommand(["view", "AXI-1"], deps);
    const issue = result.issue as Record<string, unknown>;
    expect(issue.comments).toBe(1);
    expect(issue.links).toBe(2);
    expect(issue.parent).toBe("AXI-100");
    expect(String(issue.description)).toContain("... [801 chars; use --full]");
    expect(issue.help).toEqual([
      "Run `jra-axi issues view AXI-1 --full` for the complete text",
    ]);
  });

  it("keeps an 800-character description untruncated", async () => {
    const { deps } = createDeps([
      {
        path: "/issue/AXI-1",
        body: {
          id: "1",
          key: "AXI-1",
          fields: {
            summary: "Fix auth",
            status: { name: "To Do" },
            assignee: null,
            description: adfParagraph(exactText),
            comment: { total: 0, comments: [] },
            issuelinks: [],
          },
        },
      },
    ]);
    const result = await issuesCommand(["view", "AXI-1"], deps);
    const issue = result.issue as Record<string, unknown>;
    expect(issue.description).toBe(exactText);
    expect(issue.help).toBeUndefined();
    expect(issue.parent).toBeUndefined();
  });

  it("omits next-step help when an untruncated description mentions --full", async () => {
    const { deps } = createDeps([
      {
        path: "/issue/AXI-1",
        body: {
          id: "1",
          key: "AXI-1",
          fields: {
            summary: "Fix auth",
            status: { name: "To Do" },
            assignee: null,
            description: adfParagraph("Please use --full here for details"),
            comment: { total: 0, comments: [] },
            issuelinks: [],
          },
        },
      },
    ]);
    const result = await issuesCommand(["view", "AXI-1"], deps);
    const issue = result.issue as Record<string, unknown>;
    expect(issue.description).toBe("Please use --full here for details");
    expect(issue.help).toBeUndefined();
  });

  it("omits next-step help when --full shows complete text", async () => {
    const { deps } = createDeps([
      {
        path: "/issue/AXI-1",
        body: {
          id: "1",
          key: "AXI-1",
          fields: {
            summary: "Fix auth",
            status: { name: "To Do" },
            assignee: null,
            description: adfParagraph(longText),
            comment: { total: 0, comments: [] },
            issuelinks: [],
          },
        },
      },
    ]);
    const result = await issuesCommand(["view", "AXI-1", "--full"], deps);
    const issue = result.issue as Record<string, unknown>;
    expect(issue.description).toBe(longText);
    expect(issue.help).toBeUndefined();
  });
});

describe("issues create", () => {
  it("fails with a structured error when a required field is missing", async () => {
    const { deps, calls } = createDeps([
      {
        path: "/issue/createmeta/AXI/issuetypes",
        body: {
          issueTypes: [{ id: "10001", name: "Bug" }],
        },
      },
      {
        path: "/issue/createmeta/AXI/issuetypes/10001",
        body: {
          fields: [
            { key: "project", name: "Project", required: true },
            { key: "issuetype", name: "Issue Type", required: true },
            { key: "summary", name: "Summary", required: true },
            { key: "customfield_10001", name: "Story Points", required: true },
          ],
        },
      },
    ]);
    const error = await expectUsage(
      ["create", "--project", "AXI", "--type", "Bug", "--summary", "Crash"],
      deps,
      /Missing required fields: customfield_10001 \(Story Points\)/,
    );
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(
      calls.some((call) => call.method === "POST" && call.path === "/issue"),
    ).toBe(false);
  });

  it("encodes description as ADF after the issue type is valid", async () => {
    const { deps, calls } = createDeps([
      {
        path: "/issue/createmeta/AXI/issuetypes",
        body: { issueTypes: [{ id: "10002", name: "Task" }] },
      },
      {
        path: "/issue/createmeta/AXI/issuetypes/10002",
        body: {
          fields: [
            { key: "summary", name: "Summary", required: true },
            { key: "description", name: "Description", required: false },
          ],
        },
      },
      {
        method: "POST",
        path: "/issue",
        body: { id: "3", key: "AXI-3" },
      },
    ]);
    const result = await issuesCommand(
      [
        "create",
        "--project",
        "AXI",
        "--type",
        "Task",
        "--summary",
        "Fix login",
        "--description",
        "Steps",
      ],
      deps,
    );
    expect(result.created).toBe("AXI-3");
    expect(calls.at(-1)?.body).toMatchObject({
      fields: {
        project: { key: "AXI" },
        issuetype: { id: "10002" },
        summary: "Fix login",
        description: toAdf("Steps"),
      },
    });
  });
});

describe("issues transition", () => {
  it("is a no-op when the issue is already in the target status", async () => {
    const { deps, calls } = createDeps([
      {
        path: "/issue/AXI-1",
        body: {
          id: "1",
          key: "AXI-1",
          fields: { status: { name: "In Progress" } },
        },
      },
    ]);
    const result = await issuesCommand(
      ["transition", "AXI-1", "--status", "In Progress"],
      deps,
    );
    expect(result).toEqual({
      issue: "AXI-1",
      status: "already In Progress (no-op)",
    });
    expect(calls.some((call) => call.path.includes("/transitions"))).toBe(
      false,
    );
  });

  it("names missing transition fields instead of posting", async () => {
    const { deps, calls } = createDeps([
      {
        path: "/issue/AXI-1",
        body: {
          id: "1",
          key: "AXI-1",
          fields: { status: { name: "In Progress" } },
        },
      },
      {
        path: "/issue/AXI-1/transitions",
        body: {
          transitions: [
            {
              id: "31",
              name: "Done",
              to: { name: "Done" },
              fields: {
                resolution: { required: true, name: "Resolution" },
              },
            },
          ],
        },
      },
    ]);
    await expectUsage(
      ["transition", "AXI-1", "--status", "Done"],
      deps,
      /Missing required fields: Resolution/,
    );
    expect(
      calls.some(
        (call) => call.method === "POST" && call.path.endsWith("/transitions"),
      ),
    ).toBe(false);
  });

  it("lists available transitions", async () => {
    const { deps } = createDeps([
      {
        path: "/issue/AXI-1/transitions",
        body: {
          transitions: [
            { id: "21", name: "In Progress", to: { name: "In Progress" } },
          ],
        },
      },
    ]);
    const result = await issuesCommand(["transition", "AXI-1", "--list"], deps);
    expect(result.transitions).toEqual([
      { id: "21", name: "In Progress", to: "In Progress" },
    ]);
  });
});

describe("issues assign", () => {
  it("is a no-op when assigning to the current assignee", async () => {
    const { deps, calls } = createDeps([
      {
        path: "/issue/AXI-1",
        body: {
          id: "1",
          key: "AXI-1",
          fields: { assignee: { accountId: "ada" } },
        },
      },
    ]);
    const result = await issuesCommand(
      ["assign", "AXI-1", "--to", "ada"],
      deps,
    );
    expect(result).toEqual({
      issue: "AXI-1",
      assignee: "already ada (no-op)",
    });
    expect(calls.some((call) => call.path.endsWith("/assignee"))).toBe(false);
  });
});

describe("issues comment", () => {
  it("adds, lists, edits, and deletes comments", async () => {
    const add = createDeps([
      {
        method: "POST",
        path: "/issue/AXI-1/comment",
        body: { id: "10" },
      },
    ]);
    const added = await issuesCommand(
      ["comment", "AXI-1", "--body", "Started"],
      add.deps,
    );
    expect(added.added).toBe("10");
    expect(add.calls[0].body).toEqual({ body: toAdf("Started") });

    const list = createDeps([
      {
        path: "/issue/AXI-1/comment",
        body: {
          comments: [
            {
              id: "10",
              body: adfParagraph("Started"),
              author: { displayName: "Ada", accountId: "ada" },
            },
          ],
        },
      },
    ]);
    const listed = await issuesCommand(["comment", "AXI-1", "list"], list.deps);
    expect(listed.comments).toEqual([
      { id: "10", author: "Ada", body: "Started" },
    ]);

    const edit = createDeps([
      { method: "PUT", path: "/issue/AXI-1/comment/10", body: { id: "10" } },
    ]);
    const edited = await issuesCommand(
      ["comment", "AXI-1", "edit", "10", "--body", "Updated", "--yes"],
      edit.deps,
    );
    expect(edited.edited).toBe("10");

    const remove = createDeps([
      { method: "DELETE", path: "/issue/AXI-1/comment/10" },
    ]);
    const deleted = await issuesCommand(
      ["comment", "AXI-1", "delete", "10", "--yes"],
      remove.deps,
    );
    expect(deleted.deleted).toBe("10");
  });

  it("requires --yes for comment delete", async () => {
    const { deps, calls } = createDeps([]);
    await expectUsage(
      ["comment", "AXI-1", "delete", "10"],
      deps,
      /comment delete requires --yes/,
    );
    expect(calls).toHaveLength(0);
  });
});

describe("issues link", () => {
  it("is a no-op when the exact link already exists", async () => {
    const { deps, calls } = createDeps([
      {
        path: "/issue/AXI-1",
        body: {
          id: "1",
          key: "AXI-1",
          fields: {
            issuelinks: [
              {
                id: "100",
                type: { name: "Blocks" },
                inwardIssue: { key: "AXI-2" },
              },
            ],
          },
        },
      },
    ]);
    const result = await issuesCommand(
      ["link", "AXI-1", "--to", "AXI-2", "--type", "Blocks"],
      deps,
    );
    expect(result).toEqual({
      issue: "AXI-1",
      link: "already linked to AXI-2 as Blocks (no-op)",
    });
    expect(calls.some((call) => call.path === "/issueLink")).toBe(false);
  });

  it("unlinks with --yes", async () => {
    const { deps } = createDeps([{ method: "DELETE", path: "/issueLink/100" }]);
    const result = await issuesCommand(
      ["link", "AXI-1", "unlink", "100", "--yes"],
      deps,
    );
    expect(result).toEqual({ unlinked: "100", issue: "AXI-1" });
  });
});

describe("issues worklog", () => {
  it("posts an ADF-encoded worklog and is not a no-op", async () => {
    const { deps, calls } = createDeps([
      {
        method: "POST",
        path: "/issue/AXI-1/worklog",
        body: { id: "w1" },
      },
    ]);
    const result = await issuesCommand(
      ["worklog", "AXI-1", "--time", "2h", "--comment", "Pairing"],
      deps,
    );
    expect(result.worklog).toBe("w1");
    expect(calls[0].body).toEqual({
      timeSpent: "2h",
      comment: toAdf("Pairing"),
    });
  });
});

describe("issues account resolution", () => {
  it("exits 2 for a single-key command when no account is selected", async () => {
    const { deps, calls } = createDeps([], [account("one"), account("two")]);
    const error = await expectUsage(
      ["view", "AXI-1"],
      deps,
      /Select an account with --account. Configured accounts: one, two/,
    );
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(calls).toHaveLength(0);
  });

  it("exits 2 for a mutation when no account is selected", async () => {
    const { deps } = createDeps([], [account("one"), account("two")]);
    await expectUsage(
      ["assign", "AXI-1", "--to", "none"],
      deps,
      /Configured accounts: one, two/,
    );
  });
});

describe("issues help", () => {
  it("documents flags, defaults, examples, and non-idempotent comment and worklog commands", async () => {
    const list = await issuesCommand(["list", "--help"]);
    expect(list.flags).toMatchObject({
      "--jql": expect.any(String),
      "--project": expect.any(String),
      "--limit": expect.stringContaining("50"),
    });
    expect(list.examples).toHaveLength(3);

    const comment = await issuesCommand(["comment", "--help"]);
    expect(String(comment.idempotency)).toMatch(/not idempotent/i);

    const worklog = await issuesCommand(["worklog", "--help"]);
    expect(String(worklog.idempotency)).toMatch(/not idempotent/i);

    const create = await issuesCommand(["create", "--help"]);
    expect(String(create.idempotency)).toMatch(/not idempotent/i);
  });
});

describe("issues meta", () => {
  it("surfaces required fields and valid issue types", async () => {
    const { deps } = createDeps([
      {
        path: "/issue/createmeta/AXI/issuetypes",
        body: { issueTypes: [{ id: "10001", name: "Bug" }] },
      },
      {
        path: "/issue/createmeta/AXI/issuetypes/10001",
        body: {
          fields: [
            { key: "summary", name: "Summary", required: true },
            { key: "customfield_10001", name: "Story Points", required: true },
          ],
        },
      },
    ]);
    const result = await issuesCommand(
      ["meta", "--project", "AXI", "--type", "Bug"],
      deps,
    );
    expect(result.required).toEqual([
      { key: "summary", name: "Summary" },
      { key: "customfield_10001", name: "Story Points" },
    ]);
  });
});
