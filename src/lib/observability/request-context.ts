import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

// Request correlation IDs — Phase 5.2 (Production Hardening), Priority 1.
// Scoped to true HTTP entry points (Route Handlers), not Server Actions —
// Server Actions already get strong traceability for free from the
// entity ids (bookingId, serviceId, etc.) already threaded through every
// logger call at their catch sites; forcing an artificial request id
// into every Server Action would be unnecessary complexity for little
// extra value. AsyncLocalStorage means a request id set once at a Route
// Handler's entry point is automatically visible to every function it
// calls, without threading a parameter through every signature — see
// logger.ts's write(), which reads getRequestId() to auto-attach it to
// every log line for free.

interface RequestContext {
  requestId: string;
}

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function getRequestId(): string | undefined {
  return requestContextStorage.getStore()?.requestId;
}

export async function runWithRequestId<T>(fn: (requestId: string) => Promise<T>): Promise<T> {
  const requestId = crypto.randomUUID();
  return requestContextStorage.run({ requestId }, () => fn(requestId));
}
