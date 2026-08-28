// Generates skills/jra-axi/SKILL.md from src/skill.ts as a minimal stub that
// defers to the live CLI. Do not bake help text or live Jira data into the skill.
//
//   pnpm run build:skill            # write the file
//   pnpm run build:skill -- --check # fail (exit 1) if the committed file is stale
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { createSkillMarkdown } from "../src/skill.js";

const target = new URL("../skills/jra-axi/SKILL.md", import.meta.url);
const targetPath = fileURLToPath(target);
const expected = createSkillMarkdown();
const check = process.argv.includes("--check");

if (check) {
  let actual: string | null = null;
  try {
    actual = await readFile(target, "utf8");
  } catch {
    // missing file falls through to the mismatch branch below
  }
  if (actual !== expected) {
    console.error(
      "skills/jra-axi/SKILL.md is out of date. Run `pnpm run build:skill` and commit the result.",
    );
    process.exit(1);
  }
  console.log("skills/jra-axi/SKILL.md is up to date.");
} else {
  await mkdir(new URL("../skills/jra-axi/", import.meta.url), {
    recursive: true,
  });
  await writeFile(target, expected);
  console.log(`Wrote ${targetPath}`);
}
