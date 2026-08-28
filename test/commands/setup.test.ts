import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { AxiError } from "axi-sdk-js";
import {
  installCompactSessionStartHooks,
  setupCommand,
} from "../../src/commands/setup.js";

async function snapshot(home: string): Promise<string> {
  const paths = [
    join(home, ".claude", "settings.json"),
    join(home, ".codex", "hooks.json"),
    join(home, ".codex", "config.toml"),
    join(home, ".config", "opencode", "plugins", "axi-jra-axi.js"),
  ];
  const parts: string[] = [];
  for (const path of paths) {
    try {
      parts.push(`${path}\n${await readFile(path, "utf8")}`);
    } catch {
      parts.push(`${path}\nMISSING`);
    }
  }
  return parts.join("\n");
}

describe("setup hooks", () => {
  it("is flag-only and rejects unknown actions without prompting", async () => {
    await expect(setupCommand([])).rejects.toBeInstanceOf(AxiError);
    await expect(setupCommand(["hooks", "--yes"])).rejects.toBeInstanceOf(
      AxiError,
    );
    await expect(setupCommand(["install"])).rejects.toMatchObject({
      message: "Unknown setup action",
    });
  });

  it("installs hooks through the explicit setup command", async () => {
    let called = 0;
    const result = await setupCommand(["hooks"], {
      installHooks: () => {
        called++;
      },
    });
    expect(called).toBe(1);
    expect(result).toEqual({
      hooks: {
        status: "installed",
        integrations: ["Claude Code", "Codex", "OpenCode"],
      },
      help: ["Restart your agent session to receive jra-axi ambient context"],
    });
  });

  it("is idempotent in a temp home directory", async () => {
    const home = await mkdtemp(join(tmpdir(), "jra-axi-hooks-"));
    const execPath = join(home, "dist", "bin", "jra-axi.js");
    await mkdir(dirname(execPath), { recursive: true });
    await writeFile(execPath, "#!/usr/bin/env node\n");
    const options = {
      marker: "jra-axi",
      binaryNames: ["jra-axi"],
      execPath,
      homeDir: home,
      shouldInstall: () => true,
    };
    await setupCommand(["hooks"], {
      installHooks: () => installCompactSessionStartHooks(options),
    });
    const first = await snapshot(home);
    expect(first).toContain("jra-axi");
    expect(first).not.toContain("MISSING");
    await setupCommand(["hooks"], {
      installHooks: () => installCompactSessionStartHooks(options),
    });
    expect(await snapshot(home)).toBe(first);
  });

  it("uses the PATH command with compact home arguments", async () => {
    const home = await mkdtemp(join(tmpdir(), "jra-axi-hooks-"));
    const execPath = join(home, "dist", "bin", "jra-axi.js");
    const bin = join(home, "bin");
    await mkdir(dirname(execPath), { recursive: true });
    await mkdir(bin, { recursive: true });
    await writeFile(execPath, "#!/usr/bin/env node\n");
    await symlink(execPath, join(bin, "jra-axi"));
    const originalPath = process.env.PATH;
    process.env.PATH = `${bin}:${originalPath ?? ""}`;
    try {
      installCompactSessionStartHooks({
        marker: "jra-axi",
        binaryNames: ["jra-axi"],
        execPath,
        homeDir: home,
        shouldInstall: () => true,
      });
    } finally {
      process.env.PATH = originalPath;
    }
    const settings = JSON.parse(
      await readFile(join(home, ".claude", "settings.json"), "utf8"),
    ) as { hooks: { SessionStart: { hooks: { command: string }[] }[] } };
    expect(settings.hooks.SessionStart[0]?.hooks[0]?.command).toBe(
      "jra-axi home --compact",
    );
  });
});
