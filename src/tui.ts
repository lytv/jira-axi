import type { AccountSummary, TuiSummary } from "./tui-data.js";

/**
 * Human terminal report: a card per account. Presentation only - it renders
 * the same summary the TOON/JSON surfaces receive and derives nothing new.
 */

export type TuiOptions = {
  /** Raw terminal width; clamped to [80, 120], defaults to 80. */
  columns?: number;
  noColor?: boolean;
  /** Dim closing line used by the live report for its key hint. */
  footerHint?: string;
};

const CARD_WIDTH = 40;
const CARD_INTERIOR = CARD_WIDTH - 4;
const CARD_GUTTER = 2;
const TWO_COLUMN_MIN = CARD_WIDTH * 2 + CARD_GUTTER;
const MIN_COLUMNS = 80;
const MAX_COLUMNS = 120;

const RESET = "\x1b[0m";
const DIM = "\x1b[90m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";

function colorize(text: string, code: string, noColor: boolean): string {
  return noColor ? text : `${code}${text}${RESET}`;
}

/** Honors NO_COLOR, TERM=dumb, and non-TTY stdout; FORCE_COLOR re-enables. */
export function detectTuiColor(
  env: Record<string, string | undefined>,
  isTty: boolean,
): boolean {
  const force = env.FORCE_COLOR;
  if (force !== undefined && force !== "0") return true;
  if (env.NO_COLOR !== undefined) return false;
  if (env.TERM === "dumb") return false;
  return isTty;
}

function truncate(text: string, width: number): string {
  if (text.length <= width) return text;
  if (width <= 1) return text.slice(0, width);
  return `${text.slice(0, width - 1)}…`;
}

function padRight(text: string, width: number): string {
  const clipped = truncate(text, width);
  return clipped + " ".repeat(Math.max(0, width - clipped.length));
}

type Row = { text: string; color?: string };

function contentLine(row: Row, noColor: boolean): string {
  const padded = padRight(row.text, CARD_INTERIOR);
  const body = row.color ? colorize(padded, row.color, noColor) : padded;
  return `│ ${body} │`;
}

function blankLine(): string {
  return `│ ${" ".repeat(CARD_INTERIOR)} │`;
}

function topBorder(title: string): string {
  const label = ` ${title} `;
  const dashes = Math.max(0, CARD_WIDTH - 2 - label.length);
  return `┌${label}${"─".repeat(dashes)}┐`;
}

function bottomBorder(): string {
  return `└${"─".repeat(CARD_WIDTH - 2)}┘`;
}

function hostnameOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return baseUrl;
  }
}

function connectionRow(account: AccountSummary): Row {
  if (account.connection === "connected") {
    return { text: "● connected", color: GREEN };
  }
  const label = account.connection === "expired" ? "expired" : "unreachable";
  const detail = account.detail ? ` · ${truncate(account.detail, 24)}` : "";
  return {
    text: `○ ${label}${detail}`,
    color: account.connection === "expired" ? YELLOW : RED,
  };
}

function sprintText(sprint: NonNullable<AccountSummary["sprint"]>): string {
  if (sprint.daysLeft === undefined) return sprint.name;
  if (sprint.daysLeft === 0) return `${sprint.name} · ends today`;
  return `${sprint.name} · ${sprint.daysLeft}d left`;
}

function buildCard(account: AccountSummary, noColor: boolean): string[] {
  const lines: string[] = [topBorder(account.id)];
  lines.push(contentLine({ text: hostnameOf(account.site) }, noColor));
  lines.push(contentLine({ text: account.email }, noColor));
  lines.push(contentLine(connectionRow(account), noColor));
  if (account.connection === "connected") {
    lines.push(blankLine());
    lines.push(
      contentLine(
        {
          text: `assigned ${account.assigned ?? 0}      overdue ${account.overdue ?? 0}`,
        },
        noColor,
      ),
    );
    lines.push(
      contentLine(
        {
          text: `in review ${account.inReview ?? 0}     blocked ${account.blocked ?? 0}`,
        },
        noColor,
      ),
    );
    if (account.sprint) {
      lines.push(blankLine());
      lines.push(contentLine({ text: sprintText(account.sprint) }, noColor));
    }
  }
  lines.push(bottomBorder());
  return lines;
}

function layoutCards(cards: string[][], twoColumn: boolean): string[] {
  if (!twoColumn) {
    return cards.flatMap((card, index) => (index === 0 ? card : ["", ...card]));
  }
  const lines: string[] = [];
  for (let index = 0; index < cards.length; index += 2) {
    const left = cards[index];
    const right = cards[index + 1] as string[] | undefined;
    const height = Math.max(left.length, right?.length ?? 0);
    for (let row = 0; row < height; row++) {
      const leftLine = left[row] ?? " ".repeat(CARD_WIDTH);
      if (!right) {
        lines.push(leftLine);
        continue;
      }
      const rightLine = right[row] ?? " ".repeat(CARD_WIDTH);
      lines.push(`${leftLine}  ${rightLine}`);
    }
    if (index + 2 < cards.length) lines.push("");
  }
  return lines;
}

function headerText(summary: TuiSummary): string {
  const connected = summary.accounts.filter(
    (account) => account.connection === "connected",
  ).length;
  const expired = summary.accounts.filter(
    (account) => account.connection === "expired",
  ).length;
  const unreachable = summary.accounts.length - connected - expired;
  const time = new Date(summary.generatedAt).toISOString().slice(11, 19);
  const parts = [
    "jra-axi accounts",
    `${time} UTC`,
    `${connected} connected`,
    `${expired} signed out`,
  ];
  if (unreachable > 0) parts.push(`${unreachable} unreachable`);
  return parts.join(" · ");
}

export function renderAccountsTui(
  summary: TuiSummary,
  options: TuiOptions = {},
): string {
  const columns = Math.min(
    MAX_COLUMNS,
    Math.max(MIN_COLUMNS, options.columns ?? MIN_COLUMNS),
  );
  const noColor = options.noColor ?? false;
  const twoColumn = columns >= TWO_COLUMN_MIN;
  const cards = summary.accounts.map((account) => buildCard(account, noColor));

  const lines: string[] = [];
  lines.push(`  ${colorize(headerText(summary), DIM, noColor)}`);
  lines.push("");
  if (cards.length === 0) {
    lines.push(`  ${colorize("No accounts configured", DIM, noColor)}`);
  } else {
    lines.push(...layoutCards(cards, twoColumn));
  }
  if (options.footerHint !== undefined) {
    lines.push("");
    lines.push(`  ${colorize(truncate(options.footerHint, columns - 2), DIM, noColor)}`);
  }
  return lines.join("\n");
}
