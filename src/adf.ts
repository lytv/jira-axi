type AdfNode = { type: string; text?: string; content?: AdfNode[]; attrs?: Record<string, unknown>; marks?: Array<{ type: string }> };
export type AdfDocument = { version: 1; type: "doc"; content: AdfNode[] };

function inline(text: string): AdfNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((part) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return { type: "text", text: part.slice(2, -2), marks: [{ type: "strong" }] };
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return { type: "text", text: part.slice(1, -1), marks: [{ type: "code" }] };
    }
    return { type: "text", text: part };
  });
}

/** Encode text before any renderer applies a display length limit. */
export function toAdf(value: string | AdfDocument | undefined): AdfDocument | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return value;
  const content: AdfNode[] = [];
  for (const block of value.replace(/\r\n/g, "\n").split(/\n\n+/)) {
    if (!block) continue;
    const heading = block.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      content.push({ type: "heading", attrs: { level: heading[1].length }, content: inline(heading[2]) });
      continue;
    }
    const lines = block.split("\n");
    if (lines.every((line) => /^[-*]\s+/.test(line))) {
      content.push({ type: "bulletList", content: lines.map((line) => ({ type: "listItem", content: [{ type: "paragraph", content: inline(line.replace(/^[-*]\s+/, "")) }] })) });
      continue;
    }
    content.push({ type: "paragraph", content: lines.flatMap((line, index) => index ? [{ type: "hardBreak" }, ...inline(line)] : inline(line)) });
  }
  return { version: 1, type: "doc", content };
}

export function adfToText(value: unknown): string {
  if (typeof value === "string") return value;
  const document = value as { content?: AdfNode[] } | undefined;
  if (!document?.content) return "";
  const read = (node: AdfNode): string => {
    if (node.type === "text") return node.text ?? "";
    if (node.type === "hardBreak") return "\n";
    const text = (node.content ?? []).map(read).join("");
    if (node.type === "listItem") return `- ${text.trim()}`;
    if (node.type === "bulletList") return (node.content ?? []).map(read).join("\n");
    if (node.type === "orderedList") {
      const order = typeof node.attrs?.order === "number" && Number.isFinite(node.attrs.order) ? node.attrs.order : 1;
      return (node.content ?? []).map((item, index) => `${order + index}. ${read(item).replace(/^- /, "")}`).join("\n");
    }
    return text;
  };
  return document.content.map(read).map((text) => text.trim()).filter(Boolean).join("\n\n");
}
