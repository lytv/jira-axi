import { AxiError } from "axi-sdk-js";
import { readAccounts, resolveAccount, tokenForAccount } from "../accounts.js";
import { toAdf } from "../adf.js";
import { JiraClient } from "../client.js";
import {
  fieldsForIssueTypeCreate,
  issueTypesForCreate,
  type JiraIssueTypeMeta,
} from "../meta.js";
import { aggregateCount, truncateText } from "../render.js";
import type {
  Account,
  JiraComment,
  JiraFieldMeta,
  JiraIssue,
} from "../types.js";

export type IssuesClient = Pick<JiraClient, "rest"> & { account: Account };
export type IssuesDeps = {
  readAccounts?: () => Promise<Account[]>;
  tokenForAccount?: (account: Account) => Promise<string>;
  createClient?: (account: Account, token: string) => IssuesClient;
};

const DEFAULT_LIST_FIELDS = ["key", "summary", "status", "assignee"];
const DEFAULT_LIMIT = 50;
const AUTO_CREATE_FIELDS = new Set(["project", "issuetype", "reporter"]);
const BOOLEAN_FLAGS = new Set(["--help", "--full", "--yes", "--list"]);
const OBJECT_NAME_FIELDS = new Set(["priority", "resolution", "issuetype"]);

function usage(message: string, suggestions: string[] = []): AxiError {
  return new AxiError(message, "VALIDATION_ERROR", suggestions);
}

type ParsedArgs = {
  positionals: string[];
  flags: Map<string, string | true>;
  fields: Array<[string, string]>;
};

function parseArgs(args: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  const fields: Array<[string, string]> = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--") {
      positionals.push(...args.slice(index + 1));
      break;
    }
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    if (arg === "--field") {
      const raw = args[index + 1];
      if (!raw || raw.startsWith("--"))
        throw usage("--field requires name=value");
      const eq = raw.indexOf("=");
      if (eq <= 0) throw usage("--field requires name=value");
      fields.push([raw.slice(0, eq), raw.slice(eq + 1)]);
      index++;
      continue;
    }
    const next = args[index + 1];
    if (BOOLEAN_FLAGS.has(arg)) {
      flags.set(arg, true);
      continue;
    }
    if (next && !next.startsWith("--")) {
      flags.set(arg, next);
      index++;
    } else flags.set(arg, true);
  }
  return { positionals, flags, fields };
}

function onlyFlags(
  flags: Map<string, string | true>,
  fieldPairs: Array<[string, string]>,
  valid: string[],
  allowField = false,
): void {
  const allowed = new Set([...valid, "--help", "--account"]);
  for (const flag of flags.keys()) {
    if (!allowed.has(flag))
      throw usage(`Unknown flag ${flag}`, [
        `Valid flags: ${[...allowed].sort().join(", ")}`,
      ]);
  }
  if (fieldPairs.length && !allowField)
    throw usage("Unknown flag --field", [
      `Valid flags: ${[...allowed].sort().join(", ")}`,
    ]);
}

function value(
  flags: Map<string, string | true>,
  name: string,
): string | undefined {
  const found = flags.get(name);
  return typeof found === "string" ? found : undefined;
}

function requireValue(flags: Map<string, string | true>, name: string): string {
  const found = value(flags, name);
  if (found === undefined) throw usage(`${name} is required`);
  return found;
}

function requireKey(positionals: string[], command: string): string {
  const key = positionals[0];
  if (!key)
    throw usage(`Issue key is required`, [
      `Run \`jra-axi issues ${command} <KEY>\``,
    ]);
  return key;
}

function requireYes(flags: Map<string, string | true>, action: string): void {
  if (!flags.has("--yes"))
    throw usage(`${action} requires --yes`, [
      `Retry with --yes to confirm ${action}`,
    ]);
}

function parseLimit(flags: Map<string, string | true>): number {
  const raw = flags.get("--limit");
  if (raw === undefined) return DEFAULT_LIMIT;
  if (raw === true) throw usage("--limit requires a positive integer");
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || String(parsed) !== raw.trim())
    throw usage("--limit must be a positive integer");
  return parsed;
}

function parseFieldList(raw: string | undefined): string[] {
  if (raw === undefined) return [...DEFAULT_LIST_FIELDS];
  const fields = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (fields.length === 0) throw usage("--fields requires at least one field");
  return fields.includes("key") ? fields : ["key", ...fields];
}

function jqlQuote(raw: string): string {
  return `"${raw.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function projectClause(project: string): string {
  return /^[A-Z][A-Z0-9_]+$/.test(project)
    ? `project = ${project}`
    : `project = ${jqlQuote(project)}`;
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  return value as Record<string, unknown>;
}

function named(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  const object = record(value);
  return typeof object?.name === "string" ? object.name : undefined;
}

function accountIdOf(value: unknown): string | undefined {
  const object = record(value);
  return typeof object?.accountId === "string" ? object.accountId : undefined;
}

function displayOf(value: unknown): string | null {
  const object = record(value);
  if (!object) return null;
  if (typeof object.displayName === "string") return object.displayName;
  if (typeof object.accountId === "string") return object.accountId;
  return null;
}

function fieldKey(field: JiraFieldMeta): string {
  if (typeof field.key === "string" && field.key) return field.key;
  if (typeof field.fieldId === "string" && field.fieldId) return field.fieldId;
  return field.name;
}

function encodeField(name: string, raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      throw usage(`--field ${name} is not valid JSON`);
    }
  }
  if (name === "description" || name === "comment") return toAdf(raw);
  if (name === "labels")
    return raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  if (OBJECT_NAME_FIELDS.has(name)) return { name: raw };
  if (name === "parent") return { key: raw };
  if (name === "assignee") return raw === "none" ? null : { accountId: raw };
  return raw;
}

function fieldsFromPairs(
  pairs: Array<[string, string]>,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [name, raw] of pairs) fields[name] = encodeField(name, raw);
  return fields;
}

function accountHint(account: Account, explicit?: string): string {
  return explicit ? ` --account ${account.id}` : "";
}

async function session(
  flags: Map<string, string | true>,
  deps: IssuesDeps,
): Promise<{ account: Account; client: IssuesClient; explicit?: string }> {
  const accounts = await (deps.readAccounts ?? readAccounts)();
  const explicit = value(flags, "--account");
  const account = resolveAccount(accounts, explicit);
  const token = await (deps.tokenForAccount ?? tokenForAccount)(account);
  const client = (deps.createClient ?? defaultClient)(account, token);
  return { account, client, explicit };
}

function defaultClient(account: Account, token: string): IssuesClient {
  return new JiraClient(account, token);
}

async function myselfId(client: IssuesClient): Promise<string> {
  const me = record(await client.rest("/myself"));
  if (typeof me?.accountId !== "string")
    throw usage("Cannot resolve the current user accountId");
  return me.accountId;
}

async function searchIssues(
  client: IssuesClient,
  jql: string,
  fields: string[],
  limit: number,
): Promise<JiraIssue[]> {
  const issues: JiraIssue[] = [];
  let nextPageToken: string | undefined;
  while (issues.length < limit) {
    const page = (await client.rest("/search/jql", {
      method: "POST",
      body: {
        jql,
        fields,
        maxResults: Math.min(100, limit - issues.length),
        ...(nextPageToken ? { nextPageToken } : {}),
      },
    })) as { issues?: JiraIssue[]; nextPageToken?: string };
    const batch = page.issues ?? [];
    issues.push(...batch);
    nextPageToken = page.nextPageToken;
    if (!nextPageToken || batch.length === 0) break;
  }
  return issues.slice(0, limit);
}

function flattenListValue(name: string, issue: JiraIssue): unknown {
  if (name === "key") return issue.key;
  if (name === "id") return issue.id;
  const raw = issue.fields[name];
  if (name === "status") return named(raw) ?? null;
  if (name === "assignee") return displayOf(raw);
  if (name === "issuetype" || name === "priority" || name === "project")
    return named(raw) ?? null;
  if (Array.isArray(raw))
    return raw.map((item) =>
      typeof item === "string" ? item : (named(item) ?? item),
    );
  if (typeof raw === "string" || typeof raw === "number" || raw === null)
    return raw;
  return named(raw) ?? raw ?? null;
}

function listRow(issue: JiraIssue, fields: string[]): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const name of fields) row[name] = flattenListValue(name, issue);
  return row;
}

async function buildJql(
  flags: Map<string, string | true>,
  client: IssuesClient,
): Promise<string> {
  const clauses: string[] = [];
  const explicitJql = value(flags, "--jql");
  if (explicitJql) clauses.push(`(${explicitJql})`);
  const project = value(flags, "--project");
  if (project) clauses.push(projectClause(project));
  const assignee = value(flags, "--assignee");
  if (assignee) {
    const accountId = assignee === "me" ? await myselfId(client) : assignee;
    clauses.push(`assignee = ${jqlQuote(accountId)}`);
  }
  const status = value(flags, "--status");
  if (status) clauses.push(`status = ${jqlQuote(status)}`);
  if (clauses.length === 0) return "ORDER BY updated DESC";
  const joined = clauses.join(" AND ");
  return explicitJql ? joined : `${joined} ORDER BY updated DESC`;
}

function groupHelp(): Record<string, unknown> {
  return {
    command: "issues",
    description: "Search, view, create, and update Jira Cloud issues",
    subcommands: {
      list: "Search issues with JQL or filters",
      view: "Show one issue by key",
      transition: "List or apply a status transition",
      meta: "Show create metadata for a project",
      create: "Create an issue. Not idempotent.",
      update: "Update issue fields",
      assign: "Assign an issue by accountId",
      comment: "Add, list, edit, or delete comments. Not idempotent.",
      link: "Create or remove an issue link",
      worklog: "Add a worklog. Not idempotent.",
    },
    examples: [
      "jra-axi issues list --project AXI",
      "jra-axi issues view AXI-1",
      'jra-axi issues create --project AXI --type Task --summary "Fix login"',
    ],
  };
}

function helpFor(
  command: string,
  description: string,
  flags: Record<string, string>,
  examples: string[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { command, description, flags, examples, ...extra };
}

const HELP: Record<string, () => Record<string, unknown>> = {
  list: () =>
    helpFor(
      "issues list",
      "Search issues. Default fields: key, summary, status, assignee.",
      {
        "--jql": "Raw JQL string",
        "--project": "Project key filter",
        "--assignee": "me or a Cloud accountId",
        "--status": "Status name filter",
        "--limit": `Max results (default ${DEFAULT_LIMIT})`,
        "--fields": "Comma-separated field list",
        "--account": "Account id",
      },
      [
        "jra-axi issues list --project AXI",
        'jra-axi issues list --jql "assignee = currentUser()" --limit 20',
        'jra-axi issues list --assignee me --status "In Progress"',
      ],
      {
        defaults: {
          fields: DEFAULT_LIST_FIELDS.join(", "),
          limit: DEFAULT_LIMIT,
        },
      },
    ),
  view: () =>
    helpFor(
      "issues view",
      "Show one issue. Truncates description and comments at 800 chars.",
      {
        "--full": "Show untruncated description and comments",
        "--account": "Account id",
      },
      [
        "jra-axi issues view AXI-1",
        "jra-axi issues view AXI-1 --full",
        "jra-axi issues view AXI-1 --account work",
      ],
    ),
  transition: () =>
    helpFor(
      "issues transition",
      "List transitions or move an issue to a status.",
      {
        "--list": "List available transitions (read-only)",
        "--status": "Target status name",
        "--field": "Extra transition field name=value (repeatable)",
        "--account": "Account id",
      },
      [
        "jra-axi issues transition AXI-1 --list",
        'jra-axi issues transition AXI-1 --status "In Progress"',
        "jra-axi issues transition AXI-1 --status Done --field resolution=Done",
      ],
      {
        idempotency: "Transition to the current status is a no-op and exits 0.",
      },
    ),
  meta: () =>
    helpFor(
      "issues meta",
      "Show valid issue types and required create fields for a project.",
      {
        "--project": "Project key (required)",
        "--type": "Issue type name or id",
        "--account": "Account id",
      },
      [
        "jra-axi issues meta --project AXI",
        "jra-axi issues meta --project AXI --type Bug",
        "jra-axi issues meta --project AXI --type Task --account work",
      ],
    ),
  create: () =>
    helpFor(
      "issues create",
      "Create an issue. This command is not idempotent.",
      {
        "--project": "Project key (required)",
        "--type": "Issue type name or id (required)",
        "--summary": "Issue summary (required)",
        "--description": "Plain text or markdown, encoded as ADF",
        "--parent": "Parent issue key for sub-tasks",
        "--account": "Account id",
      },
      [
        'jra-axi issues create --project AXI --type Task --summary "Fix login"',
        'jra-axi issues create --project AXI --type Bug --summary "Crash" --description "Steps"',
        'jra-axi issues create --project AXI --type Sub-task --summary "Split" --parent AXI-1',
      ],
      {
        idempotency:
          "Create is not idempotent. A repeat call creates another issue.",
      },
    ),
  update: () =>
    helpFor(
      "issues update",
      "Update issue fields. Named flags are sugar over --field. Use --field customfield_XXXX=value for custom fields.",
      {
        "--field":
          "Field name=value (repeatable). No hard-coded custom field ids.",
        "--summary": "Sugar for --field summary=",
        "--description": "Sugar for description (ADF-encoded)",
        "--priority": "Sugar for --field priority=",
        "--labels": "Comma-separated labels",
        "--account": "Account id",
      },
      [
        'jra-axi issues update AXI-1 --summary "New title"',
        "jra-axi issues update AXI-1 --field customfield_10001=8",
        "jra-axi issues update AXI-1 --priority High --labels a,b",
      ],
    ),
  assign: () =>
    helpFor(
      "issues assign",
      "Assign an issue by Cloud accountId. Usernames are not valid.",
      {
        "--to": "me, a Cloud accountId, or none",
        "--account": "Account id",
      },
      [
        "jra-axi issues assign AXI-1 --to me",
        "jra-axi issues assign AXI-1 --to 5b10ac8d82e05b22cc7d4ef5",
        "jra-axi issues assign AXI-1 --to none",
      ],
      {
        idempotency:
          "Assigning to the current assignee is a no-op and exits 0.",
      },
    ),
  comment: () =>
    helpFor(
      "issues comment",
      "Add, list, edit, or delete comments. Comments are not idempotent.",
      {
        "--body": "Comment text, encoded as ADF",
        "--yes": "Required for edit and delete",
        "--account": "Account id",
      },
      [
        'jra-axi issues comment AXI-1 --body "Started"',
        "jra-axi issues comment AXI-1 list",
        "jra-axi issues comment AXI-1 delete 10001 --yes",
      ],
      {
        idempotency:
          "Comment add, edit, and delete are not idempotent. A repeat add creates another comment.",
      },
    ),
  link: () =>
    helpFor(
      "issues link",
      "Create an issue link or remove one by id.",
      {
        "--to": "Other issue key",
        "--type": "Link type name, for example Blocks",
        "--yes": "Required for unlink",
        "--account": "Account id",
      },
      [
        "jra-axi issues link AXI-1 --to AXI-2 --type Blocks",
        "jra-axi issues link AXI-1 unlink 10000 --yes",
        "jra-axi issues link AXI-1 --to AXI-2 --type Duplicate --account work",
      ],
      {
        idempotency:
          "Creating a link that already exists is a no-op and exits 0.",
      },
    ),
  worklog: () =>
    helpFor(
      "issues worklog",
      "Add a worklog. Worklogs are not idempotent.",
      {
        "--time": "Time spent, for example 2h or 1d 4h",
        "--comment": "Worklog comment, encoded as ADF",
        "--account": "Account id",
      },
      [
        "jra-axi issues worklog AXI-1 --time 2h",
        'jra-axi issues worklog AXI-1 --time 1h --comment "Pairing"',
        "jra-axi issues worklog AXI-1 --time 30m --account work",
      ],
      {
        idempotency:
          "Worklog add is not idempotent. A repeat call creates another worklog.",
      },
    ),
};

function maybeHelp(
  subcommand: string,
  flags: Map<string, string | true>,
): Record<string, unknown> | undefined {
  if (!flags.has("--help")) return undefined;
  const help = HELP[subcommand];
  if (!help) return groupHelp();
  return help();
}

export async function issuesCommand(
  args: string[],
  deps: IssuesDeps = {},
): Promise<Record<string, unknown>> {
  const [subcommand, ...rest] = args;
  if (!subcommand || subcommand === "--help") return groupHelp();
  const parsed = parseArgs(rest);
  const help = maybeHelp(subcommand, parsed.flags);
  if (help) return help;
  if (subcommand === "list") return listIssues(parsed, deps);
  if (subcommand === "view") return viewIssue(parsed, deps);
  if (subcommand === "transition") return transitionIssue(parsed, deps);
  if (subcommand === "meta") return metaIssue(parsed, deps);
  if (subcommand === "create") return createIssue(parsed, deps);
  if (subcommand === "update") return updateIssue(parsed, deps);
  if (subcommand === "assign") return assignIssue(parsed, deps);
  if (subcommand === "comment") return commentIssue(parsed, deps);
  if (subcommand === "link") return linkIssue(parsed, deps);
  if (subcommand === "worklog") return worklogIssue(parsed, deps);
  throw usage("Unknown issues command", ["Run `jra-axi issues --help`"]);
}

async function listIssues(
  parsed: ParsedArgs,
  deps: IssuesDeps,
): Promise<Record<string, unknown>> {
  onlyFlags(parsed.flags, parsed.fields, [
    "--jql",
    "--project",
    "--assignee",
    "--status",
    "--limit",
    "--fields",
  ]);
  if (parsed.positionals.length)
    throw usage(`Unexpected argument ${parsed.positionals[0]}`);
  const { account, client, explicit } = await session(parsed.flags, deps);
  const fields = parseFieldList(value(parsed.flags, "--fields"));
  const limit = parseLimit(parsed.flags);
  const jql = await buildJql(parsed.flags, client);
  const jiraFields = fields.filter((name) => name !== "key");
  const requestFields = jiraFields.length ? jiraFields : ["summary"];
  const [issues, total] = await Promise.all([
    searchIssues(client, jql, requestFields, limit),
    client.rest("/search/approximate-count", {
      method: "POST",
      body: { jql },
    }) as Promise<{ count?: number }>,
  ]);
  if (issues.length === 0) {
    return {
      issues: `0 results for JQL "${jql}" on account ${account.id}`,
    };
  }
  const count = aggregateCount(issues.length, total.count).replace(
    /^count: /,
    "",
  );
  return {
    count,
    issues: issues.map((issue) => listRow(issue, fields)),
    help: [
      `Run \`jra-axi issues view <key>${accountHint(account, explicit)}\` for details`,
    ],
  };
}

function commentEntries(value: unknown): {
  total: number;
  comments: JiraComment[];
} {
  if (Array.isArray(value)) {
    return { total: value.length, comments: value as JiraComment[] };
  }
  const object = record(value);
  const comments = Array.isArray(object?.comments)
    ? (object.comments as JiraComment[])
    : [];
  const total =
    typeof object?.total === "number" ? object.total : comments.length;
  return { total, comments };
}

function linkCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

async function viewIssue(
  parsed: ParsedArgs,
  deps: IssuesDeps,
): Promise<Record<string, unknown>> {
  onlyFlags(parsed.flags, parsed.fields, ["--full"]);
  const key = requireKey(parsed.positionals, "view");
  if (parsed.positionals.length > 1)
    throw usage(`Unexpected argument ${parsed.positionals[1]}`);
  const full = parsed.flags.has("--full");
  const { client, account, explicit } = await session(parsed.flags, deps);
  const issue = (await client.rest(`/issue/${encodeURIComponent(key)}`, {
    query: {
      fields:
        "summary,status,assignee,description,comment,issuelinks,parent,priority,labels,issuetype,project",
    },
  })) as JiraIssue;
  const comments = commentEntries(issue.fields.comment);
  const description = truncateText(issue.fields.description, full);
  const commentBodies = comments.comments.map((comment) => {
    const body = truncateText(comment.body, full);
    return {
      id: comment.id,
      author: displayOf(comment.author),
      body,
    };
  });
  const truncated =
    description.includes("use --full") ||
    commentBodies.some((comment) => comment.body.includes("use --full"));
  const parent = record(issue.fields.parent);
  const payload: Record<string, unknown> = {
    key: issue.key,
    summary: issue.fields.summary ?? null,
    status: named(issue.fields.status) ?? null,
    assignee: displayOf(issue.fields.assignee),
    comments: comments.total,
    links: linkCount(issue.fields.issuelinks),
    description,
    commentList: commentBodies,
  };
  if (parent && typeof parent.key === "string") payload.parent = parent.key;
  if (truncated) {
    payload.help = [
      `Run \`jra-axi issues view ${issue.key} --full${accountHint(account, explicit)}\` for the complete text`,
    ];
  }
  return { issue: payload };
}

type TransitionRecord = {
  id: string;
  name: string;
  to?: { name?: string };
  fields?: Record<string, { required?: boolean; name?: string }>;
};

async function loadTransitions(
  client: IssuesClient,
  key: string,
): Promise<TransitionRecord[]> {
  const result = (await client.rest(
    `/issue/${encodeURIComponent(key)}/transitions`,
  )) as { transitions?: TransitionRecord[] };
  return result.transitions ?? [];
}

async function transitionIssue(
  parsed: ParsedArgs,
  deps: IssuesDeps,
): Promise<Record<string, unknown>> {
  onlyFlags(
    parsed.flags,
    parsed.fields,
    ["--list", "--status", "--field"],
    true,
  );
  const key = requireKey(parsed.positionals, "transition");
  if (parsed.positionals.length > 1)
    throw usage(`Unexpected argument ${parsed.positionals[1]}`);
  const list = parsed.flags.has("--list");
  const status = value(parsed.flags, "--status");
  if (list && status) throw usage("Use either --list or --status, not both");
  if (!list && !status)
    throw usage("--list or --status is required", [
      "Run `jra-axi issues transition --help`",
    ]);
  const { client } = await session(parsed.flags, deps);
  if (list) {
    const transitions = await loadTransitions(client, key);
    return {
      issue: key,
      transitions: transitions.map((item) => ({
        id: item.id,
        name: item.name,
        to: item.to?.name ?? item.name,
      })),
    };
  }
  const issue = (await client.rest(`/issue/${encodeURIComponent(key)}`, {
    query: { fields: "status" },
  })) as JiraIssue;
  const current = named(issue.fields.status);
  if (current && current.toLowerCase() === status!.toLowerCase()) {
    return { issue: key, status: `already ${current} (no-op)` };
  }
  const transitions = await loadTransitions(client, key);
  const wanted = status!.toLowerCase();
  const match = transitions.find(
    (item) =>
      item.name.toLowerCase() === wanted ||
      item.to?.name?.toLowerCase() === wanted,
  );
  if (!match) {
    const names = transitions.map((item) => item.name).join(", ") || "none";
    throw usage(`No transition to ${status}. Available: ${names}`, [
      `Run \`jra-axi issues transition ${key} --list\``,
    ]);
  }
  const extra = fieldsFromPairs(parsed.fields);
  const missing = Object.entries(match.fields ?? {})
    .filter(
      ([id, meta]) =>
        meta.required &&
        extra[id] === undefined &&
        extra[meta.name ?? ""] === undefined,
    )
    .map(([id, meta]) => meta.name ?? id);
  if (missing.length)
    throw usage(`Missing required fields: ${missing.join(", ")}`, [
      `Retry with --field ${missing[0]}=<value>`,
    ]);
  const body: Record<string, unknown> = { transition: { id: match.id } };
  if (Object.keys(extra).length) body.fields = extra;
  await client.rest(`/issue/${encodeURIComponent(key)}/transitions`, {
    method: "POST",
    body,
  });
  return {
    issue: key,
    status: match.to?.name ?? match.name,
    help: [`Run \`jra-axi issues view ${key}\` to inspect the issue`],
  };
}

function matchIssueType(
  types: JiraIssueTypeMeta[],
  type: string,
): JiraIssueTypeMeta {
  const wanted = type.toLowerCase();
  const match = types.find(
    (item) => item.id === type || item.name.toLowerCase() === wanted,
  );
  if (!match) {
    const names = types.map((item) => item.name).join(", ") || "none";
    throw usage(`Unknown issue type ${type}. Valid types: ${names}`, [
      "Run `jra-axi issues meta --project <P>`",
    ]);
  }
  return match;
}

async function metaIssue(
  parsed: ParsedArgs,
  deps: IssuesDeps,
): Promise<Record<string, unknown>> {
  onlyFlags(parsed.flags, parsed.fields, ["--project", "--type"]);
  if (parsed.positionals.length)
    throw usage(`Unexpected argument ${parsed.positionals[0]}`);
  const project = requireValue(parsed.flags, "--project");
  const { client } = await session(parsed.flags, deps);
  const types = await issueTypesForCreate(client as JiraClient, project);
  const typeName = value(parsed.flags, "--type");
  if (!typeName) {
    return {
      project,
      issueTypes: types.map((item) => ({ id: item.id, name: item.name })),
    };
  }
  const match = matchIssueType(types, typeName);
  const fields = await fieldsForIssueTypeCreate(
    client as JiraClient,
    project,
    match.id,
  );
  const required = fields
    .filter(
      (field) => field.required && !AUTO_CREATE_FIELDS.has(fieldKey(field)),
    )
    .map((field) => ({ key: fieldKey(field), name: field.name }));
  return {
    project,
    type: match.name,
    issueTypes: [{ id: match.id, name: match.name }],
    required,
  };
}

async function createIssue(
  parsed: ParsedArgs,
  deps: IssuesDeps,
): Promise<Record<string, unknown>> {
  onlyFlags(parsed.flags, parsed.fields, [
    "--project",
    "--type",
    "--summary",
    "--description",
    "--parent",
  ]);
  if (parsed.positionals.length)
    throw usage(`Unexpected argument ${parsed.positionals[0]}`);
  const project = requireValue(parsed.flags, "--project");
  const type = requireValue(parsed.flags, "--type");
  const summary = requireValue(parsed.flags, "--summary");
  const { client, account, explicit } = await session(parsed.flags, deps);
  const types = await issueTypesForCreate(client as JiraClient, project);
  const match = matchIssueType(types, type);
  const metaFields = await fieldsForIssueTypeCreate(
    client as JiraClient,
    project,
    match.id,
  );
  const description = value(parsed.flags, "--description");
  const parent = value(parsed.flags, "--parent");
  const provided = new Set(["project", "issuetype", "summary"]);
  if (description !== undefined) provided.add("description");
  if (parent !== undefined) provided.add("parent");
  const missing = metaFields
    .filter(
      (field) =>
        field.required &&
        !AUTO_CREATE_FIELDS.has(fieldKey(field)) &&
        !provided.has(fieldKey(field)),
    )
    .map((field) => `${fieldKey(field)} (${field.name})`);
  if (missing.length)
    throw usage(`Missing required fields: ${missing.join(", ")}`, [
      `Run \`jra-axi issues meta --project ${project} --type ${match.name}\``,
    ]);
  const fields: Record<string, unknown> = {
    project: { key: project },
    issuetype: { id: match.id },
    summary,
  };
  if (description !== undefined) fields.description = toAdf(description);
  if (parent !== undefined) fields.parent = { key: parent };
  const created = (await client.rest("/issue", {
    method: "POST",
    body: { fields },
  })) as { id?: string; key?: string };
  return {
    created: created.key,
    id: created.id,
    help: [
      `Run \`jra-axi issues view ${created.key}${accountHint(account, explicit)}\` for details`,
    ],
  };
}

async function updateIssue(
  parsed: ParsedArgs,
  deps: IssuesDeps,
): Promise<Record<string, unknown>> {
  onlyFlags(
    parsed.flags,
    parsed.fields,
    ["--field", "--summary", "--description", "--priority", "--labels"],
    true,
  );
  const key = requireKey(parsed.positionals, "update");
  if (parsed.positionals.length > 1)
    throw usage(`Unexpected argument ${parsed.positionals[1]}`);
  const fields = fieldsFromPairs(parsed.fields);
  const summary = value(parsed.flags, "--summary");
  const description = value(parsed.flags, "--description");
  const priority = value(parsed.flags, "--priority");
  const labels = value(parsed.flags, "--labels");
  if (summary !== undefined) fields.summary = summary;
  if (description !== undefined) fields.description = toAdf(description);
  if (priority !== undefined) fields.priority = { name: priority };
  if (labels !== undefined)
    fields.labels = labels
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  if (Object.keys(fields).length === 0)
    throw usage(
      "Set --field, --summary, --description, --priority, or --labels",
    );
  const { client, account, explicit } = await session(parsed.flags, deps);
  await client.rest(`/issue/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: { fields },
  });
  return {
    updated: key,
    help: [
      `Run \`jra-axi issues view ${key}${accountHint(account, explicit)}\` for details`,
    ],
  };
}

async function assignIssue(
  parsed: ParsedArgs,
  deps: IssuesDeps,
): Promise<Record<string, unknown>> {
  onlyFlags(parsed.flags, parsed.fields, ["--to"]);
  const key = requireKey(parsed.positionals, "assign");
  if (parsed.positionals.length > 1)
    throw usage(`Unexpected argument ${parsed.positionals[1]}`);
  const to = requireValue(parsed.flags, "--to");
  const { client } = await session(parsed.flags, deps);
  const target =
    to === "none" ? null : to === "me" ? await myselfId(client) : to;
  const issue = (await client.rest(`/issue/${encodeURIComponent(key)}`, {
    query: { fields: "assignee" },
  })) as JiraIssue;
  const current = accountIdOf(issue.fields.assignee) ?? null;
  if (current === target) {
    return {
      issue: key,
      assignee: `already ${target ?? "unassigned"} (no-op)`,
    };
  }
  await client.rest(`/issue/${encodeURIComponent(key)}/assignee`, {
    method: "PUT",
    body: { accountId: target },
  });
  return { issue: key, assignee: target };
}

async function commentIssue(
  parsed: ParsedArgs,
  deps: IssuesDeps,
): Promise<Record<string, unknown>> {
  const action = parsed.positionals[1];
  if (action === "list") {
    onlyFlags(parsed.flags, parsed.fields, []);
    const key = requireKey(parsed.positionals, "comment");
    if (parsed.positionals.length > 2)
      throw usage(`Unexpected argument ${parsed.positionals[2]}`);
    const { client, account } = await session(parsed.flags, deps);
    const result = (await client.rest(
      `/issue/${encodeURIComponent(key)}/comment`,
    )) as { comments?: JiraComment[]; total?: number };
    const comments = result.comments ?? [];
    if (comments.length === 0) {
      return {
        comments: `0 comments on ${key} for account ${account.id}`,
      };
    }
    return {
      count: comments.length,
      comments: comments.map((comment) => ({
        id: comment.id,
        author: displayOf(comment.author),
        body: truncateText(comment.body),
      })),
    };
  }
  if (action === "edit" || action === "delete") {
    onlyFlags(
      parsed.flags,
      parsed.fields,
      action === "edit" ? ["--body", "--yes"] : ["--yes"],
    );
    const key = requireKey(parsed.positionals, "comment");
    const commentId = parsed.positionals[2];
    if (!commentId)
      throw usage(`comment ${action} requires a comment id`, [
        `Run \`jra-axi issues comment ${key} ${action} <commentId> --yes\``,
      ]);
    if (parsed.positionals.length > 3)
      throw usage(`Unexpected argument ${parsed.positionals[3]}`);
    requireYes(parsed.flags, `comment ${action}`);
    const { client } = await session(parsed.flags, deps);
    const path = `/issue/${encodeURIComponent(key)}/comment/${encodeURIComponent(commentId)}`;
    if (action === "delete") {
      await client.rest(path, { method: "DELETE" });
      return { deleted: commentId, issue: key };
    }
    const body = requireValue(parsed.flags, "--body");
    await client.rest(path, {
      method: "PUT",
      body: { body: toAdf(body) },
    });
    return { edited: commentId, issue: key };
  }
  onlyFlags(parsed.flags, parsed.fields, ["--body"]);
  const key = requireKey(parsed.positionals, "comment");
  if (parsed.positionals.length > 1)
    throw usage(`Unknown comment action ${parsed.positionals[1]}`, [
      "Use --body, list, edit, or delete",
    ]);
  const body = requireValue(parsed.flags, "--body");
  const { client } = await session(parsed.flags, deps);
  const created = (await client.rest(
    `/issue/${encodeURIComponent(key)}/comment`,
    {
      method: "POST",
      body: { body: toAdf(body) },
    },
  )) as { id?: string };
  return {
    added: created.id,
    issue: key,
    help: [
      "Comment add is not idempotent. A repeat call creates another comment.",
    ],
  };
}

function existingOutwardLink(
  links: unknown,
  type: string,
  toKey: string,
): boolean {
  if (!Array.isArray(links)) return false;
  const wantedType = type.toLowerCase();
  const wantedKey = toKey.toUpperCase();
  return links.some((item) => {
    const link = record(item);
    const linkType = named(link?.type)?.toLowerCase();
    const inward = record(link?.inwardIssue);
    const other =
      typeof inward?.key === "string" ? inward.key.toUpperCase() : undefined;
    return linkType === wantedType && other === wantedKey;
  });
}

async function linkIssue(
  parsed: ParsedArgs,
  deps: IssuesDeps,
): Promise<Record<string, unknown>> {
  const action = parsed.positionals[1];
  if (action === "unlink") {
    onlyFlags(parsed.flags, parsed.fields, ["--yes"]);
    const key = requireKey(parsed.positionals, "link");
    const linkId = parsed.positionals[2];
    if (!linkId)
      throw usage("link unlink requires a link id", [
        `Run \`jra-axi issues link ${key} unlink <linkId> --yes\``,
      ]);
    if (parsed.positionals.length > 3)
      throw usage(`Unexpected argument ${parsed.positionals[3]}`);
    requireYes(parsed.flags, "link unlink");
    const { client } = await session(parsed.flags, deps);
    await client.rest(`/issueLink/${encodeURIComponent(linkId)}`, {
      method: "DELETE",
    });
    return { unlinked: linkId, issue: key };
  }
  onlyFlags(parsed.flags, parsed.fields, ["--to", "--type"]);
  const key = requireKey(parsed.positionals, "link");
  if (parsed.positionals.length > 1)
    throw usage(`Unexpected argument ${parsed.positionals[1]}`);
  const to = requireValue(parsed.flags, "--to");
  const type = requireValue(parsed.flags, "--type");
  const { client } = await session(parsed.flags, deps);
  const issue = (await client.rest(`/issue/${encodeURIComponent(key)}`, {
    query: { fields: "issuelinks" },
  })) as JiraIssue;
  if (existingOutwardLink(issue.fields.issuelinks, type, to)) {
    return {
      issue: key,
      link: `already linked to ${to} as ${type} (no-op)`,
    };
  }
  await client.rest("/issueLink", {
    method: "POST",
    body: {
      type: { name: type },
      outwardIssue: { key },
      inwardIssue: { key: to },
    },
  });
  return {
    issue: key,
    linked: to,
    type,
    help: [`Run \`jra-axi issues view ${key}\` to inspect links`],
  };
}

async function worklogIssue(
  parsed: ParsedArgs,
  deps: IssuesDeps,
): Promise<Record<string, unknown>> {
  onlyFlags(parsed.flags, parsed.fields, ["--time", "--comment"]);
  const key = requireKey(parsed.positionals, "worklog");
  if (parsed.positionals.length > 1)
    throw usage(`Unexpected argument ${parsed.positionals[1]}`);
  const time = requireValue(parsed.flags, "--time");
  const comment = value(parsed.flags, "--comment");
  const { client } = await session(parsed.flags, deps);
  const body: Record<string, unknown> = { timeSpent: time };
  if (comment !== undefined) body.comment = toAdf(comment);
  const created = (await client.rest(
    `/issue/${encodeURIComponent(key)}/worklog`,
    {
      method: "POST",
      body,
    },
  )) as { id?: string };
  return {
    worklog: created.id,
    issue: key,
    time,
    help: [
      "Worklog add is not idempotent. A repeat call creates another worklog.",
    ],
  };
}
