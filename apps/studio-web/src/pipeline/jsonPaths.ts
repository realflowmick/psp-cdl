// SPDX-License-Identifier: Apache-2.0
/**
 * Offsets of every value in a JSON text, by path, so document mode can underline a problem and
 * highlight the selected component's block. Returns null when the text is not valid JSON.
 */
export type JsonPath = (string | number)[];
export interface Range { start: number; end: number }
export const pathKey = (path: JsonPath): string => JSON.stringify(path);

export function jsonRanges(text: string): Map<string, Range> | null {
  const ranges = new Map<string, Range>();
  let i = 0;
  const ws = () => { while (i < text.length && /\s/.test(text[i]!)) i++; };
  const fail = (): never => { throw new Error("invalid"); };
  const string = (): string => {
    const start = i;
    if (text[i] !== "\"") fail();
    i++;
    while (i < text.length && text[i] !== "\"") i += text[i] === "\\" ? 2 : 1;
    if (text[i] !== "\"") fail();
    i++;
    return JSON.parse(text.slice(start, i)) as string;
  };
  const value = (path: JsonPath): void => {
    ws();
    const start = i, c = text[i];
    if (c === "{") {
      i++; ws();
      if (text[i] === "}") i++;
      else for (;;) {
        ws(); const key = string(); ws();
        if (text[i++] !== ":") fail();
        value([...path, key]); ws();
        if (text[i] === ",") { i++; continue; }
        if (text[i++] !== "}") fail();
        break;
      }
    } else if (c === "[") {
      i++; ws();
      if (text[i] === "]") i++;
      else for (let n = 0; ; n++) {
        value([...path, n]); ws();
        if (text[i] === ",") { i++; continue; }
        if (text[i++] !== "]") fail();
        break;
      }
    } else if (c === "\"") string();
    else {
      const m = /^(-?\d+(\.\d+)?([eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i));
      if (!m) fail();
      i += m![0].length;
    }
    ranges.set(pathKey(path), { start, end: i });
  };
  try { value([]); ws(); if (i !== text.length) fail(); return ranges; } catch { return null; }
}

/** The nearest range that exists for a path, walking up to its parents. */
export function rangeFor(ranges: Map<string, Range>, path: JsonPath): Range | null {
  for (let n = path.length; n >= 0; n--) { const r = ranges.get(pathKey(path.slice(0, n))); if (r) return r; }
  return null;
}
/** 1-based line and column of an offset. */
export function lineColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset).split("\n");
  return { line: before.length, column: before.at(-1)!.length + 1 };
}
