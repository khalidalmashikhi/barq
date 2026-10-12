"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  applySuggestion,
  decodeTabMemory,
  emptyTabMemory,
  encodeTabMemory,
  fieldStatus,
  hasUnsavedChanges,
  hasUnsavedPrivateChanges,
  initialFieldValue,
  rememberField,
  restoreTabMemory,
  reviewFieldsSignature,
  suggestionText,
  syncUntouchedValues,
  TAB_MEMORY_EXTRA_KEYS,
  type ReviewFieldStateInput,
  type ReviewFieldStatus,
  type ReviewTabBinding,
  type ReviewTabMemory,
  type TabMemoryFlow,
} from "@/lib/vehicles/registration-review/review-field-state";

// Phase 3C (detail/onboarding parity, 2026-10-12) — the ONE client-side state machine behind both
// registration forms (onboarding review + vehicle-detail confirmation). The RULES live in the pure,
// tested `review-field-state.ts`; this hook only wires them to React state and the tab's session
// storage, so the two forms can no longer drift apart.
//
//   • values start from `initialFieldValue` (saved claim → direct document value; a derived make /
//     model suggestion is NOT pre-filled);
//   • typing marks a field touched (it is the provider's from then on);
//   • "Use <suggestion>" fills ONE blank field locally — no save, no server action, no request;
//   • when the server data changes (in-place refresh, re-read, save), untouched fields follow it;
//   • TAB MEMORY (2026-10-12 correction): a language switch remounts the form. Unsaved values of the
//     NON-SENSITIVE fields (make, model, year, colour, bookable capacity) and the onboarding choices
//     (type, public description, 4x4 claim) are kept in THIS tab's sessionStorage, bound to the
//     signed-in provider + this document reading + this form, with each field's origin (typed vs
//     applied) — restored after the remount with the same provenance. Private registration values are
//     never written there: `privateDirty` tells the form to stop a language switch instead;
//   • `discard()` drops unsaved changes; `settle()` clears the saved fields' memory after a successful
//     save; `forgetStored()` clears everything (finished / cancelled flow). Browser storage is never
//     authoritative — the server validates every save. Nothing here makes a request.

/** One record per vehicle in THIS tab — sessionStorage only (no persistent browser storage, no cookie, no URL). */
export const TAB_MEMORY_STORAGE_PREFIX = "barq:vehicle-review:tab:";
/** Formats written before the bound record (unbound): removed on sight, never read. */
const LEGACY_STORAGE_PREFIXES = ["barq:vehicle-onboarding:applied:", "barq:vehicle-onboarding:type:"] as const;

export type ReviewFieldState<F extends ReviewFieldStateInput> = {
  values: Record<string, string>;
  status: (f: F) => ReviewFieldStatus;
  typeInto: (key: string, value: string) => void;
  applyFieldSuggestion: (f: F) => void;
  /** Unsaved changes exist (a value differs from what the form started with). */
  dirty: boolean;
  /** Unsaved changes in PRIVATE fields — these are never kept in tab memory. */
  privateDirty: boolean;
  /** Remembered non-field choices (onboarding: vehicleType / publicDescription / claimedFourByFour). */
  extras: Record<string, string>;
  setExtra: (key: string, value: string) => void;
  /** Drop every unsaved change: back to the server's values; temporary tab state cleared. */
  discard: () => void;
  /** After a SUCCESSFUL save: the saved values become the starting point; their tab memory cleared. */
  settle: () => void;
  /** Forget ALL temporary tab state (finished / cancelled flow). */
  forgetStored: () => void;
};

export function useReviewFieldState<F extends ReviewFieldStateInput>({
  vehicleId,
  fields,
  binding,
  flow,
  enabled = true,
}: {
  vehicleId: string;
  fields: readonly F[];
  /** Opaque server binding (provider identity + document reading); null = nothing is remembered. */
  binding: ReviewTabBinding | null;
  flow: TabMemoryFlow;
  /** false for a locked (submitted) claim: nothing is restored or remembered, old memory is cleared. */
  enabled?: boolean;
}): ReviewFieldState<F> {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, initialFieldValue(f)])));
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [applied, setApplied] = useState<Record<string, boolean>>({});
  const [extras, setExtras] = useState<Record<string, string>>({});
  const touchedRef = useRef(touched);
  touchedRef.current = touched;
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  const memoryRef = useRef<ReviewTabMemory>(emptyTabMemory());
  const storageKey = TAB_MEMORY_STORAGE_PREFIX + vehicleId;
  const identity = binding?.identity ?? null;
  const source = binding?.source ?? null;
  const bindingRef = useRef(binding);
  bindingRef.current = binding;
  const writable = enabled && identity !== null && source !== null;

  const persist = (memory: ReviewTabMemory) => {
    memoryRef.current = memory;
    if (!writable) return;
    try {
      const encoded = encodeTabMemory(memory, bindingRef.current, flow);
      if (encoded === null) window.sessionStorage.removeItem(storageKey);
      else window.sessionStorage.setItem(storageKey, encoded);
    } catch {
      /* storage unavailable — the values simply live in memory */
    }
  };

  // New server data (in-place refresh after a re-read, a save, a retry): untouched fields follow it.
  const fieldsSignature = useMemo(() => reviewFieldsSignature(fields), [fields]);
  const firstSync = useRef(true);
  useEffect(() => {
    if (firstSync.current) {
      firstSync.current = false;
      return;
    }
    setValues((prev) => syncUntouchedValues(prev, touchedRef.current, fieldsRef.current));
  }, [fieldsSignature]);

  // Restore after a remount (language switch / reload) — only THIS provider's memory for THIS vehicle,
  // THIS document reading and THIS form. A record that does not match is removed, never applied.
  useEffect(() => {
    try {
      for (const prefix of LEGACY_STORAGE_PREFIXES) window.sessionStorage.removeItem(prefix + vehicleId);
      const raw = window.sessionStorage.getItem(storageKey);
      if (!enabled) {
        window.sessionStorage.removeItem(storageKey);
        return;
      }
      const memory = decodeTabMemory(raw, bindingRef.current, flow);
      const { values: restored, applied: restoredApplied } = restoreTabMemory(memory, fieldsRef.current);
      const keys = Object.keys(restored).filter((k) => !touchedRef.current[k]);
      const kept: ReviewTabMemory = { fields: Object.fromEntries(keys.map((k) => [k, memory.fields[k]!])), extras: memory.extras };
      memoryRef.current = kept;
      if (raw !== null && encodeTabMemory(kept, bindingRef.current, flow) === null) window.sessionStorage.removeItem(storageKey);
      if (keys.length > 0) {
        setValues((prev) => ({ ...prev, ...Object.fromEntries(keys.map((k) => [k, restored[k]!])) }));
        setTouched((prev) => ({ ...prev, ...Object.fromEntries(keys.map((k) => [k, true])) }));
        setApplied((prev) => ({ ...prev, ...Object.fromEntries(keys.map((k) => [k, restoredApplied[k] === true])) }));
      }
      if (Object.keys(memory.extras).length > 0) setExtras(memory.extras);
    } catch {
      /* storage unavailable or unreadable — the provider simply continues */
    }
  }, [storageKey, vehicleId, identity, source, flow, enabled]);

  const forgetStored = () => {
    memoryRef.current = emptyTabMemory();
    try {
      window.sessionStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  };

  /** The provider TYPED in a field: it is theirs from now on (never replaced by a suggestion). */
  const typeInto = (key: string, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    setTouched((t) => ({ ...t, [key]: true }));
    setApplied((a) => ({ ...a, [key]: false }));
    const f = fieldsRef.current.find((x) => x.key === key);
    if (f) persist(rememberField(memoryRef.current, f, value, "TYPED"));
  };

  /** "Use <suggestion>": fills ONLY this field in local state — no save, no server call, no type. */
  const applyFieldSuggestion = (f: F) => {
    const suggestion = suggestionText(f);
    if (suggestion === null) return;
    setValues((v) => applySuggestion(v, f));
    setTouched((t) => ({ ...t, [f.key]: true }));
    setApplied((a) => ({ ...a, [f.key]: true }));
    persist(rememberField(memoryRef.current, f, suggestion, "APPLIED"));
  };

  const setExtra = (key: string, value: string) => {
    if (!TAB_MEMORY_EXTRA_KEYS.includes(key)) return;
    setExtras((x) => ({ ...x, [key]: value }));
    persist({ ...memoryRef.current, extras: { ...memoryRef.current.extras, [key]: value } });
  };

  const discard = () => {
    setValues(Object.fromEntries(fieldsRef.current.map((f) => [f.key, initialFieldValue(f)])));
    setTouched({});
    setApplied({});
    forgetStored();
  };

  const settle = () => {
    // The refresh that follows a save brings the saved values as the new starting point; with nothing
    // touched any more, every field follows it. Choices the save did not include (onboarding type,
    // public description, 4x4 claim) stay remembered until the flow finishes.
    setTouched({});
    setApplied({});
    persist({ fields: {}, extras: memoryRef.current.extras });
  };

  return {
    values,
    status: (f: F) => fieldStatus(f, values[f.key], applied[f.key] === true),
    typeInto,
    applyFieldSuggestion,
    dirty: hasUnsavedChanges(values, fields),
    privateDirty: hasUnsavedPrivateChanges(values, fields),
    extras,
    setExtra,
    discard,
    settle,
    forgetStored,
  };
}
