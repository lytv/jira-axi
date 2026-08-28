import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { load } from "js-yaml";
import { DESCRIPTION } from "../src/cli.js";
import {
  createSkillMarkdown,
  HERMES_CATEGORY,
  HERMES_TAGS,
  MAX_SKILL_MARKDOWN_CHARS,
  SKILL_AUTHOR,
  SKILL_DESCRIPTION,
} from "../src/skill.js";

const root = fileURLToPath(new URL("..", import.meta.url));

function parseFrontmatter(markdown: string): Record<string, unknown> {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) throw new Error("Missing frontmatter");
  return load(match[1]) as Record<string, unknown>;
}

function skillBody(markdown: string): string {
  const end = markdown.indexOf("\n---\n", 3);
  if (end < 0) throw new Error("Missing frontmatter closer");
  return markdown.slice(end + 5);
}

describe("createSkillMarkdown", () => {
  it("matches the committed skills/jra-axi/SKILL.md", () => {
    const committed = readFileSync(
      new URL("../skills/jra-axi/SKILL.md", import.meta.url),
      "utf8",
    );
    expect(committed).toBe(createSkillMarkdown());
  });

  it("starts with valid YAML frontmatter and is not user-invocable", () => {
    const markdown = createSkillMarkdown();
    expect(parseFrontmatter(markdown)).toEqual({
      name: "jra-axi",
      description: SKILL_DESCRIPTION,
      "user-invocable": false,
      author: SKILL_AUTHOR,
      metadata: {
        hermes: {
          tags: HERMES_TAGS,
          category: HERMES_CATEGORY,
        },
      },
    });
  });

  it("stays a short stub that defers to npx -y @lyrks/jira-axi", () => {
    const markdown = createSkillMarkdown();
    const body = skillBody(markdown);
    expect(markdown.length).toBeLessThanOrEqual(MAX_SKILL_MARKDOWN_CHARS);
    expect(body).toContain(DESCRIPTION);
    expect(body).toContain("npx -y @lyrks/jira-axi");
    expect(body).toContain("npx -y @lyrks/jira-axi --help");
    expect(body).not.toMatch(/^## Commands/m);
    expect(body).not.toMatch(/^## Tips/m);
    expect(body).not.toMatch(/^## Workflow/m);
    expect(body).not.toContain("AXI-1");
    expect(body).not.toContain("currentUser()");
  });
});

describe("build:skill --check", () => {
  it("passes against the committed skill", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/build-skill.ts", "--check"],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("up to date");
  });
});
