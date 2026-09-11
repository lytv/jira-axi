import { describe, expect, it } from "vitest";
import { JiraClient, type FetchLike } from "../../src/client.js";
import { main } from "../../src/cli.js";
import { statusesCommand } from "../../src/commands/statuses.js";
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

describe("statuses", () => {
  it("registers the statuses command with its help", async () => {
    const output: string[] = [];
    await main({
      argv: ["statuses", "--help"],
      stdout: { write: (chunk) => output.push(chunk) },
    });
    expect(output.join("")).toContain("statuses create --project");
  });

  it("creates a To Do status scoped to a team-managed project", async () => {
    const requests: Array<{ url: string; body?: unknown }> = [];
    const output = await statusesCommand(
      ["create", "--project", "KAN", "--name", "Res"],
      commandOptions(async (input, init) => {
        const url = String(input);
        requests.push({
          url,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        if (url.includes("/project/KAN"))
          return response({
            id: "10001",
            key: "KAN",
            name: "Kanban",
            simplified: true,
          });
        if (url.includes("/statuses/byNames")) return response([]);
        return response([{ id: "10100", name: "Res", statusCategory: "TODO" }]);
      }),
    );

    expect(output).toMatchObject({
      account: "work",
      project: "KAN",
      status: { id: "10100", name: "Res", category: "TODO" },
      created: true,
    });
    expect(requests[0].url).toContain("/rest/api/3/project/KAN");
    expect(requests[1].url).toContain("/rest/api/3/statuses/byNames");
    expect(requests[1].url).toContain("name=Res");
    expect(requests[1].url).toContain("projectId=10001");
    expect(requests[2]).toMatchObject({
      url: expect.stringContaining("/rest/api/3/statuses"),
      body: {
        scope: { type: "PROJECT", project: { id: "10001" } },
        statuses: [{ name: "Res", statusCategory: "TODO" }],
      },
    });
  });

  it("does not create a status when the name already exists", async () => {
    const urls: string[] = [];
    const output = await statusesCommand(
      ["create", "--project", "KAN", "--name", "Res"],
      commandOptions(async (input) => {
        const url = String(input);
        urls.push(url);
        if (url.includes("/project/KAN"))
          return response({
            id: "10001",
            key: "KAN",
            name: "Kanban",
            simplified: true,
          });
        return response([{ id: "10100", name: "Res", statusCategory: "TODO" }]);
      }),
    );

    expect(output).toMatchObject({
      status: { id: "10100", name: "Res", category: "TODO" },
      created: false,
      message: 'Status "Res" already exists in project KAN (no-op)',
    });
    expect(urls).toHaveLength(2);
    expect(urls.every((url) => !url.endsWith("/statuses"))).toBe(true);
  });

  it("rejects a company-managed project", async () => {
    await expect(
      statusesCommand(
        ["create", "--project", "CMP", "--name", "Res"],
        commandOptions(async () =>
          response({
            id: "10002",
            key: "CMP",
            name: "Classic",
            simplified: false,
          }),
        ),
      ),
    ).rejects.toThrow("CMP is not a team-managed project");
  });
});
