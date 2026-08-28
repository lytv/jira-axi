import { describe, expect, it } from "vitest";
import { adfToText, toAdf } from "../src/adf.js";

describe("ADF", () => {
  it("round trips markdown and plain text", () => {
    const value = "# Title\n\nHello **Jira**\nline two\n\n- first\n- second";
    expect(adfToText(toAdf(value))).toBe(
      "Title\n\nHello Jira\nline two\n\n- first\n- second",
    );
  });
  it("numbers ordered lists from their ADF start order", () => {
    expect(
      adfToText({
        content: [
          {
            type: "orderedList",
            attrs: { order: 3 },
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "first" }],
                  },
                ],
              },
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "second" }],
                  },
                ],
              },
            ],
          },
        ],
      }),
    ).toBe("3. first\n4. second");
  });
});
