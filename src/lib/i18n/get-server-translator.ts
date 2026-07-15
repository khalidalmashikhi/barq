import { getTranslations } from "next-intl/server";
import type { Locale, Messages, NamespaceKeys, NestedKeyOf } from "next-intl";

// BARQ-owned server-translation entry point — Internationalization
// Phase 0.5 (Architecture Hardening).
//
// WHY THIS EXISTS: every future migrated Server Component/Server
// Action should import `getServerTranslator` from here, never
// `getTranslations` from `next-intl/server` directly — a single,
// BARQ-owned seam consistent with ADR-0011's "business logic exists
// in exactly one reusable place" principle applied to a third-party
// dependency: if next-intl's server API is ever renamed, restructured,
// or swapped for a different library, exactly one file changes, not
// every call site across the codebase.
//
// DELIBERATELY THIN: this function adds no behavior of its own — no
// caching, no fallback logic, no error handling next-intl doesn't
// already provide. It is a type-preserving pass-through, not a new
// abstraction layer with its own rules. Introducing fallback or
// business logic here would violate this phase's explicit scope and
// would duplicate next-intl's own, already-correct behavior.
//
// TWO OVERLOADS, MIRRORING next-intl's OWN TWO CALL SHAPES EXACTLY —
// not inventing a third, ambiguous shape:
//   - getServerTranslator("common")            -> request-locale flow
//   - getServerTranslator({ locale: "en", namespace: "common" }) -> explicit locale
// A single merged signature (e.g. accepting `(namespace?, locale?)` as
// two positional string parameters) was considered and rejected: both
// `NestedKey` (a namespace) and `Locale` are string-literal unions, so
// two positional string parameters would be structurally
// indistinguishable to TypeScript's overload resolution — a caller
// could pass a namespace where a locale was intended (or vice versa)
// with no compile-time error. Keeping the object-vs-bare-string shape
// next-intl itself already uses avoids inventing that ambiguity.
//
// TYPE SAFETY: `NestedKey` is constrained by the SAME
// `NamespaceKeys<Messages, NestedKeyOf<Messages>>` bound
// `getTranslations` itself uses, imported from `next-intl` (which
// re-exports `use-intl/core` — the actual defining module, not a
// direct project dependency, so importing the type names from
// `next-intl` itself avoids depending on an undeclared transitive
// package). A renamed or non-existent namespace is a compile error at
// the call site, identical to calling `getTranslations` directly — no
// safety is weakened by this wrapper. Verified via `tsc --noEmit`
// against real call sites in this same phase (see the migrated
// validation route).

type MessageNamespace = NamespaceKeys<Messages, NestedKeyOf<Messages>>;

export function getServerTranslator<NestedKey extends MessageNamespace = never>(
  namespace?: NestedKey
): ReturnType<typeof getTranslations<NestedKey>>;
export function getServerTranslator<NestedKey extends MessageNamespace = never>(opts: {
  locale: Locale;
  namespace?: NestedKey;
}): ReturnType<typeof getTranslations<NestedKey>>;
export function getServerTranslator<NestedKey extends MessageNamespace = never>(
  namespaceOrOpts?: NestedKey | { locale: Locale; namespace?: NestedKey }
) {
  if (typeof namespaceOrOpts === "object" && namespaceOrOpts !== null) {
    return getTranslations(namespaceOrOpts);
  }
  return getTranslations(namespaceOrOpts);
}
