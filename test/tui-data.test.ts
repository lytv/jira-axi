import { describe, expect, it } from "vitest";
import { loadTuiSummary, type TuiClient } from "../src/tui-data.js";
import type { Account } from "../src/types.js";

const account = (id: string, defaultBoardId?: string): Account => ({
  id,
  baseUrl: `https://${id}.atlassian.net`,
  email: "agent@example.com",
  tokenSource: { kind: "env", ref: "TUI_FIXTURE_TOKEN" },
  default: false,
  deployment: "cloud",
  authScheme: "basic",
  ...(defaultBoardId ? { defaultBoardId } : {}),
});

function fakeClient(counts: Record<string, number>): TuiClient {
  return {
    rest: async () => ({ accountId: "me" }),
    approximateSearchCount: async (jql: string) => {
      for (const [needle, count] of Object.entries(counts)) {
        if (jql.includes(needle)) return count;
      }
      return 0;
    },
    listClassic: async () => [],
  };
}

describe("loadTuiSummary", () => {
  it("loads assigned, overdue, in-review, and blocked counts for a connected account", async () => {
    const summary = await loadTuiSummary([account("work")], {
      tokenForAccount: async () => "token",
      createClient: () =>
        fakeClient({
          "duedate < now()": 2,
          "In Review": 3,
          Blocked: 1,
          "resolution = Unresolved": 12,
        }),
    });
    expect(summary.accounts).toEqual([
      {
        id: "work",
        site: "https://work.atlassian.net",
        email: "agent@example.com",
        connection: "connected",
        assigned: 12,
        overdue: 2,
        inReview: 3,
        blocked: 1,
      },
    ]);
  });

  it("loads the active sprint only when defaultBoardId is set", async () => {
    const client: TuiClient = {
      rest: async () => ({ accountId: "me" }),
      approximateSearchCount: async () => 0,
      listClassic: async () => [
        { id: 1, name: "Sprint 24", endDate: new Date(Date.now() + 3 * 86_400_000).toISOString() },
      ],
    };
    const withBoard = await loadTuiSummary([account("work", "42")], {
      tokenForAccount: async () => "token",
      createClient: () => client,
    });
    expect(withBoard.accounts[0].sprint).toEqual({
      name: "Sprint 24",
      daysLeft: 3,
    });

    const withoutBoard = await loadTuiSummary([account("work")], {
      tokenForAccount: async () => "token",
      createClient: () => client,
    });
    expect(withoutBoard.accounts[0].sprint).toBeUndefined();
  });

  it("marks an expired token as expired and skips counts", async () => {
    const summary = await loadTuiSummary([account("work")], {
      tokenForAccount: async () => "token",
      createClient: () => ({
        rest: async () => {
          throw new Error("401 unauthorized");
        },
        approximateSearchCount: async () => 0,
        listClassic: async () => [],
      }),
    });
    expect(summary.accounts[0]).toEqual({
      id: "work",
      site: "https://work.atlassian.net",
      email: "agent@example.com",
      connection: "expired",
      detail: "401 unauthorized",
    });
  });

  it("marks an unreachable account when the token source fails", async () => {
    const summary = await loadTuiSummary([account("work")], {
      tokenForAccount: async () => {
        throw new Error("network unavailable");
      },
      createClient: () => fakeClient({}),
    });
    expect(summary.accounts[0].connection).toBe("unreachable");
    expect(summary.accounts[0].detail).toBe("network unavailable");
  });

  it("defaults a count to 0 when its JQL fails instead of failing the whole card", async () => {
    const summary = await loadTuiSummary([account("work")], {
      tokenForAccount: async () => "token",
      createClient: () => ({
        rest: async () => ({ accountId: "me" }),
        approximateSearchCount: async (jql: string) => {
          if (jql.includes("Blocked")) throw new Error("status does not exist");
          return 0;
        },
        listClassic: async () => [],
      }),
    });
    expect(summary.accounts[0].connection).toBe("connected");
    expect(summary.accounts[0].blocked).toBe(0);
  });

  it("loads accounts one at a time in order", async () => {
    const order: string[] = [];
    const track = (id: string): TuiClient => ({
      rest: async () => {
        order.push(id);
        return { accountId: "me" };
      },
      approximateSearchCount: async () => 0,
      listClassic: async () => [],
    });
    await loadTuiSummary([account("one"), account("two")], {
      tokenForAccount: async () => "token",
      createClient: (acc) => track(acc.id),
    });
    expect(order).toEqual(["one", "two"]);
  });
});
