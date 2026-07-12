// Oman timezone constant — Provider Dashboard timezone consistency fix.
//
// A single shared value, not a formatting helper: each call site keeps
// its own `toLocaleDateString`/`toLocaleString` options (they
// genuinely differ — date-only vs. date+time vs. weekday+time), so
// only the one truly duplicated atomic value (the IANA timezone
// identifier itself) is extracted here, per explicit instruction to
// reuse a shared piece only where the duplication is real and the
// abstraction is clearly justified. Five real consumers exist as of
// this fix (Provider Overview via ProviderRecentActivity, Services
// list, Service Detail, Bookings list, Availability list) — past the
// same "extract at 3+ real consumers" threshold already applied to
// getOmanTodayRangeUtc().
//
// Passing this explicitly to the `timeZone` option is what actually
// matters — the "ar-OM"/"en-OM" locale argument alone only affects
// language/numeral conventions, not which timezone a date renders in;
// omitting `timeZone` uses the JavaScript runtime's own local
// timezone, which for a Server Component is the server's, not
// necessarily Oman's.

export const OMAN_TIME_ZONE = "Asia/Muscat";
