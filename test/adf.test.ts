import { describe, expect, it } from "vitest";
import { adfToText, toAdf } from "../src/adf.js";

describe("ADF", () => {
  it("round trips markdown and plain text", () => {
    const value = "# Title\n\nHello **Jira**\nline two\n\n- first\n- second";
    expect(adfToText(toAdf(value))).toBe("Title\n\nHello Jira\nline two\n\n- first\n- second");
  });
});
