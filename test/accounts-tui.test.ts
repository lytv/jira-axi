import { describe, expect, it } from "vitest";
import { accountsCommand, accountsTui } from "../src/accounts.js";
import type { TuiClient } from "../src/tui-data.js";
import type { Account } from "../src/types.js";
import type { LiveTuiIo } from "../src/tui-live.js";

const account = (id: string): Account => ({
  id,
  baseUrl: `https://${id}.atlassian.net`,
  email: "agent@example.com",
  tokenSource: { kind: "env", ref: "TOKEN" },
  default: false,
  deployment: "cloud",
  authScheme: "basic",
});

const connectedClient: TuiClient = {
  rest: async () => ({ accountId: "me" }),
  approximateSearchCount: async () => 1,
  listClassic: async () => [],
};

describe("accounts --tui", () => {
  it("--once renders one card per configured fixture account and exits without a live loop", async () => {
    const output = await accountsTui(["--once"], {
      readAccounts: async () => [account("one"), account("two")],
      tokenForAccount: async () => "token",
      createClient: () => connectedClient,
      isInteractive: () => true,
      io: () => {
        throw new Error("the live loop must not run with --once");
      },
      columns: () => 100,
      noColor: () => true,
    });
    expect(output).toContain("┌ one");
    expect(output).toContain("┌ two");
  });

  it("renders a single frame on a non-interactive terminal even without --once", async () => {
    const output = await accountsTui([], {
      readAccounts: async () => [account("one")],
      tokenForAccount: async () => "token",
      createClient: () => connectedClient,
      isInteractive: () => false,
      io: () => {
        throw new Error(
          "the live loop must not run on a non-interactive terminal",
        );
      },
      columns: () => 100,
      noColor: () => true,
    });
    expect(output).toContain("┌ one");
  });

  it("accountsCommand routes --tui to the dashboard", async () => {
    const output = await accountsCommand(["--tui", "--once"]);
    expect(typeof output).toBe("string");
  });

  it("rejects --tui combined with --json", async () => {
    await expect(
      accountsTui(["--json"], {
        readAccounts: async () => [],
        tokenForAccount: async () => "token",
        createClient: () => connectedClient,
        isInteractive: () => true,
        io: () => {
          throw new Error("unreachable");
        },
        columns: () => 100,
        noColor: () => true,
      }),
    ).rejects.toThrow("mutually exclusive");
  });

  it("quits the live loop on q and returns the last rendered frame", async () => {
    const dataListeners = new Set<(chunk: Buffer | string) => void>();
    const io: LiveTuiIo = {
      stdout: { write: () => true },
      stdin: {
        on: (_event, listener) => dataListeners.add(listener),
        off: (_event, listener) => dataListeners.delete(listener),
      },
      setTimer: () => 1,
      clearTimer: () => {},
    };
    const run = accountsTui(["--refresh", "30s"], {
      readAccounts: async () => [account("one")],
      tokenForAccount: async () => "token",
      createClient: () => connectedClient,
      isInteractive: () => true,
      io: () => io,
      columns: () => 100,
      noColor: () => true,
    });
    await new Promise((resolve) => setImmediate(resolve));
    for (const listener of dataListeners) listener("q");
    const output = await run;
    expect(output).toContain("┌ one");
  });
});
