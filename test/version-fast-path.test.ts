import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/version.js";

const exec = promisify(execFile);
describe("version fast path", () => {
  it("prints the version from the built executable", async () => {
    const result = await exec(process.execPath, ["dist/bin/jra-axi.js", "--version"]);
    expect(result.stdout.trim()).toBe(VERSION);
  });
  it("keeps the command graph behind a dynamic import", async () => {
    const source = await import("node:fs/promises").then(({ readFile }) => readFile("bin/jra-axi.ts", "utf8"));
    expect(source).toContain('await import("../src/cli.js")');
    expect(source).not.toContain('from "../src/cli.js"');
  });
});
