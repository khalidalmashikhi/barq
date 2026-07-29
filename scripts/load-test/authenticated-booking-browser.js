import { browser } from "k6/browser";
import { check } from "k6";
import { SharedArray } from "k6/data";

// BARQ — Scenario B2: Booking Creation (write path), via k6's browser
// module. Targets the isolated STAGING environment only.
//
// *** EXPENSIVE / WRITES REAL DATA — DO NOT RUN WITHOUT EXPLICIT OWNER
// APPROVAL, PER docs/11-release/LOAD_TEST_PLAN.md §5 (B2). ***
//
// WHY BROWSER MODULE, NOT PLAIN HTTP: createBooking (src/lib/booking/
// create-booking.ts) is a Next.js Server Action, not a REST endpoint —
// see LOAD_TEST_PLAN.md §1 for why a raw k6 HTTP script would have to
// reverse-engineer Next.js's internal action-invocation wire protocol.
// Driving the real rendered form instead stays correct regardless of
// that internal protocol.
//
// SESSION POOL: same fixed, 10-account pool as authenticated-dashboard.js
// (LOAD_TEST_PLAN.md §2) — this script sets a session cookie via the
// browser context, it never logs in and never triggers an OTP send.
//
// RECOMMENDED SCALE (per LOAD_TEST_PLAN.md §5): 5, then 20, then 50
// concurrent browser sessions — NOT the full 25/100/300/500 ramp used
// by the read-only scenarios. Browser-module VUs are heavy (a real
// headless Chromium instance each) and every successful iteration is a
// real Booking/Availability write against the staging database.

const BASE_URL = __ENV.STAGING_URL || "https://staging.example.invalid";
const LOCALE = __ENV.LOCALE || "en";
const APPROVED_VUS = Number(__ENV.APPROVED_VUS || 5);

const sessionPool = new SharedArray("sessions", function () {
  return JSON.parse(open("./.session-pool.json"));
});

// Populate with a real staging service ID that has open availability —
// no live ID is fabricated here (LOAD_TEST_PLAN.md §2).
const BOOKABLE_SERVICE_ID = __ENV.BOOKABLE_SERVICE_ID;

export const options = {
  scenarios: {
    booking_creation: {
      executor: "shared-iterations",
      vus: APPROVED_VUS,
      iterations: APPROVED_VUS * 3,
      maxDuration: "10m",
      options: {
        browser: {
          type: "chromium",
        },
      },
    },
  },
  thresholds: {
    browser_http_req_duration: ["p(95)<4000"],
    checks: ["rate>0.95"],
  },
};

export default async function () {
  if (!BOOKABLE_SERVICE_ID) {
    throw new Error(
      "BOOKABLE_SERVICE_ID env var is required — point it at a real staging service with open availability before running this scenario."
    );
  }

  const session = sessionPool[__VU % sessionPool.length];
  const context = browser.newContext();
  await context.addCookies([
    {
      name: session.cookieName,
      value: session.cookieValue,
      url: BASE_URL,
    },
  ]);

  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}/${LOCALE}/services/${BOOKABLE_SERVICE_ID}/book`);

    const heading = page.locator("h1");
    check(heading, { "booking page loaded": (h) => h !== null });

    // Selectors below are illustrative — confirm the real form's
    // field names/test-ids against the actual rendered
    // /services/[id]/book page in staging before running, since this
    // script has never been executed against a live instance.
    const submitButton = page.locator('button[type="submit"]');
    await submitButton.click();

    await page.waitForSelector('[data-testid="booking-confirmation"]', { timeout: 5000 });
    check(page, {
      "booking confirmed": (p) => p.url().includes("/confirmation"),
    });
  } finally {
    await page.close();
  }
}
