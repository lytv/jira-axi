import {
  AxiError,
  installSessionStartHooks,
  type InstallSessionStartHooksOptions,
} from "axi-sdk-js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const SETUP_HELP = `usage: jra-axi setup hooks
Install or repair agent SessionStart hooks for jra-axi ambient context.

examples:
  jra-axi setup hooks
`;

export type SetupDeps = {
  installHooks?: (options?: InstallSessionStartHooksOptions) => void;
};

const COMPACT_HOME_ARGS = " home --compact";

function addCompactArgs(path: string, marker: string): void {
  if (!existsSync(path)) return;
  const settings = JSON.parse(readFileSync(path, "utf8")) as {
    hooks?: { SessionStart?: { hooks?: { command?: string }[] }[] };
  };
  let changed = false;
  for (const group of settings.hooks?.SessionStart ?? []) {
    for (const hook of group.hooks ?? []) {
      if (
        typeof hook.command === "string" &&
        hook.command.includes(marker) &&
        !hook.command.endsWith(COMPACT_HOME_ARGS)
      ) {
        hook.command += COMPACT_HOME_ARGS;
        changed = true;
      }
    }
  }
  if (changed) writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
}

function addOpenCodeCompactArgs(path: string): void {
  if (!existsSync(path)) return;
  const current = readFileSync(path, "utf8");
  const updated = current.replace(
    "spawn(command, [], {",
    'spawn(command, ["home", "--compact"], {',
  );
  if (updated !== current) writeFileSync(path, updated);
}

export function installCompactSessionStartHooks(
  options: InstallSessionStartHooksOptions = {},
): void {
  const marker = options.marker ?? "jra-axi";
  installSessionStartHooks({
    marker,
    binaryNames: ["jra-axi"],
    ...options,
  });
  const home = options.homeDir ?? homedir();
  const root =
    options.scope === "project"
      ? resolve(options.projectDir ?? process.cwd())
      : home;
  addCompactArgs(join(root, ".claude", "settings.json"), marker);
  addCompactArgs(join(root, ".codex", "hooks.json"), marker);
  addOpenCodeCompactArgs(
    join(
      options.scope === "project" ? root : home,
      options.scope === "project" ? ".opencode" : ".config/opencode",
      "plugins",
      `axi-${marker}.js`,
    ),
  );
}

export async function setupCommand(
  args: string[],
  deps: SetupDeps = {},
): Promise<Record<string, unknown>> {
  if (args.length !== 1 || args[0] !== "hooks") {
    throw new AxiError("Unknown setup action", "VALIDATION_ERROR", [
      "Run `jra-axi setup hooks`",
    ]);
  }
  (deps.installHooks ?? installCompactSessionStartHooks)();
  return {
    hooks: {
      status: "installed",
      integrations: ["Claude Code", "Codex", "OpenCode"],
    },
    help: ["Restart your agent session to receive jra-axi ambient context"],
  };
}
