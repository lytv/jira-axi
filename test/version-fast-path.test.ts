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
    ) as { bin: { "jra-axi": string }; version: string };
    expect(result.stdout.trim()).toBe(manifest.version);
    expect(manifest.bin["jra-axi"]).toBe("dist/bin/jra-axi.js");
    expect((await stat("dist/bin/jra-axi.js")).mode & 0o111).not.toBe(0);
  });
});
