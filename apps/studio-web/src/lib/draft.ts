// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useState } from "react";
import { stableStringify } from "./format";

/**
 * Editor state for one record: the saved copy, the working draft and whether they differ.
 * The draft initializes once from its source and is never overwritten by later list refreshes.
 */
export function useDraft<T>(source: T | undefined) {
  const [saved, setSaved] = useState<T | undefined>(() => source === undefined ? undefined : structuredClone(source));
  const [draft, setDraft] = useState<T | undefined>(() => source === undefined ? undefined : structuredClone(source));
  useEffect(() => {
    if (source !== undefined && saved === undefined) { setSaved(structuredClone(source)); setDraft(structuredClone(source)); }
  }, [source, saved]);
  const dirty = draft !== undefined && saved !== undefined && stableStringify(draft) !== stableStringify(saved);
  const update = useCallback((change: (current: T) => T) => setDraft(current => current === undefined ? current : change(current)), []);
  const markSaved = useCallback((value: T) => { setSaved(structuredClone(value)); setDraft(structuredClone(value)); }, []);
  const revert = useCallback(() => setDraft(saved === undefined ? undefined : structuredClone(saved)), [saved]);
  return { draft, saved, dirty, setDraft, update, markSaved, revert };
}