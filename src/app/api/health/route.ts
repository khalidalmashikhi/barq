import { NextResponse } from "next/server";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { checkDatabaseHealth } from "@/lib/observability/check-database-health";
import { checkOtpProviderHealth } from "@/lib/observability/check-otp-provider-health";
import { checkPaymentProviderHealth } from "@/lib/observability/check-payment-provider-health";
import { checkEnvironmentHealth } from "@/lib/observability/check-environment-health";
import packageJson from "../../../../package.json";

// Health endpoint — Phase D.3 (Production Hardening).
//
// PUBLIC, UNAUTHENTICATED, BY DESIGN: a load balancer / uptime monitor
// hits this before any user session exists — matches how health checks
// work everywhere, not a gap in this app's auth coverage. Returns only
// status strings, a build version, and a timestamp — never a
// connection string, secret, or raw database error message/stack (a
// failed DB check returns the literal string "error", nothing else).
//
// DATABASE CONNECTIVITY: a real query (`SELECT 1`), not just "is the
// PrismaClient object constructed" — the singleton in src/lib/db.ts is
// always constructed successfully regardless of whether the database
// is actually reachable, so only a real round trip proves connectivity.
// Admin Operations Platform: this check now lives in the shared
// checkDatabaseHealth() helper (src/lib/observability/), reused by the
// admin overview dashboard's "Database Connectivity" indicator — this
// endpoint's own response shape/status codes are unchanged.
//
// STATUS CODES: 200 when every check below passes, 503 (Service
// Unavailable — the standard HTTP code for "temporarily can't serve
// requests") when any one of them fails. A monitoring tool watching for
// non-2xx responses works correctly without needing to parse the JSON
// body.
//
// BUILD VERSION: read from package.json's own "version" field at
// request time — no separate build-time env var invented, since this
// project already has exactly one authoritative version number and
// duplicating it into a new NEXT_PUBLIC_* variable would be a second
// source of truth for the same value.
//
// Production Hardening — extended beyond the original database-only
// check with three more lightweight, secret-free readiness signals:
// which OTP/payment provider actually resolved (never a credential —
// see each checker's own module comment for why), and whether the
// environment as a whole parses against scripts/env-schema.ts. Every
// added field is a plain enum-shaped string, never raw configuration —
// the same "never leak the underlying detail" discipline the original
// database check already established.

export async function GET() {
  return withRequestTracing("health", async () => {
    const timestamp = new Date().toISOString();
    const database = await checkDatabaseHealth();
    const otpProvider = checkOtpProviderHealth();
    const paymentProvider = checkPaymentProviderHealth();
    const environment = checkEnvironmentHealth();

    const healthy =
      database === "ok" &&
      otpProvider !== "misconfigured" &&
      paymentProvider !== "misconfigured" &&
      environment === "ok";

    const status = healthy ? "ok" : "degraded";

    return NextResponse.json(
      {
        status,
        database,
        otpProvider,
        paymentProvider,
        environment,
        version: packageJson.version,
        timestamp,
      },
      { status: healthy ? 200 : 503 }
    );
  });
}
