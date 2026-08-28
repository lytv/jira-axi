import {
  AxiError,
  installSessionStartHooks,
  type InstallSessionStartHooksOptions,
} from "axi-sdk-js";
import { fileURLToPath } from "node:url";

export const SETUP_HELP = `usage: jra-axi setup hooks
Install or repair agent SessionStart hooks for jra-axi ambient context.

examples:
  jra-axi setup hooks
`;

export type SetupDeps = {
  installHooks?: (options?: InstallSessionStartHooksOptions) => void;
};

function defaultInstall(): void {
  installSessionStartHooks({
    marker: "jra-axi",
    binaryNames: ["jra-axi"],
    execPath: fileURLToPath(
      new URL("../../bin/jra-axi-hook.js", import.meta.url),
    ),
  });
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
  (deps.installHooks ?? defaultInstall)();
  return {
    hooks: {
      status: "installed",
      integrations: ["Claude Code", "Codex", "OpenCode"],
    },
    help: ["Restart your agent session to receive jra-axi ambient context"],
  };
}
