import { getProviderAvailability } from "@/lib/provider/queries/get-provider-availability";
import { createAvailabilitySlot } from "@/lib/provider/create-availability-slot";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1Provider } from "@/lib/api/v1/provider-auth";
import { withApiV1ProviderMutation } from "@/lib/api/v1/provider-mutation-auth";
import { availabilityErrorResponse } from "@/lib/api/v1/provider-mutation-errors";
import { readJsonObject, buildFormData, coerceField } from "@/lib/api/v1/request-body";
import { parsePageParams } from "@/lib/api/v1/pagination";
import { apiOk } from "@/lib/api/v1/respond";
import { toProviderAvailabilitySlotDTO } from "@/lib/api/v1/dtos";
import type { AvailabilitySlotState } from "@prisma/client";

// GET /api/v1/me/provider/availability — Gate PB.
//
// Thin adapter over getProviderAvailability(), scoped to the caller's own
// provider (service.providerId), UPCOMING slots only (the reader's fixed scope).
// Optional filters the reader already supports: state, serviceId, q. Shared
// pagination (default 10). Private/no-store.
//
// POST /api/v1/me/provider/availability — Gate PC (Provider Mutation API).
//
// Thin adapter over createAvailabilitySlot(), which gates on requireApprovedProvider(),
// re-checks that the target service is the caller's own (uniform SERVICE_NOT_FOUND →
// 404), and validates the time window + capacity. The domain action returns no slot
// id, so on success this route returns 201 { ok: true } (the client re-reads the
// list); we never fabricate an id the domain didn't hand back. Private/no-store.

export const dynamic = "force-dynamic";

const SLOT_STATES: readonly AvailabilitySlotState[] = ["OPEN", "BLOCKED", "CANCELLED"];

function parseState(raw: string | null): AvailabilitySlotState | undefined {
  return raw && (SLOT_STATES as readonly string[]).includes(raw) ? (raw as AvailabilitySlotState) : undefined;
}

export async function GET(request: Request) {
  return withRequestTracing("api.v1.me.provider.availability.list", () =>
    withApiV1Provider(request, async ({ locale }) => {
      const searchParams = new URL(request.url).searchParams;
      const { page, pageSize } = parsePageParams(searchParams, 10);

      const result = await getProviderAvailability(
        {
          page,
          pageSize,
          q: searchParams.get("q") ?? undefined,
          state: parseState(searchParams.get("state")),
          serviceId: searchParams.get("serviceId") ?? undefined,
        },
        locale
      );

      return apiOk({
        items: result.items.map(toProviderAvailabilitySlotDTO),
        page: result.page,
        pageSize: result.pageSize,
        totalCount: result.totalCount,
        totalPages: result.totalPages,
      });
    })
  );
}

export async function POST(request: Request) {
  return withRequestTracing("api.v1.me.provider.availability.create", () =>
    withApiV1ProviderMutation(request, async ({ locale }) => {
      const body = await readJsonObject(request);
      const formData = buildFormData({
        serviceId: coerceField(body.serviceId),
        startTime: coerceField(body.startTime),
        endTime: coerceField(body.endTime),
        capacity: coerceField(body.capacity),
      });

      const result = await createAvailabilitySlot(formData);
      if (!result.ok) return availabilityErrorResponse(result.error, locale);

      return apiOk({ ok: true }, { status: 201 });
    })
  );
}
