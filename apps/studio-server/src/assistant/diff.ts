// SPDX-License-Identifier: Apache-2.0
import { documentToObject, parseMarkup } from "@psp-cdl/core";
import { create } from "jsondiffpatch/with-text-diffs";

type Item = { kind?: unknown; value?: unknown; attributes?: Record<string, unknown> };
/**
 * Sections match by type and id (or name); whitespace matches by value; content text matches other
 * content text so an edited instruction shows as a text diff rather than a removal and an addition.
 */
function hash(item: object): string | undefined {
  const i = item as Item;
  if (i.kind === "text") return typeof i.value === "string" && !i.value.trim() ? `ws:${i.value}` : "text";
  if (i.kind === "section" && i.attributes) {
    const a = i.attributes;
    return `section:${String(a.type ?? "")}:${String(a["node-type"] ?? "")}:${String(a.id ?? a.name ?? "")}`;
  }
  return undefined;
}
const differ = create({ objectHash: hash, arrays: { detectMove: true, includeValueOnMove: false }, textDiff: { minLength: 60 } });

/** The codec's document tree, or the raw text when it does not parse. */
export function pspTree(text: string | null): unknown {
  if (text === null) return null;
  try { return documentToObject(parseMarkup(text), false); } catch { return { kind: "unparsed", text }; }
}
/** jsondiffpatch delta between two versions of an application; null when they are the same. */
export function pspDelta(before: string | null, after: string): unknown {
  return differ.diff(pspTree(before), pspTree(after)) ?? null;
}
