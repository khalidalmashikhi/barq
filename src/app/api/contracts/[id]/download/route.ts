import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth, withApiAuth, resolveProviderStatus } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { getContractPdfForDownload, ContractNotYetGeneratedError } from "@/lib/contracts/execution";
import { BookingContractNotFoundError } from "@/lib/contracts/lifecycle";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";

// Secure Download — Phase E.3, requirement #5. Mirrors
// src/app/api/bookings/[id]/history/route.ts's exact RBAC pattern
// (Phase E.1): the owning Customer, the owning Provider, or an Admin
// only; a nonexistent contract AND one that exists but belongs to
// neither returns the identical 404 — never a 403 — so this endpoint
// cannot be used to enumerate contract IDs or confirm one belongs to a
// specific customer/provider.
//
// PROVIDER DEACTIVATION FIX: provider identity now resolves through
// resolveProviderStatus() (src/lib/auth/rbac.ts) — the same canonical
// status gate requireProvider() enforces everywhere else — instead of a
// raw, unguarded prisma.provider.findUnique() call. Previously, a
// DEACTIVATED/SUSPENDED provider could still download the contract PDF
// for any booking they were the provider on. A caller who genuinely
// owns the contract as its provider but is deactivated now gets an
// explicit 403 — distinct from the uniform 404 above, and safe to
// distinguish here specifically because it only ever fires for someone
// who already knows they were that booking's provider, not a third
// party probing IDs.

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestTracing("contracts.download", () => withApiAuth(async () => {
    const { id } = await params;

    if (!isValidUuid(id)) {
      return NextResponse.json({ error: "Not Found" }, { status: 404 });
    }

    const { barqUser } = await requireAuth();

    const contract = await prisma.bookingContract.findUnique({
      where: { id },
      select: { id: true, contractNumber: true, booking: { select: { customerId: true, providerId: true } } },
    });

    if (!contract) {
      return NextResponse.json({ error: "Not Found" }, { status: 404 });
    }

    const [customer, providerLookup, admin] = await Promise.all([
      prisma.customer.findUnique({ where: { userId: barqUser.id }, select: { id: true } }),
      resolveProviderStatus(barqUser.id),
      prisma.admin.findUnique({ where: { userId: barqUser.id }, select: { id: true } }),
    ]);

    const isOwningProvider =
      providerLookup.kind !== "not_found" && providerLookup.provider.id === contract.booking.providerId;

    if (isOwningProvider && providerLookup.kind === "inactive") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const isEntitled =
      (customer !== null && customer.id === contract.booking.customerId) ||
      (providerLookup.kind === "active" && providerLookup.provider.id === contract.booking.providerId) ||
      admin !== null;

    if (!isEntitled) {
      return NextResponse.json({ error: "Not Found" }, { status: 404 });
    }

    const actorType = admin ? "ADMIN" : providerLookup.kind === "active" ? "PROVIDER" : "CUSTOMER";
    const actorId = admin?.id ?? (providerLookup.kind === "active" ? providerLookup.provider.id : undefined) ?? customer?.id;

    try {
      const { pdf, contractNumber } = await getContractPdfForDownload({ contractId: id, actorType, actorId });

      return new NextResponse(new Uint8Array(pdf), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${contractNumber}.pdf"`,
        },
      });
    } catch (error) {
      if (error instanceof ContractNotYetGeneratedError) {
        return NextResponse.json({ error: "Contract has not been generated yet" }, { status: 409 });
      }
      if (error instanceof BookingContractNotFoundError) {
        return NextResponse.json({ error: "Not Found" }, { status: 404 });
      }
      throw error;
    }
  }));
}
