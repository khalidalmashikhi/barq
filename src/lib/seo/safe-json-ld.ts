// Safe JSON-LD serialization — Production Blocker fix.
//
// WHY THIS EXISTS: every JSON-LD block in this app is rendered via
// `<script type="application/ld+json" dangerouslySetInnerHTML={{ __html:
// JSON.stringify(data) }} />`. `JSON.stringify` does NOT escape the
// literal character sequence `</script>` — and a browser's HTML parser
// terminates a `<script>` element the instant it sees that sequence in
// the raw byte stream, regardless of JavaScript string/quoting context.
// Two of this app's JSON-LD inputs (Service.name/description,
// Provider.businessName/businessDescription — see structured-data.ts's
// own callers) are free-text fields a Provider sets themselves, with no
// admin content review before a service/profile goes PUBLISHED. A
// provider setting a name containing `</script><script>...</script>`
// would previously have that payload execute in every visitor's
// browser on that page — a genuine stored XSS, not a theoretical one.
//
// FIX: replace every literal `<` with its JSON/Unicode escape `<`
// before it ever reaches the DOM. This is the exact mitigation Next.js's
// own documentation recommends for this precise pattern. `<` is escaped
// unconditionally (not just `</script>`) since any `<` inside a
// `<script>` body is a potential parser-termination point for some
// other tag sequence too, and a blanket escape can never be
// incomplete — JSON.parse() on the client (if anything ever needs to
// re-parse this) still reads `<` back as a literal "<" correctly,
// since \uXXXX is a standard JSON string escape.

export function toSafeJsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
