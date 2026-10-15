// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

const PREFIX = "psp-studio:";
type Store = () => Storage;
const session: Store = () => window.sessionStorage;
const local: Store = () => window.localStorage;

function read<T>(store: Store, key: string, initial: T): T {
  try { const raw = store().getItem(PREFIX + key); return raw === null ? initial : JSON.parse(raw) as T; } catch { return initial; }
}
function usePersisted<T>(store: Store, key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => read(store, key, initial));
  useEffect(() => { try { store().setItem(PREFIX + key, JSON.stringify(value)); } catch { /* storage blocked: state stays in memory */ } }, [store, key, value]);
  return [value, setValue];
}
/** Per-tab UI state such as grid sort and selection, so returning from an editor restores the list. */
export const useSessionState = <T,>(key: string, initial: T) => usePersisted(session, key, initial);
/** Per-browser preferences such as whether the side navigation is open. */
export const useLocalState = <T,>(key: string, initial: T) => usePersisted(local, key, initial);