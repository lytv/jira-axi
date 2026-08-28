import { describe, expect, it } from "vitest";
import { JiraClient, type FetchLike } from "../../src/client.js";
import { boardsCommand, sprintsCommand } from "../../src/commands/boards.js";
import type { Account } from "../../src/types.js";

const account: Account = {
  id: "work",
  baseUrl: "https://work.atlassian.net",
  email: "agent@example.com",
  tokenSource: { kind: "env", ref: "FIXTURE_TOKEN" },
  default: true,
  deployment: "cloud",
  authScheme: "basic",
};

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

function commandOptions(fetcher: FetchLike) {
  return {
    readAccounts: async () => [account],
    tokenForAccount: async () => "fixture-token",
    createClient: (selected: Account, token: string) =>
      new JiraClient(selected, token, { fetcher }),
  };
}

function expectAgile(url: string): void {
  expect(url).toContain("/rest/agile/1.0");
  expect(url).not.toContain("/rest/api/3");
}

describe("boards and sprints", () => {
  it("lists boards through the Agile API", async () => {
    const urls: string[] = [];
    const output = await boardsCommand(
      ["list", "--project", "AXI"],
      commandOptions(async (input) => {
        urls.push(String(input));
        return response({
          values: [
            {
              id: 42,
              name: "AXI Board",
              type: "scrum",
              location: { projectKey: "AXI" },
            },
          ],
          isLast: true,
        });
      }),
    );
    expect(output).toMatchObject({
      count: 1,
      boards: [{ id: 42, name: "AXI Board", type: "scrum", project: "AXI" }],
    });
    expectAgile(urls[0]);
    expect(urls[0]).toContain("projectKeyOrId=AXI");
  });

  it("names the account when no boards exist", async () => {
    const output = await boardsCommand(
      ["list"],
      commandOptions(async () => response({ values: [], isLast: true })),
    );
    expect(output).toMatchObject({
      count: 0,
      boards: [],
      message: "No boards found for account work",
    });
  });

  it("lists sprints through the Agile API", async () => {
    const urls: string[] = [];
    const output = await sprintsCommand(
      ["list", "--board", "42", "--state", "active"],
      commandOptions(async (input) => {
        urls.push(String(input));
        return response({
          values: [
            {
              id: 7,
              name: "Sprint 7",
              state: "active",
              startDate: "2026-08-01T00:00:00.000Z",
              endDate: "2026-08-14T00:00:00.000Z",
            },
          ],
          isLast: true,
        });
      }),
    );
    expect(output).toMatchObject({
      board: "42",
      state: "active",
      sprints: [{ id: 7, name: "Sprint 7", state: "active" }],
    });
    expectAgile(urls[0]);
    expect(urls[0]).toContain("/board/42/sprint");
    expect(urls[0]).toContain("state=active");
  });

  it("names the board and account when no sprints exist", async () => {
    const output = await sprintsCommand(
      ["list", "--board", "42"],
      commandOptions(async () => response({ values: [], isLast: true })),
    );
    expect(output).toMatchObject({
      count: 0,
      sprints: [],
      message: "No sprints found for board 42 on account work",
    });
  });

  it("shows a sprint through the Agile API", async () => {
    const urls: string[] = [];
    const output = await sprintsCommand(
      ["view", "7"],
      commandOptions(async (input) => {
        urls.push(String(input));
        return response({
          id: 7,
          name: "Sprint 7",
          state: "closed",
          completeDate: "2026-08-14T00:00:00.000Z",
          originBoardId: 42,
        });
      }),
    );
    expect(output).toMatchObject({
      sprint: { id: 7, name: "Sprint 7", state: "closed", board: 42 },
    });
    expectAgile(urls[0]);
    expect(urls[0]).toContain("/sprint/7");
  });
});
