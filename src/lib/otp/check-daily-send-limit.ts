import "server-only";
import { prisma } from "@/lib/db";

// Daily OTP send-limit enforcement — Phase 5.1 (Production Readiness).
//
// The 30s resend cooldown (check-resend-cooldown.ts) prevents rapid-
// fire resends but does nothing to cap total volume — a phone number
// could still be sent ~2,880 codes/day within that cooldown alone. This
// is the real SMS-cost abuse vector once OTP_PROVIDER=twilio is live
// (Twilio bills per message sent), and the audit that scoped this
// phase flagged it as a launch blocker. Reuses the same Verification
// table and its existing @@index([identifier]) — no new table.
//
// A rolling 24h window (not a calendar-day boundary) — simpler, avoids
// a timezone decision for what is purely an abuse cap, not a
// user-facing "resets at midnight" quota.

const WINDOW_MS = 24 * 60 * 60 * 1000;

export interface DailySendLimitResult {
  allowed: boolean;
  sentInWindow: number;
}

export async function checkDailySendLimit(phoneNumber: string, maxPerDay: number): Promise<DailySendLimitResult> {
  const windowStart = new Date(Date.now() - WINDOW_MS);

  const sentInWindow = await prisma.verification.count({
    where: { identifier: phoneNumber, createdAt: { gte: windowStart } },
  });

  return { allowed: sentInWindow < maxPerDay, sentInWindow };
}
