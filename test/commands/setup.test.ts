import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { AxiError, installSessionStartHooks } from "axi-sdk-js";
import { setupCommand } from "../../src/commands/setup.js";

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
      installHooks: () => installSessionStartHooks(options),
    });
    const first = await snapshot(home);
    expect(first).toContain("jra-axi");
    expect(first).not.toContain("MISSING");
    await setupCommand(["hooks"], {
      installHooks: () => installSessionStartHooks(options),
    });
    expect(await snapshot(home)).toBe(first);
  });
});
