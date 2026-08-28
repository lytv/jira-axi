import { describe, expect, it } from "vitest";
import { detectTuiColor, renderAccountsTui } from "../src/tui.js";
import type { TuiSummary } from "../src/tui-data.js";

const summary: TuiSummary = {
  generatedAt: "2026-08-28T14:32:05.000Z",
  accounts: [
    {
      id: "work",
      site: "https://work.atlassian.net",
      email: "agent@example.com",
      connection: "connected",
      assigned: 12,
      overdue: 2,
      inReview: 3,
      blocked: 1,
      sprint: { name: "Sprint 24", daysLeft: 3 },
    },
    {
      id: "side",
      site: "https://side.atlassian.net",
      email: "agent@example.com",
      connection: "expired",
      detail: "401 unauthorized",
    },
  ],
};

describe("renderAccountsTui", () => {
  it("renders one card per account with site, connection, counts, and sprint", () => {
    const output = renderAccountsTui(summary, { columns: 100, noColor: true });
    expect(output).toContain("jra-axi accounts");
    expect(output).toContain("14:32:05 UTC");
    expect(output).toContain("1 connected");
    expect(output).toContain("1 signed out");
    expect(output).toContain("work.atlassian.net");
    expect(output).toContain("agent@example.com");
    expect(output).toContain("connected");
    expect(output).toContain("assigned 12      overdue 2");
    expect(output).toContain("in review 3     blocked 1");
    expect(output).toContain("Sprint 24 · 3d left");
    expect(output).toContain("side.atlassian.net");
    expect(output).toContain("expired · 401 unauthorized");
  });

  it("omits counts and sprint for a disconnected account", () => {
    const output = renderAccountsTui(
      { generatedAt: summary.generatedAt, accounts: [summary.accounts[1]] },
      { columns: 100, noColor: true },
    );
    expect(output).not.toContain("assigned");
    expect(output).not.toContain("Sprint");
  });

  it("shows a message when no accounts are configured", () => {
    const output = renderAccountsTui(
      { generatedAt: summary.generatedAt, accounts: [] },
      { columns: 100, noColor: true },
    );
    expect(output).toContain("No accounts configured");
  });

  it("emits no ANSI escapes when noColor is set", () => {
    const output = renderAccountsTui(summary, { columns: 100, noColor: true });
    // eslint-disable-next-line no-control-regex
    expect(output).not.toMatch(/\x1b\[/);
  });

  it("emits ANSI escapes when color is enabled", () => {
    const output = renderAccountsTui(summary, { columns: 100, noColor: false });
    // eslint-disable-next-line no-control-regex
    expect(output).toMatch(/\x1b\[/);
  });

  it("appends the footer hint used by the live loop", () => {
    const output = renderAccountsTui(summary, {
      columns: 100,
      noColor: true,
      footerHint: "Press q to quit · refreshing every 5m",
    });
    expect(output).toContain("Press q to quit · refreshing every 5m");
  });

  it("clamps columns to the [80, 120] range", () => {
    const narrow = renderAccountsTui(summary, { columns: 10, noColor: true });
    const wide = renderAccountsTui(summary, { columns: 500, noColor: true });
    const narrowLineWidth = Math.max(
      ...narrow.split("\n").map((line) => line.length),
    );
    const wideLineWidth = Math.max(
      ...wide.split("\n").map((line) => line.length),
    );
    expect(narrowLineWidth).toBeLessThanOrEqual(80);
    expect(wideLineWidth).toBeGreaterThan(narrowLineWidth);
  });

  it("lays cards out two-up at wide columns and stacked at narrow columns", () => {
    const wide = renderAccountsTui(summary, { columns: 120, noColor: true });
    const narrow = renderAccountsTui(summary, { columns: 80, noColor: true });
    const wideFirstLine = wide
      .split("\n")
      .find((line) => line.includes("┌ work"));
    expect(wideFirstLine).toContain("┌ side");
    const narrowFirstLine = narrow
      .split("\n")
      .find((line) => line.includes("┌ work"));
    expect(narrowFirstLine).not.toContain("┌ side");
  });
});

describe("detectTuiColor", () => {
  it("disables color under NO_COLOR regardless of TTY", () => {
    expect(detectTuiColor({ NO_COLOR: "1" }, true)).toBe(false);
  });

  it("disables color on a non-TTY stdout", () => {
    expect(detectTuiColor({}, false)).toBe(false);
  });

  it("enables color on an interactive TTY with no overrides", () => {
    expect(detectTuiColor({}, true)).toBe(true);
  });

  it("lets FORCE_COLOR re-enable color on a non-TTY stream", () => {
    expect(detectTuiColor({ FORCE_COLOR: "1" }, false)).toBe(true);
  });
});
