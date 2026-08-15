import { updateAvailabilitySlot } from "@/lib/provider/update-availability-slot";
import { deleteAvailabilitySlot } from "@/lib/provider/delete-availability-slot";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1ProviderMutation } from "@/lib/api/v1/provider-mutation-auth";
import { availabilityErrorResponse } from "@/lib/api/v1/provider-mutation-errors";
import { readJsonObject, buildFormData, coerceField } from "@/lib/api/v1/request-body";
import { apiOk } from "@/lib/api/v1/respond";

// PATCH / DELETE /api/v1/me/provider/availability/{id} — Gate PC (Provider Mutation API).
//
// Thin adapters over updateAvailabilitySlot()/deleteAvailabilitySlot(). Both gate on
// requireApprovedProvider() and re-check ownership through the slot's service
// (service.providerId === caller's provider.id → uniform SLOT_NOT_FOUND → 404 for
// missing/not-owned — a provider can never touch another provider's slot by guessing
// an id). The domain enforces the real safeguards: capacity may never drop below the
// slot's booked seats (CAPACITY_BELOW_BOOKED → 409), start/end may only move while the
// slot has zero bookings and deletion is refused once any seat is held
// (SLOT_HAS_BOOKINGS → 409). Neither action returns a resource body, so success is
// { ok: true }. Private/no-store.

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestTracing("api.v1.me.provider.availability.update", () =>
    withApiV1ProviderMutation(request, async ({ locale }) => {
      const { id } = await params;
      const body = await readJsonObject(request);
      const formData = buildFormData({
        capacity: coerceField(body.capacity),
        startTime: coerceField(body.startTime),
        endTime: coerceField(body.endTime),
      });

      const result = await updateAvailabilitySlot(id, formData);
      if (!result.ok) return availabilityErrorResponse(result.error, locale);

      return apiOk({ ok: true });
    })
  );
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestTracing("api.v1.me.provider.availability.delete", () =>
    withApiV1ProviderMutation(request, async ({ locale }) => {
      const { id } = await params;
      const result = await deleteAvailabilitySlot(id);
      if (!result.ok) return availabilityErrorResponse(result.error, locale);

      return apiOk({ ok: true });
    })
  );
}
