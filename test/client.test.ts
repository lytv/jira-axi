import { describe, expect, it } from "vitest";
import { JiraClient } from "../src/client.js";
import type { Account } from "../src/types.js";

const account: Account = {
  id: "work",
  baseUrl: "https://work.atlassian.net",
  email: "agent@example.com",
  tokenSource: { kind: "env", ref: "TOKEN" },
  default: true,
  deployment: "cloud",
  authScheme: "basic",
};
function response(
  body: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("JiraClient", () => {
  it("uses /search/jql nextPageToken and approximate count", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const client = new JiraClient(account, "token", {
      fetcher: async (input, init) => {
        const url = String(input);
        calls.push({
          url,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        if (url.includes("approximate-count")) return response({ count: 12 });
        return calls.filter((call) => call.url.includes("search/jql"))
          .length === 1
          ? response({
              issues: [{ id: "1", key: "AXI-1", fields: {} }],
              nextPageToken: "page-2",
            })
          : response({ issues: [{ id: "2", key: "AXI-2", fields: {} }] });
      },
    });
    expect(
      (await client.searchJql("project = AXI", ["summary"])).issues,
    ).toHaveLength(2);
    expect(await client.approximateSearchCount("project = AXI")).toBe(12);
    const searchCalls = calls.filter((call) =>
      call.url.includes("/search/jql"),
    );
    expect(searchCalls).toHaveLength(2);
    expect(searchCalls[0].body).toMatchObject({ fields: ["summary"] });
    expect(searchCalls[1].body).toMatchObject({ nextPageToken: "page-2" });
    expect(
      searchCalls.every(
        (call) =>
          !call.url.includes("startAt") &&
          !JSON.stringify(call.body).includes("startAt"),
      ),
    ).toBe(true);
  });

  it("uses the classic pager only for list endpoints", async () => {
    const urls: string[] = [];
    const client = new JiraClient(account, "token", {
      fetcher: async (input) => {
        urls.push(String(input));
        return urls.length === 1
          ? response({ values: [{ id: 1 }], total: 2 })
          : response({ values: [{ id: 2 }], isLast: true });
      },
    });
    expect(await client.listClassic<{ id: number }>("/project")).toEqual([
      { id: 1 },
      { id: 2 },
    ]);
    expect(urls[0]).toContain("startAt=0");
    expect(urls[1]).toContain("startAt=50");
  });

  it("honors Retry-After and names the endpoint after capped retries", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const client = new JiraClient(account, "token", {
      fetcher: async () => {
        calls++;
        return response({}, 429, { "retry-after": "2" });
      },
      sleep: async (time) => {
        sleeps.push(time);
      },
    });
    await expect(client.rest("/myself")).rejects.toThrow(
      "Jira rate limited /myself",
    );
    expect(calls).toBe(4);
    expect(sleeps).toEqual([2000, 2000, 2000]);
  });

  it("uses capped backoff when Retry-After is missing or non-positive", async () => {
    for (const header of [undefined, "0"]) {
      const sleeps: number[] = [];
      const client = new JiraClient(account, "token", {
        fetcher: async () =>
          response({}, 429, header ? { "retry-after": header } : undefined),
        sleep: async (time) => {
          sleeps.push(time);
        },
      });
      await expect(client.rest("/myself")).rejects.toThrow(
        "Jira rate limited /myself",
      );
      expect(sleeps).toEqual([500, 1000, 2000]);
    }
  });

  it("retries a scoped token through the cloud ID path", async () => {
    const urls: string[] = [];
    const client = new JiraClient({ ...account, cloudId: "cloud-1" }, "token", {
      fetcher: async (input) => {
        urls.push(String(input));
        return urls.length === 1
          ? response({}, 401)
          : response({ accountId: "a" });
      },
    });
    await client.rest("/myself");
    expect(urls[1]).toContain(
      "https://api.atlassian.com/ex/jira/cloud-1/rest/api/3/myself",
    );
  });

  it("reports a missing cloudId without a raw Jira body", async () => {
    const client = new JiraClient(account, "token", {
      fetcher: async () =>
        response({ errorMessages: ["secret raw message"] }, 401),
    });
    await expect(client.rest("/myself")).rejects.toThrow("missing cloudId");
  });
});
