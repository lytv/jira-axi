import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { authCommand, authReports } from "../../src/commands/auth.js";
import type { Account } from "../../src/types.js";

const account = (id: string): Account => ({
  id,
  baseUrl: `https://${id}.atlassian.net`,
  email: "agent@example.com",
  tokenSource: { kind: "env", ref: "AUTH_FIXTURE_TOKEN" },
  default: false,
  deployment: "cloud",
  authScheme: "basic",
});

describe("auth", () => {
  it("reports connected, expired, and unreachable accounts", async () => {
    process.env.AUTH_FIXTURE_TOKEN = "fixture-token";
    const reports = await authReports(
      [account("connected"), account("expired"), account("offline")],
      (item) => ({
        rest: async () => {
          if (item.id === "expired") throw new Error("401 unauthorized");
          if (item.id === "offline") throw new Error("network unavailable");
          return { accountId: "ok" };
        },
      }),
    );
    expect(reports).toEqual([
      { account: "connected", status: "connected" },
      { account: "expired", status: "expired", detail: "401 unauthorized" },
      {
        account: "offline",
        status: "unreachable",
        detail: "network unavailable",
      },
    ]);
  });

  it("renders configured account auth as TOON", async () => {
    const config = await mkdtemp(join(tmpdir(), "jra-axi-config-"));
    const oldConfig = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = config;
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(join(config, "jra-axi")),
    );
    await writeFile(
      join(config, "jra-axi", "accounts.json"),
      JSON.stringify({
        accounts: [
          {
            ...account("missing-token-source"),
            tokenSource: { kind: "env", ref: "MISSING_AUTH_FIXTURE_TOKEN" },
          },
        ],
      }),
    );
    const output = await authCommand([]);
    expect(output).toContain("auth[1]");
    expect(output).toContain("unreachable");
    if (oldConfig === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = oldConfig;
  });
});
