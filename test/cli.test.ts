import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";

vi.mock("../src/accounts.js", async (original) => ({
  ...(await original<typeof import("../src/accounts.js")>()),
  readAccounts: async () => [
    {
      id: "work",
      baseUrl: "https://work.atlassian.net",
      email: "fixture@example.com",
      tokenSource: { kind: "env", ref: "TOKEN" },
      default: true,
      deployment: "cloud",
      authScheme: "basic",
    },
  ],
  tokenForAccount: async () => "fixture-token",
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  process.exitCode = 0;
});

async function run(argv: string[]) {
  let output = "";
  await main({
    argv,
    stdout: {
      write: (chunk) => {
        output += chunk;
      },
    },
  });
  return output;
}

describe("CLI output", () => {
  it.each([
    ["projects", "list"],
    ["projects", "view", "AXI"],
    ["boards", "list"],
    ["sprints", "list", "--board", "42"],
    ["sprints", "view", "7"],
    ["users", "whoami"],
    ["users", "search", "--query", "Taylor"],
    ["issues", "list"],
    ["issues", "view", "AXI-1"],
    ["issues", "history", "AXI-1"],
    ["issues", "transition", "AXI-1", "--list"],
  ])("outputs valid JSON for %s %s", async (...args) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input) => {
        const path = new URL(String(input)).pathname;
        const body =
          path.endsWith("/project") || path.endsWith("/user/search")
            ? []
            : path.endsWith("/search/jql")
              ? { issues: [] }
              : path.endsWith("/changelog")
                ? { values: [], isLast: true }
                : path.endsWith("/transitions")
                  ? { transitions: [] }
                  : path.includes("/issue/")
                    ? {
                        key: "AXI-1",
                        fields: {
                          summary: "Fixture",
                          status: { name: "Open" },
                        },
                      }
                    : {
                        id: "1",
                        key: "AXI",
                        name: "Fixture",
                        accountId: "user-1",
                        values: [],
                        isLast: true,
                      };
        return new Response(JSON.stringify(body));
      }),
    );
    const output = await run([
      args[0],
      "--json",
      ...args.slice(1),
      "--account",
      "work",
    ]);
    expect(JSON.parse(output)).toBeTypeOf("object");
    const trailing = await run([...args, "--account", "work", "--json"]);
    expect(JSON.parse(trailing)).toEqual(JSON.parse(output));
    expect(await run([...args, "--account", "work"])).not.toMatch(/^\s*\{/);
  });

  it("reports timeouts as exit 1 without retrying or changing the error format", async () => {
    vi.stubEnv("JRA_AXI_TIMEOUT_MS", "5");
    const fetcher = vi.fn(
      async (_input, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const output = await run(["projects", "list", "--json"]);
    expect(output).toContain("code: JIRA_TIMEOUT");
    expect(output).toContain("timed out after 5ms");
    expect(process.exitCode).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(["accounts", "auth"])(
    "shows command-specific help for %s",
    async (command) => {
      const output = await run([command, "--help"]);
      expect(output).toContain(`usage: jra-axi ${command}`);
      expect(output).not.toContain("commands[10]");
      expect(output).toContain(
        command === "accounts" ? "--token-env" : "--json",
      );
    },
  );
});
