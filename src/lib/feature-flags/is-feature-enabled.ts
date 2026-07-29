import "server-only";
import { prisma } from "@/lib/db";

// The actual read helper application code calls to gate a feature —
// Phase 1.3 (Core Business Platform). Deliberately NOT requireAdmin()-
// gated: any part of the app (Server Component, Server Action, route
// handler) needs to check a flag's state regardless of who's viewing the
// page, unlike every other Feature Flag module in this directory, which
// is exclusively admin-management surface.
//
// No caching layer here — a flag lookup is one indexed query
// (`@@index([enabled])` isn't even needed for this exact lookup, which is
// a unique-key read; the index serves the admin list's own filtering
// instead). Adding a cache is a legitimate future optimization once a
// real call site exists and performance data justifies it — not invented
// speculatively here, per EC-001 principle 1.

export async function isFeatureEnabled(key: string): Promise<boolean> {
  const flag = await prisma.featureFlag.findUnique({ where: { key }, select: { enabled: true } });
  return flag?.enabled ?? false;
}
