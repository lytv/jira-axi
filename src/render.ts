import { encode } from "@toon-format/toon";
import { adfToText } from "./adf.js";

export function truncateText(value: unknown, full = false, limit = 800): string {
  const text = adfToText(value);
  if (full || text.length <= limit) return text;
  return `${text.slice(0, limit)}... [${text.length} chars; use --full]`;
}

export function aggregateCount(count: number, total?: number): string {
  return total === undefined ? `count: ${count}` : `count: ${count} of ${total} total (approximate)`;
}

export function render(data: Record<string, unknown>, json = false): string {
  return json ? JSON.stringify(data, null, 2) : encode(data);
}
