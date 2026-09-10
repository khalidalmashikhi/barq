import { NextResponse } from "next/server";
import { UnauthenticatedError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { reviewProviderDocument, type ReviewDecision } from "@/lib/provider/documents/review-provider-document";
import { omanValidThroughDateToExpiryInstant } from "@/lib/date/oman-time";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";

// Admin document REVIEW — Gate 2 domain, Gate 3 progressive-form transport.
// Delegates to reviewProviderDocument() (self-authorizes via requireAdmin; RC3
// version-token stale protection bound to the exact reviewed object; mandatory
// trimmed reason on reject). Admin identity comes only from the auth context.
// `providerId` is a form field used ONLY to build the redirect target back to
// the admin provider detail page — it is never used for authorization.

const LOCALES = ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"] as const;
const DEFAULT_LOCALE = "ar";
function resolveLocale(v: FormDataEntryValue | null): string {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v) ? v : DEFAULT_LOCALE;
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withRequestTracing("admin.provider_documents.review", async () => {
    const { id } = await ctx.params;
    const formData = await request.formData();
    const locale = resolveLocale(formData.get("locale"));
    const providerIdRaw = formData.get("providerId");
    const providerId = typeof providerIdRaw === "string" && isValidUuid(providerIdRaw) ? providerIdRaw : null;
    const dest = (q: string) =>
      new URL(providerId ? `/${locale}/admin/providers/${providerId}${q}` : `/${locale}/admin/providers`, request.url);
    try {
      const decision = formData.get("decision");
      const versionToken = formData.get("versionToken");
      const reason = formData.get("reason");
      if ((decision !== "APPROVE" && decision !== "REJECT") || typeof versionToken !== "string") {
        return NextResponse.redirect(dest("?docError=INVALID_INPUT"), 303);
      }

      // Compliance expiry (APPROVE only): an optional "valid through" Oman calendar date, converted to
      // the trusted expiry INSTANT (end-of-day Asia/Muscat) exactly like the vehicle LC6 flow. A
      // present-but-malformed date is rejected; an empty field leaves expiry unset.
      let expiresAt: Date | null = null;
      if (decision === "APPROVE") {
        const raw = formData.get("expiresAt");
        if (typeof raw === "string" && raw.trim() !== "") {
          const instant = omanValidThroughDateToExpiryInstant(raw);
          if (!instant) return NextResponse.redirect(dest("?docError=INVALID_INPUT"), 303);
          expiresAt = instant;
        }
      }

      const result = await reviewProviderDocument({
        documentId: id,
        expectedVersionToken: versionToken,
        decision: decision as ReviewDecision,
        reason: typeof reason === "string" ? reason : undefined,
        expiresAt,
      });
      return NextResponse.redirect(dest(result.ok ? "?docNotice=reviewed" : `?docError=${result.error}`), 303);
    } catch (error) {
      if (error instanceof UnauthenticatedError) {
        return NextResponse.redirect(new URL(`/${locale}/login`, request.url), 303);
      }
      throw error;
    }
  });
}
