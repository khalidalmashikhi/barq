import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth, withApiAuth, resolveProviderStatus } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { getBookingTimeline } from "@/lib/booking/lifecycle";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";

// Booking History API — Phase E.1 (Booking Lifecycle & Contract
// Foundation), requirement #6. Exposes the same BookingStatusEvent
// data get-booking-timeline.ts already reads, over HTTP, for whoever
// is entitled to see it: the owning Customer, the owning Provider, or
// an Admin.
//
// SECURITY: mirrors getBookingDetail()'s existing uniform-404 pattern
// (src/lib/booking/get-booking-detail.ts) — "booking doesn't exist"
// and "booking exists but you don't own it" return the identical 404,
// never a 403, so this endpoint cannot be used to enumerate booking
// IDs or confirm one belongs to a specific customer/provider. Ownership
// is re-derived from the database against the authenticated session on
// every request — never trusted from the URL alone.
//
// PROVIDER DEACTIVATION FIX: provider identity now resolves through
// resolveProviderStatus() (src/lib/auth/rbac.ts) — the same canonical
// status gate requireProvider() enforces everywhere else — instead of
// a raw, unguarded prisma.provider.findUnique() call. Previously, a
// DEACTIVATED/SUSPENDED provider could still read this endpoint for any
// booking they were the provider on. A caller who genuinely owns the
// booking as its provider but is deactivated now gets an explicit 403 —
// distinct from the uniform 404 above, and safe to distinguish here
// specifically because it only ever fires for someone who already knows
// they were that booking's provider, not a third party probing IDs.

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestTracing("bookings.history", () => withApiAuth(async () => {
    const { id } = await params;

    if (!isValidUuid(id)) {
      return NextResponse.json({ error: "Not Found" }, { status: 404 });
    }

    const { barqUser } = await requireAuth();

    const booking = await prisma.booking.findUnique({
      where: { id },
      select: { id: true, customerId: true, providerId: true },
    });

    if (!booking) {
      return NextResponse.json({ error: "Not Found" }, { status: 404 });
    }

    const [customer, providerLookup, admin] = await Promise.all([
      prisma.customer.findUnique({ where: { userId: barqUser.id }, select: { id: true } }),
      resolveProviderStatus(barqUser.id),
      prisma.admin.findUnique({ where: { userId: barqUser.id }, select: { id: true } }),
    ]);

    const isOwningProvider = providerLookup.kind !== "not_found" && providerLookup.provider.id === booking.providerId;

    if (isOwningProvider && providerLookup.kind === "inactive") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const isEntitled =
      (customer !== null && customer.id === booking.customerId) ||
      (providerLookup.kind === "active" && providerLookup.provider.id === booking.providerId) ||
      admin !== null;

    if (!isEntitled) {
      return NextResponse.json({ error: "Not Found" }, { status: 404 });
    }

    const timeline = await getBookingTimeline(booking.id);

    return NextResponse.json({ bookingId: booking.id, timeline });
  }));
}
