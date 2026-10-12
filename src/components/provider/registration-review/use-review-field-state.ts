"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  applySuggestion,
  decodeAppliedSuggestions,
  encodeAppliedSuggestions,
  fieldStatus,
  hasUnsavedChanges,
  initialFieldValue,
  restorableAppliedSuggestions,
  reviewFieldsSignature,
  suggestionText,
  syncUntouchedValues,
  type ReviewFieldStateInput,
  type ReviewFieldStatus,
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
//   • applied make/model suggestions are remembered per vehicle in the tab and restored (language
//     switch / reload) only for the SAME source reading;
//   • `discard()` drops unsaved changes; `settle()` clears the temporary state after a successful
//     save. Browser storage is never authoritative — the server validates every save.

/** Same per-vehicle key as before (applied make/model suggestions for this vehicle in this tab). */
export const APPLIED_STORAGE_PREFIX = "barq:vehicle-onboarding:applied:";

export type ReviewFieldState<F extends ReviewFieldStateInput> = {
  values: Record<string, string>;
  status: (f: F) => ReviewFieldStatus;
  typeInto: (key: string, value: string) => void;
  applyFieldSuggestion: (f: F) => void;
  /** Unsaved changes exist (a value differs from what the form started with). */
  dirty: boolean;
  /** Drop every unsaved change: back to the server's values; temporary tab state cleared. */
  discard: () => void;
  /** After a SUCCESSFUL save: the saved values become the starting point; temporary state cleared. */
  settle: () => void;
  /** Forget the temporary tab state (create / cancel / discard). */
  forgetStored: () => void;
};

export function useReviewFieldState<F extends ReviewFieldStateInput>({ vehicleId, fields, sourceToken }: { vehicleId: string; fields: readonly F[]; sourceToken: string | null }): ReviewFieldState<F> {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, initialFieldValue(f)])));
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [applied, setApplied] = useState<Record<string, boolean>>({});
  const touchedRef = useRef(touched);
  touchedRef.current = touched;
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  const storageKey = APPLIED_STORAGE_PREFIX + vehicleId;

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

  // Restore suggestions APPLIED earlier in this tab for THIS vehicle and THIS source reading only.
  useEffect(() => {
    try {
      const restored = restorableAppliedSuggestions(decodeAppliedSuggestions(window.sessionStorage.getItem(storageKey), sourceToken), fieldsRef.current);
      const keys = Object.keys(restored);
      if (keys.length === 0) return;
      setValues((prev) => {
        const next = { ...prev };
        for (const k of keys) if ((prev[k] ?? "").trim() === "" && !touchedRef.current[k]) next[k] = restored[k]!;
        return next;
      });
      setTouched((prev) => ({ ...prev, ...Object.fromEntries(keys.map((k) => [k, true])) }));
      setApplied((prev) => ({ ...prev, ...Object.fromEntries(keys.map((k) => [k, true])) }));
    } catch {
      /* storage unavailable or unreadable — the provider simply applies again */
    }
  }, [storageKey, sourceToken]);

  const remember = (key: string, value: string | null) => {
    try {
      const current = decodeAppliedSuggestions(window.sessionStorage.getItem(storageKey), sourceToken);
      if (value === null) delete current[key];
      else current[key] = value;
      const encoded = encodeAppliedSuggestions(current, sourceToken);
      if (encoded === null) window.sessionStorage.removeItem(storageKey);
      else window.sessionStorage.setItem(storageKey, encoded);
    } catch {
      /* ignore */
    }
  };

  const forgetStored = () => {
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
    remember(key, null);
  };

  /** "Use <suggestion>": fills ONLY this field in local state — no save, no server call, no type. */
  const applyFieldSuggestion = (f: F) => {
    const suggestion = suggestionText(f);
    if (suggestion === null) return;
    setValues((v) => applySuggestion(v, f));
    setTouched((t) => ({ ...t, [f.key]: true }));
    setApplied((a) => ({ ...a, [f.key]: true }));
    remember(f.key, suggestion);
  };

  const discard = () => {
    setValues(Object.fromEntries(fieldsRef.current.map((f) => [f.key, initialFieldValue(f)])));
    setTouched({});
    setApplied({});
    forgetStored();
  };

  const settle = () => {
    // The refresh that follows a save brings the saved values as the new starting point; with nothing
    // touched any more, every field follows it.
    setTouched({});
    setApplied({});
    forgetStored();
  };

  return {
    values,
    status: (f: F) => fieldStatus(f, values[f.key], applied[f.key] === true),
    typeInto,
    applyFieldSuggestion,
    dirty: hasUnsavedChanges(values, fields),
    discard,
    settle,
    forgetStored,
  };
}
