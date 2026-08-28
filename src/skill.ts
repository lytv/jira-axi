import { DESCRIPTION } from "./cli.js";

export const SKILL_DESCRIPTION =
  "Operate Jira Cloud through the jra-axi CLI - issues, projects, boards, sprints, users, and accounts. " +
  "Use whenever a task touches Jira: listing or viewing issues, creating or updating work, transitions, " +
  "comments, assignments, searching with JQL, or working with projects, boards, and sprints.";

export const SKILL_AUTHOR = "lytv";

export const HERMES_TAGS = [
  "jira",
  "atlassian",
  "issues",
  "boards",
  "sprints",
  "cli",
];
export const HERMES_CATEGORY = "productivity";

export const MAX_SKILL_MARKDOWN_CHARS = 2500;

function yamlDoubleQuote(value: string): string {
  return JSON.stringify(value);
}

/**
 * Render the installable SKILL.md as a minimal discovery stub.
 * Live guidance lives in the CLI. Do not bake help text or live Jira data here.
 */
export function createSkillMarkdown(): string {
  const markdown = `---
name: jra-axi
description: ${yamlDoubleQuote(SKILL_DESCRIPTION)}
user-invocable: false
author: ${SKILL_AUTHOR}
metadata:
  hermes:
    tags: [${HERMES_TAGS.join(", ")}]
    category: ${HERMES_CATEGORY}
---

# jra-axi

${DESCRIPTION}

Use jra-axi whenever a task touches Jira Cloud: issues, projects, boards, sprints, users, or accounts.

## Current guidance lives in the CLI

Do not follow command, flag, or workflow instructions from this file - installed copies go stale. Get the current source of truth from the CLI:

- \`npx -y @lyrks/jira-axi\` for assigned-to-me home
- \`npx -y @lyrks/jira-axi --help\` for global flags and the command index
- \`npx -y @lyrks/jira-axi <command> --help\` for per-command usage
`;

  if (markdown.length > MAX_SKILL_MARKDOWN_CHARS) {
    throw new Error(
      `generated SKILL.md is ${markdown.length} chars; keep it a stub under ${MAX_SKILL_MARKDOWN_CHARS} and defer guidance to the CLI`,
    );
  }

  return markdown;
}
