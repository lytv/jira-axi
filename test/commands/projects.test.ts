import { describe, expect, it } from "vitest";
import { JiraClient, type FetchLike } from "../../src/client.js";
import { projectsCommand } from "../../src/commands/projects.js";
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

function commandOptions(fetcher: FetchLike, accounts: Account[] = [account]) {
  return {
    readAccounts: async () => accounts,
    tokenForAccount: async () => "fixture-token",
    createClient: (selected: Account, token: string) =>
      new JiraClient(selected, token, { fetcher }),
  };
}

describe("projects", () => {
  it("lists populated projects through the REST v3 classic pager", async () => {
    const urls: string[] = [];
    const output = await projectsCommand(
      ["list"],
      commandOptions(async (input) => {
        urls.push(String(input));
        return response({
          values: [
            {
              id: "100",
              key: "AXI",
              name: "Jira AXI",
              projectTypeKey: "software",
            },
          ],
          isLast: true,
        });
      }),
    );
    expect(output).toMatchObject({
      account: "work",
      count: 1,
      projects: [{ id: "100", key: "AXI", name: "Jira AXI", type: "software" }],
    });
    expect(urls[0]).toContain("/rest/api/3/project");
    expect(urls[0]).toContain("startAt=0");
    expect(urls[0]).toContain("maxResults=50");
  });

  it("names the account when no projects exist", async () => {
    const output = await projectsCommand(
      ["list"],
      commandOptions(async () => response({ values: [], isLast: true })),
    );
    expect(output).toMatchObject({
      account: "work",
      count: 0,
      projects: [],
      message: "No projects found for account work",
    });
  });

  it("shows project detail", async () => {
    const output = await projectsCommand(
      ["view", "AXI"],
      commandOptions(async () =>
        response({
          id: "100",
          key: "AXI",
          name: "Jira AXI",
          projectTypeKey: "software",
          lead: { displayName: "Avery" },
          url: "https://example.com/axi",
        }),
      ),
    );
    expect(output).toEqual({
      account: "work",
      project: {
        id: "100",
        key: "AXI",
        name: "Jira AXI",
        type: "software",
        lead: "Avery",
        url: "https://example.com/axi",
      },
    });
  });
});
