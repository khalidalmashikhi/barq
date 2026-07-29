import "server-only";
import { prisma } from "@/lib/db";

// Shared database connectivity check — Admin Operations Platform.
//
// Extracted from src/app/api/health/route.ts's own inline check (a
// real `SELECT 1` round trip, not just "is the PrismaClient object
// constructed") so the health endpoint and the admin overview
// dashboard's "Database Connectivity" indicator share one
// implementation instead of two copies of the same query. The health
// endpoint's response contract (fields, status codes) is unchanged —
// only where the query itself lives moved.
//
// Returns only "ok" | "error" — never the underlying error message,
// stack trace, or connection string, so this is safe to surface
// directly in an admin-facing UI.

export async function checkDatabaseHealth(): Promise<"ok" | "error"> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return "ok";
  } catch {
    return "error";
  }
}
