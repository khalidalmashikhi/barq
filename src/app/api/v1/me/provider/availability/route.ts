import { getProviderAvailability } from "@/lib/provider/queries/get-provider-availability";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1Provider } from "@/lib/api/v1/provider-auth";
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
