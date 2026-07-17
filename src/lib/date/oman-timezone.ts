// Oman timezone constant — Provider Dashboard timezone consistency fix,
// later centralized behind src/lib/i18n/format-date.ts (Phase A.5
// Group 7).
//
// A single shared value, not a formatting helper: every date/time
// call site's own Intl options (they genuinely differ — date-only
// vs. date+time vs. weekday+time) are kept at the call site, passed
// through formatDate()'s `options` parameter; only the one truly
// duplicated atomic value (the IANA timezone identifier itself) is
// extracted here.
//
// SINGLE REAL CONSUMER: src/lib/i18n/format-date.ts imports this and
// always sets it as `timeZone` internally — no call site anywhere in
// the app passes it directly anymore, since every date/time render now
// goes through that shared wrapper. Kept as its own module rather than
// inlined into format-date.ts because the timezone identifier and the
// locale-formatting logic are conceptually separate concerns.
//
// Passing this explicitly to the `timeZone` option is what actually
// matters — the locale argument alone (e.g. "ar-OM") only affects
// language/numeral conventions, not which timezone a date renders in;
// omitting `timeZone` uses the JavaScript runtime's own local
// timezone, which for a Server Component is the server's, not
// necessarily Oman's.

export const OMAN_TIME_ZONE = "Asia/Muscat";
