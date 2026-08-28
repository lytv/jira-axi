import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const exec = promisify(execFile);
describe("version fast path", () => {
  it("prints the version from the built executable", async () => {
    const result = await exec(process.execPath, [
      "dist/bin/jra-axi.js",
      "--version",
    ]);
    const manifest = JSON.parse(
      await readFile("dist/package.json", "utf8"),
    ) as {
      name: string;
      bin: { "jra-axi": string };
      version: string;
      repository: { type: string; url: string };
    };
    expect(result.stdout.trim()).toBe(manifest.version);
    expect(manifest.name).toBe("@lyrks/jira-axi");
    expect(manifest.bin["jra-axi"]).toBe("dist/bin/jra-axi.js");
    expect(manifest.repository).toEqual({
      type: "git",
      url: "https://github.com/lytv/jira-axi.git",
    });
    expect((await stat("dist/bin/jra-axi.js")).mode & 0o111).not.toBe(0);
  });
});
