import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const exec = promisify(execFile);
describe("version fast path", () => {
  it("prints the version from the built executable", async () => {
    const result = await exec(process.execPath, [
      "dist/bin/jra-axi.js",
      "--version",
    ]);
    const manifest = JSON.parse(
      await readFile("dist/package.json", "utf8"),
    ) as { version: string };
    expect(result.stdout.trim()).toBe(manifest.version);
  });
});
