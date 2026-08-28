import { describe, expect, it } from "vitest";
import { JiraClient, type FetchLike } from "../../src/client.js";
import { main } from "../../src/cli.js";
import { usersCommand } from "../../src/commands/users.js";
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

describe("users", () => {
  it("returns each matching Jira identity", async () => {
    const urls: string[] = [];
    const output = await usersCommand(
      ["search", "--query", "Taylor"],
      commandOptions(async (input) => {
        urls.push(String(input));
        return response([
          {
            accountId: "a-1",
            displayName: "Taylor One",
            emailAddress: "one@example.com",
          },
          { accountId: "a-2", displayName: "Taylor Two" },
        ]);
      }),
    );
    expect(output).toMatchObject({
      count: 2,
      users: [
        { accountId: "a-1", name: "Taylor One", email: "one@example.com" },
        { accountId: "a-2", name: "Taylor Two" },
      ],
    });
    expect(urls[0]).toContain("/rest/api/3/user/search");
    expect(urls[0]).toContain("query=Taylor");
  });

  it("names the account when no user matches", async () => {
    const output = await usersCommand(
      ["search", "--query", "Taylor"],
      commandOptions(async () => response([])),
    );
    expect(output).toMatchObject({
      count: 0,
      users: [],
      message: 'No users found for "Taylor" on account work',
    });
  });

  it("fails with exit code 2 when no account resolves", async () => {
    const output: string[] = [];
    const oldConfig = process.env.XDG_CONFIG_HOME;
    const oldExitCode = process.exitCode;
    process.env.XDG_CONFIG_HOME = "/tmp/jra-axi-no-config";
    process.exitCode = undefined;
    try {
      await main({
        argv: ["users", "search", "--query", "Taylor"],
        stdout: { write: (chunk) => output.push(chunk) },
      });
      expect(process.exitCode).toBe(2);
      expect(output.join("")).toContain("Configured accounts: none");
    } finally {
      if (oldConfig === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = oldConfig;
      process.exitCode = oldExitCode;
    }
  });

  it("shows complete help through the registered command", async () => {
    const output: string[] = [];
    await main({
      argv: ["users", "--help"],
      stdout: { write: (chunk) => output.push(chunk) },
    });
    expect(output.join("")).toContain("users search --query");
  });
});
