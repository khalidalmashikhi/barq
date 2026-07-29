import "server-only";
import { getRequestId } from "@/lib/observability/request-context";

// Structured server logging — Phase D.3 (Production Hardening).
//
// REPLACES scattered, differently-shaped console.warn/console.error
// calls (previously: a free-form template string per call site, e.g.
// `[auth] forbidden: user ${id} lacks Provider role`) with one
// consistent shape — { timestamp, level, message, ...context } as a
// single JSON line — so any future log aggregator (or a human reading
// raw server output) can parse every log line the same way, regardless
// of which part of the app produced it.
//
// NOT a third-party logging service, and does not become one: this is
// a formatting wrapper around the same console.log/warn/error the app
// already used — whatever already collects stdout/stderr in production
// (the hosting platform's own log viewer, or a future real APM
// integration) keeps working unchanged; this file makes what lands
// there structured instead of ad hoc.
//
// "server-only" — every current call site is already server-side
// (RBAC checks, Server Actions); marked explicitly rather than left to
// convention, matching this codebase's existing discipline for
// server-only utilities.
//
// CONTEXT IS PRIMITIVES ONLY, BY THE TYPE SYSTEM: LogContext's value
// type deliberately excludes objects/arrays, so a caller cannot
// accidentally spread an entire User/Booking/Session record into a log
// line — only the specific, named fields a caller explicitly passes
// (e.g. `{ userId: barqUser.id }`) ever appear. No call site in this
// codebase logs a phone number, OTP code, or session token today; this
// type constraint makes that mistake harder to introduce later, not
// just a convention to remember.

type LogContext = Record<string, string | number | boolean | null | undefined>;

function write(level: "info" | "warn" | "error", message: string, context?: LogContext): void {
  // Phase 5.2 (Production Hardening) — auto-attaches the active Route
  // Handler's correlation id (see src/lib/observability/request-context.ts)
  // to every log line, with zero changes needed at any of this file's
  // existing call sites. Absent outside a traced Route Handler (e.g. a
  // Server Action), in which case this is simply omitted.
  const requestId = getRequestId();

  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(requestId ? { requestId } : {}),
    ...context,
  });

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (message: string, context?: LogContext) => write("info", message, context),
  warn: (message: string, context?: LogContext) => write("warn", message, context),
  error: (message: string, context?: LogContext) => write("error", message, context),
};
