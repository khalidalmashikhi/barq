import "server-only";
import { logger } from "@/lib/logger";
import { runWithRequestId } from "./request-context";

// Route Handler tracing wrapper — Phase 5.2 (Production Hardening),
// Priority 1. Doubles as the "performance monitoring hook" requirement:
// every wrapped request logs exactly one line on completion (success or
// failure) with its duration — not per-step chatter, so this stays
// quiet rather than noisy. The correlation id is echoed back as a
// response header, mirroring the existing error.digest pattern already
// used by the error boundaries (src/app/[locale]/error.tsx,
// src/app/global-error.tsx) for the same "reference this later" purpose.

export function withRequestTracing(
  routeName: string,
  handler: () => Promise<Response>
): Promise<Response> {
  return runWithRequestId(async (requestId) => {
    const start = performance.now();

    try {
      const response = await handler();
      const durationMs = Math.round(performance.now() - start);

      logger.info(`${routeName}.request_completed`, { requestId, durationMs, status: response.status });
      response.headers.set("x-request-id", requestId);

      return response;
    } catch (error) {
      const durationMs = Math.round(performance.now() - start);

      logger.error(`${routeName}.request_failed`, {
        requestId,
        durationMs,
        message: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  });
}
