import "server-only";
import { envSchema } from "../../../scripts/env-schema";

// Environment completeness health check — Production Hardening. Reuses
// scripts/env-schema.ts's own Zod schema (the same one
// scripts/validate-env.ts already gates `npm run dev`/`npm run build`
// on) as the single source of truth for "is this environment
// complete" — no second, drifting definition of what's required.
//
// Returns only "ok"/"incomplete" — deliberately NOT the list of which
// variable(s) failed. Unlike a credential value, a missing-variable
// NAME is not itself a secret, but on a public, unauthenticated
// endpoint it would still hand an attacker a map of which integrations
// (e.g. "STRIPE_WEBHOOK_SECRET missing") aren't live yet — more detail
// than "Health output must remain production-safe" calls for. An
// operator investigating a real "incomplete" result already has direct
// environment access and can run `npm run validate-env` themselves for
// the itemized list.

export type EnvironmentHealth = "ok" | "incomplete";

export function checkEnvironmentHealth(): EnvironmentHealth {
  return envSchema.safeParse(process.env).success ? "ok" : "incomplete";
}
