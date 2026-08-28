import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { AxiError } from "axi-sdk-js";
import { load } from "js-yaml";
import { JiraClient } from "./client.js";
import { detectTuiColor, renderAccountsTui } from "./tui.js";
import { formatInterval, runLiveTui, type LiveTuiIo } from "./tui-live.js";
import { loadTuiSummary, type TuiClient, type TuiSummary } from "./tui-data.js";
import type { Account, TokenSourceKind } from "./types.js";

export const accountsPath = (): string =>
  join(
    process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
    "jra-axi",
    "accounts.json",
  );
type AccountsFile = { accounts: Account[] };

function usage(message: string, suggestions: string[] = []): AxiError {
  return new AxiError(message, "VALIDATION_ERROR", suggestions);
}

function hasRawToken(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, child]) =>
      (key !== "tokenSource" && key.toLowerCase().includes("token")) ||
      hasRawToken(child),
  );
}

function ensureAccount(value: unknown): Account {
  const account = value as Account;
  if (
    !account?.id ||
    !account.baseUrl ||
    !account.email ||
    !account.tokenSource?.kind ||
    !account.tokenSource.ref
  )
    throw usage("Account config has required fields missing");
  if (
    !(
      [
        "env",
        "keychain",
        "file",
        "acli-ref",
        "jira-cli-ref",
      ] as TokenSourceKind[]
    ).includes(account.tokenSource.kind)
  )
    throw usage(`Unsupported token source for ${account.id}`);
  if (hasRawToken(account))
    throw usage(`Account ${account.id} stores a raw token`);
  const url = new URL(account.baseUrl);
  if (
    url.protocol !== "https:" ||
    url.hostname.endsWith(".atlassian.net") === false
  )
    throw usage(`Account ${account.id} is not a Jira Cloud site`);
  return {
    ...account,
    default: Boolean(account.default),
    deployment: "cloud",
    authScheme: "basic",
  };
}

export async function readAccounts(path = accountsPath()): Promise<Account[]> {
  try {
    const data = JSON.parse(await readFile(path, "utf8")) as AccountsFile;
    return (data.accounts ?? []).map(ensureAccount);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    if (error instanceof AxiError) throw error;
    throw usage(`Cannot read account config: ${(error as Error).message}`);
  }
}

export async function writeAccounts(
  accounts: Account[],
  path = accountsPath(),
): Promise<void> {
  const valid = accounts.map(ensureAccount);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(
    temporary,
    `${JSON.stringify({ accounts: valid }, null, 2)}\n`,
    { mode: 0o600 },
  );
  await rename(temporary, path);
}

export async function tokenForAccount(account: Account): Promise<string> {
  const { kind, ref } = account.tokenSource;
  if (kind === "env" || kind === "jira-cli-ref") {
    const token = process.env[ref];
    if (!token)
      throw new AxiError(
        `Token environment variable ${ref} is not set`,
        "JIRA_ERROR",
        ["Set the variable, then retry"],
      );
    return token;
  }
  if (kind === "file") {
    const info = await stat(ref);
    if ((info.mode & 0o077) !== 0)
      throw new AxiError(
        `Token file ${ref} must have mode 0600`,
        "JIRA_ERROR",
        ["Run chmod 600 on the token file"],
      );
    return (await readFile(ref, "utf8")).trim();
  }
  if (kind === "keychain")
    throw new AxiError(
      `Keychain token source ${ref} is not available in this build`,
      "JIRA_ERROR",
      ["Use --token-env or --token-file"],
    );
  throw new AxiError(
    `acli token source ${ref} needs a Basic API token`,
    "JIRA_ERROR",
    ["Use accounts add --token-env <VAR>"],
  );
}

export function resolveAccount(
  accounts: Account[],
  explicit?: string,
): Account {
  if (explicit) {
    const account = accounts.find((item) => item.id === explicit);
    if (!account)
      throw usage(`Account ${explicit} does not exist`, [
        "Run `jra-axi accounts list`",
      ]);
    return account;
  }
  if (accounts.length === 1) return accounts[0];
  const defaults = accounts.filter((account) => account.default);
  if (defaults.length === 1) return defaults[0];
  throw usage(
    `Select an account with --account. Configured accounts: ${accounts.map((account) => account.id).join(", ") || "none"}`,
    ["Run `jra-axi accounts default <id>`"],
  );
}

function flagMap(args: string[]): Map<string, string | true> {
  const flags = new Map<string, string | true>();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith("--")) throw usage(`Unexpected argument ${arg}`);
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      flags.set(arg, next);
      index++;
    } else flags.set(arg, true);
  }
  return flags;
}

function onlyFlags(flags: Map<string, string | true>, valid: string[]): void {
  for (const flag of flags.keys())
    if (!valid.includes(flag))
      throw usage(`Unknown flag ${flag}`, [`Valid flags: ${valid.join(", ")}`]);
}
function value(
  flags: Map<string, string | true>,
  name: string,
): string | undefined {
  const found = flags.get(name);
  return typeof found === "string" ? found : undefined;
}
function requireValue(flags: Map<string, string | true>, name: string): string {
  return (
    value(flags, name) ??
    (() => {
      throw usage(`${name} is required`);
    })()
  );
}
function baseUrl(site: string): string {
  return site.startsWith("http")
    ? site.replace(/\/$/, "")
    : `https://${site.replace(/\.atlassian\.net$/, "")}.atlassian.net`;
}

function accountFromFlags(flags: Map<string, string | true>): Account {
  const sources: Array<[TokenSourceKind, string | undefined]> = [
    ["env", value(flags, "--token-env")],
    ["keychain", value(flags, "--token-keychain")],
    ["file", value(flags, "--token-file")],
  ];
  const selected = sources.filter(
    (source): source is [TokenSourceKind, string] => Boolean(source[1]),
  );
  if (selected.length !== 1)
    throw usage("Set exactly one token source", ["Use --token-env <VAR>"]);
  return ensureAccount({
    id: requireValue(flags, "--id"),
    baseUrl: baseUrl(requireValue(flags, "--site")),
    email: requireValue(flags, "--email"),
    tokenSource: { kind: selected[0][0], ref: selected[0][1] },
    default: flags.has("--default"),
    cloudId: value(flags, "--cloud-id"),
    deployment: "cloud",
    authScheme: "basic",
    defaultProject: value(flags, "--project"),
    defaultBoardId: value(flags, "--board"),
  });
}

type ImportedSite = {
  baseUrl: string;
  email: string;
  project?: string;
  board?: string;
  oauth: boolean;
};
function sitesFrom(value: unknown): ImportedSite[] {
  const sites: ImportedSite[] = [];
  const walk = (item: unknown, inheritedOAuth = false): void => {
    if (Array.isArray(item)) {
      item.forEach((child) => walk(child, inheritedOAuth));
      return;
    }
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const oauth =
      inheritedOAuth ||
      Object.entries(record).some(
        ([key, child]) =>
          key.toLowerCase().includes("oauth") ||
          (typeof child === "string" && child.toLowerCase().includes("oauth")),
      );
    const rawUrl = [
      record.baseUrl,
      record.url,
      record.server,
      record.site,
    ].find(
      (candidate): candidate is string =>
        typeof candidate === "string" && candidate.includes("atlassian.net"),
    );
    if (rawUrl) {
      const email =
        [record.email, record.username, record.login, record.user].find(
          (candidate): candidate is string => typeof candidate === "string",
        ) ?? "";
      const project =
        typeof record.project === "string"
          ? record.project
          : typeof (record.project as Record<string, unknown> | undefined)
                ?.key === "string"
            ? (record.project as Record<string, string>).key
            : undefined;
      const board =
        typeof record.board === "string" || typeof record.board === "number"
          ? String(record.board)
          : undefined;
      sites.push({ baseUrl: baseUrl(rawUrl), email, project, board, oauth });
    }
    Object.values(record).forEach((child) => walk(child, oauth));
  };
  walk(value);
  return sites.filter((site) => site.email);
}

export async function importAccounts(
  tool: "acli" | "jira-cli",
  sourcePath: string,
  existing: Account[],
  tokenEnv?: string,
): Promise<Account[]> {
  const source = load(await readFile(sourcePath, "utf8"));
  const found = sitesFrom(source);
  if (found.some((site) => site.oauth))
    throw usage("OAuth credentials cannot import as Jira Basic API tokens", [
      "Use accounts add with --token-env <VAR>",
    ]);
  const sites = [
    ...new Map(
      found.map((site) => [`${site.baseUrl}|${site.email}`, site]),
    ).values(),
  ];
  if (sites.length === 0)
    throw usage(`No Jira Cloud site found in ${sourcePath}`);
  const multiple = sites.length > 1;
  const ids = new Set(existing.map((account) => account.id));
  const additions: Account[] = [];
  for (const [index, site] of sites.entries()) {
    const id = uniqueId(site.baseUrl, ids, index);
    ids.add(id);
    additions.push(
      ensureAccount({
        id,
        baseUrl: site.baseUrl,
        email: site.email,
        tokenSource: {
          kind: tool === "jira-cli" ? "jira-cli-ref" : "acli-ref",
          ref:
            tokenEnv ??
            (tool === "jira-cli" ? "JIRA_API_TOKEN" : "ACLI_JIRA_API_TOKEN"),
        },
        default: !multiple && existing.length === 0 && index === 0,
        deployment: "cloud",
        authScheme: "basic",
        defaultProject: site.project,
        defaultBoardId: site.board,
        importedFrom: {
          tool,
          path: sourcePath,
          importedAt: new Date().toISOString(),
        },
      }),
    );
  }
  return additions;
}
function uniqueId(url: string, ids: Set<string>, index: number): string {
  const seed =
    new URL(url).hostname
      .replace(".atlassian.net", "")
      .replace(/[^a-z0-9]+/gi, "-")
      .toLowerCase() || "jira";
  let id = index ? `${seed}-${index + 1}` : seed;
  for (let suffix = 2; ids.has(id); suffix++) id = `${seed}-${suffix}`;
  return id;
}

const DEFAULT_TUI_REFRESH_SECONDS = 300;
const MIN_TUI_REFRESH_SECONDS = 30;
const MAX_TUI_REFRESH_SECONDS = 86_400;

export type AccountsTuiOptions = {
  readAccounts: () => Promise<Account[]>;
  tokenForAccount: (account: Account) => Promise<string>;
  createClient: (account: Account, token: string) => TuiClient;
  isInteractive: () => boolean;
  io: () => LiveTuiIo;
  columns: () => number | undefined;
  noColor: () => boolean;
};

const defaultTuiOptions: AccountsTuiOptions = {
  readAccounts,
  tokenForAccount,
  createClient: (account, token) => new JiraClient(account, token),
  isInteractive: () =>
    process.stdout.isTTY === true && process.stdin.isTTY === true,
  io: () => processLiveTuiIo(),
  columns: () => process.stdout.columns,
  noColor: () => !detectTuiColor(process.env, process.stdout.isTTY === true),
};

function processLiveTuiIo(): LiveTuiIo {
  return {
    stdout: process.stdout,
    stdin: process.stdin,
    setTimer: (callback, milliseconds) => setTimeout(callback, milliseconds),
    clearTimer: (handle) => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
    onResize: (listener) => {
      process.stdout.on("resize", listener);
      return () => {
        process.stdout.off("resize", listener);
      };
    },
    onSignal: (listener) => {
      const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
      for (const signal of signals) process.on(signal, listener);
      return () => {
        for (const signal of signals) process.off(signal, listener);
      };
    },
  };
}

function parseRefreshValue(value: string | undefined): number {
  const match = /^(\d{1,7})(s|m|h)?$/.exec(value?.trim() ?? "");
  if (!match)
    throw usage("--refresh requires a duration such as 30s, 5m, or 1h");
  const multiplier = match[2] === "h" ? 3600 : match[2] === "m" ? 60 : 1;
  const seconds = Number(match[1]) * multiplier;
  if (seconds < MIN_TUI_REFRESH_SECONDS || seconds > MAX_TUI_REFRESH_SECONDS)
    throw usage(
      `--refresh must be between ${MIN_TUI_REFRESH_SECONDS}s and ${MAX_TUI_REFRESH_SECONDS / 3600}h`,
    );
  return seconds;
}

function parseTuiFlags(args: string[]): {
  once: boolean;
  refreshSeconds?: number;
} {
  if (args.includes("--json"))
    throw usage("--tui and --json are mutually exclusive output modes");
  const flags = flagMap(args);
  onlyFlags(flags, ["--once", "--refresh"]);
  const once = flags.has("--once");
  const refreshFlag = flags.get("--refresh");
  const refreshSeconds =
    refreshFlag === undefined
      ? undefined
      : parseRefreshValue(refreshFlag === true ? undefined : refreshFlag);
  if (once && refreshSeconds !== undefined)
    throw usage("Use either --once or --refresh, not both");
  return {
    once,
    ...(refreshSeconds === undefined ? {} : { refreshSeconds }),
  };
}

export async function accountsTui(
  args: string[],
  options: AccountsTuiOptions = defaultTuiOptions,
): Promise<string> {
  const flags = parseTuiFlags(args);
  const accounts = await options.readAccounts();
  const dataDeps = {
    tokenForAccount: options.tokenForAccount,
    createClient: options.createClient,
  };
  const frame = (summary: TuiSummary, footerHint?: string): string =>
    renderAccountsTui(summary, {
      columns: options.columns(),
      noColor: options.noColor(),
      ...(footerHint === undefined ? {} : { footerHint }),
    });
  if (flags.once || !options.isInteractive()) {
    return frame(await loadTuiSummary(accounts, dataDeps));
  }
  const refreshSeconds = flags.refreshSeconds ?? DEFAULT_TUI_REFRESH_SECONDS;
  const hint = `Press q to quit · refreshing every ${formatInterval(refreshSeconds)}`;
  const last = await runLiveTui<TuiSummary>({
    load: () => loadTuiSummary(accounts, dataDeps),
    render: (summary) => frame(summary, hint),
    intervalMillis: refreshSeconds * 1000,
    io: options.io(),
  });
  return last === undefined ? "" : frame(last);
}

export async function accountsCommand(
  args: string[],
): Promise<Record<string, unknown> | string> {
  const [subcommand, ...rest] = args;
  if (subcommand === "--tui") return accountsTui(rest);
  if (subcommand === "list") {
    if (rest.length) throw usage("accounts list accepts no flags");
    return {
      accounts: (await readAccounts()).map(({ tokenSource, ...account }) => ({
        ...account,
        tokenSource: `${tokenSource.kind}:${tokenSource.ref}`,
      })),
    };
  }
  if (subcommand === "remove") {
    const id = rest[0];
    if (!id || rest.length !== 1) throw usage("Usage: accounts remove <id>");
    const accounts = await readAccounts();
    if (!accounts.some((account) => account.id === id))
      throw usage(`Account ${id} does not exist`);
    await writeAccounts(accounts.filter((account) => account.id !== id));
    return { removed: id };
  }
  if (subcommand === "default") {
    const id = rest[0];
    if (!id || rest.length !== 1) throw usage("Usage: accounts default <id>");
    const accounts = await readAccounts();
    if (!accounts.some((account) => account.id === id))
      throw usage(`Account ${id} does not exist`);
    await writeAccounts(
      accounts.map((account) => ({ ...account, default: account.id === id })),
    );
    return { default: id };
  }
  const flags = flagMap(rest);
  if (subcommand === "add") {
    onlyFlags(flags, [
      "--id",
      "--site",
      "--email",
      "--token-env",
      "--token-keychain",
      "--token-file",
      "--cloud-id",
      "--project",
      "--board",
      "--default",
    ]);
    const account = accountFromFlags(flags);
    const accounts = await readAccounts();
    if (accounts.some((item) => item.id === account.id))
      throw usage(`Account ${account.id} already exists`);
    await writeAccounts([
      ...accounts.map((item) =>
        account.default ? { ...item, default: false } : item,
      ),
      account,
    ]);
    return { added: account.id };
  }
  if (subcommand === "import") {
    onlyFlags(flags, ["--from", "--path", "--token-env"]);
    const tool = requireValue(flags, "--from");
    if (tool !== "acli" && tool !== "jira-cli")
      throw usage("--from must be acli or jira-cli");
    const path =
      value(flags, "--path") ??
      (tool === "jira-cli"
        ? join(homedir(), ".config", ".jira", ".config.yml")
        : join(
            process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
            "acli",
            "config.yml",
          ));
    const accounts = await readAccounts();
    const added = await importAccounts(
      tool,
      path,
      accounts,
      value(flags, "--token-env"),
    );
    await writeAccounts([...accounts, ...added]);
    return {
      imported: added.map((account) => account.id),
      default: added
        .filter((account) => account.default)
        .map((account) => account.id),
      ...(added.length > 1
        ? {
            help: "Run `jra-axi accounts default <id>` to select a default account",
          }
        : {}),
    };
  }
  throw usage("Unknown accounts command", ["Run `jra-axi accounts --help`"]);
}
