import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AxiError } from "axi-sdk-js";
import { main } from "../../src/cli.js";
import { homeCommand, homePayload } from "../../src/commands/home.js";
import type { AssignedAccountSummary } from "../../src/queries/assigned.js";
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

const connected = (
  id: string,
  extra: Partial<AssignedAccountSummary> = {},
): AssignedAccountSummary => ({
  accountId: id,
  assigned: 0,
  overdue: 0,
  inReview: 0,
  blocked: 0,
  issues: [],
  status: "connected",
  ...extra,
});

describe("home", () => {
  it("names the account in the empty assigned state", () => {
    const payload = homePayload([connected("work")]);
    expect(payload.accounts).toEqual([
      {
        account: "work",
        status: "connected",
        assigned: 0,
        overdue: 0,
        inReview: 0,
        blocked: 0,
        issues: "0 assigned issues on account work",
      },
    ]);
    expect(payload.help).toEqual([
      "Run `jra-axi issues view <KEY>`",
      "Run `jra-axi accounts list`",
      "Run `jra-axi --help`",
    ]);
  });

  it("groups populated issues by account with compact counts", async () => {
    const result = await homeCommand([], {
      readAccounts: async () => [account("work"), account("personal")],
      tokenForAccount: async () => "token",
      createClient: (item) => ({
        approximateSearchCount: async () => (item.id === "work" ? 2 : 0),
        searchJql: async () =>
          item.id === "work"
            ? {
                issues: [
                  {
                    id: "1",
                    key: "AXI-9",
                    fields: {
                      summary: "Fix login",
                      status: { name: "To Do" },
                    },
                  },
                  {
                    id: "2",
                    key: "AXI-8",
                    fields: {
                      summary: "Add pager",
                      status: { name: "In Progress" },
                    },
                  },
                ],
              }
            : { issues: [] },
      }),
    });
    expect(result).toMatchObject({
      accounts: [
        {
          account: "work",
          status: "connected",
          assigned: 2,
          issues: [
            { key: "AXI-9", summary: "Fix login", status: "To Do" },
            { key: "AXI-8", summary: "Add pager", status: "In Progress" },
          ],
        },
        {
          account: "personal",
          status: "connected",
          assigned: 0,
          issues: "0 assigned issues on account personal",
        },
      ],
      help: [
        "Run `jra-axi issues view AXI-9`",
        "Run `jra-axi accounts list`",
        "Run `jra-axi --help`",
      ],
    });
  });

  it("renders JSON when --json is set", async () => {
    const result = await homeCommand(["--json"], {
      readAccounts: async () => [],
    });
    expect(typeof result).toBe("string");
    const parsed = JSON.parse(result as string) as {
      accounts: string;
      help: string[];
    };
    expect(parsed.accounts).toBe("No Jira Cloud accounts configured");
    expect(parsed.help[0]).toContain("accounts add");
  });

  it("rejects unknown home flags", async () => {
    await expect(homeCommand(["--tui"])).rejects.toBeInstanceOf(AxiError);
  });

  it("prints bin, description, and a definitive empty state for bare jra-axi", async () => {
    const config = await mkdtemp(join(tmpdir(), "jra-axi-home-"));
    const oldConfig = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = config;
    const chunks: string[] = [];
    try {
      await main({
        argv: [],
        stdout: { write: (chunk) => chunks.push(String(chunk)) },
      });
    } finally {
      if (oldConfig === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = oldConfig;
    }
    const output = chunks.join("");
    expect(output).toContain("bin:");
    expect(output).toContain("description:");
    expect(output).toContain("Manage Jira Cloud resources for agents.");
    expect(output).toContain("No Jira Cloud accounts configured");
  });
});
