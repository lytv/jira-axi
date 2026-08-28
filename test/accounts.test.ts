import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importAccounts, resolveAccount, writeAccounts } from "../src/accounts.js";
import type { Account } from "../src/types.js";

const account = (id: string, isDefault = false): Account => ({ id, baseUrl: `https://${id}.atlassian.net`, email: "agent@example.com", tokenSource: { kind: "env", ref: "TOKEN" }, default: isDefault, deployment: "cloud", authScheme: "basic" });

describe("accounts", () => {
  it("resolves explicit, single, then default accounts", () => {
    expect(resolveAccount([account("one")]).id).toBe("one");
    expect(resolveAccount([account("one"), account("two", true)]).id).toBe("two");
    expect(resolveAccount([account("one"), account("two", true)], "one").id).toBe("one");
  });
  it("rejects a multi-account lookup without a default with exit code 2", () => {
    try { resolveAccount([account("one"), account("two")]); } catch (error) { expect((error as { code: string }).code).toBe("VALIDATION_ERROR"); return; }
    throw new Error("expected resolution to fail");
  });
  it("imports jira-cli sites without inventing token values or a default for multiple sites", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jra-axi-")); const fixture = join(directory, "config.yml");
    await writeFile(fixture, "sites:\n  - url: https://one.atlassian.net\n    email: one@example.com\n  - url: https://two.atlassian.net\n    email: two@example.com\n");
    const imported = await importAccounts("jira-cli", fixture, []);
    expect(imported.map((item) => item.default)).toEqual([false, false]);
    expect(imported.every((item) => item.tokenSource.kind === "jira-cli-ref" && item.tokenSource.ref === "JIRA_API_TOKEN")).toBe(true);
    expect(JSON.stringify(imported)).not.toContain("token:");
  });
  it("rejects an OAuth acli credential", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jra-axi-")); const fixture = join(directory, "config.yml");
    await writeFile(fixture, "site: https://one.atlassian.net\nemail: one@example.com\nauthType: oauth\n");
    await expect(importAccounts("acli", fixture, [])).rejects.toThrow("OAuth credentials");
  });
  it("rejects OAuth inherited from a parent import record", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jra-axi-")); const fixture = join(directory, "config.yml");
    await writeFile(fixture, "authType: oauth\nsites:\n  - url: https://one.atlassian.net\n    email: one@example.com\n");
    await expect(importAccounts("acli", fixture, [])).rejects.toThrow("OAuth credentials");
  });
  it("rejects nested raw tokens before writing account config", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jra-axi-"));
    await expect(writeAccounts([{ ...account("one"), tokenSource: { kind: "env", ref: "TOKEN", nested: { token: "secret" } } } as Account], join(directory, "accounts.json"))).rejects.toThrow("raw token");
  });
  it("creates unique account IDs within one import", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jra-axi-")); const fixture = join(directory, "config.yml");
    await writeFile(fixture, "sites:\n  - url: https://one.atlassian.net\n    email: first@example.com\n  - url: https://one.atlassian.net\n    email: second@example.com\n  - url: https://one.atlassian.net\n    email: third@example.com\n");
    const imported = await importAccounts("jira-cli", fixture, [account("one-2")]);
    expect(new Set(imported.map((item) => item.id)).size).toBe(3);
  });
});
