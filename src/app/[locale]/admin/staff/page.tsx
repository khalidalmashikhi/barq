import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { redirect } from "@/i18n/navigation";
import { UserCog, ShieldAlert } from "lucide-react";
import { ForbiddenError, UnauthenticatedError, STAFF_PRESET_NAMES, PERMISSION_MODULE } from "@/lib/auth";
import type { StaffPresetName } from "@/lib/auth";
import { getStaff } from "@/lib/admin/get-staff";
import { createStaff } from "@/lib/admin/create-staff";
import { setStaffPermissions } from "@/lib/admin/set-staff-permissions";
import { deactivateStaff } from "@/lib/admin/deactivate-staff";
import { reactivateStaff } from "@/lib/admin/reactivate-staff";
import { prisma } from "@/lib/db";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { getServerTranslator } from "@/lib/i18n/get-server-translator";
import { getLocale } from "next-intl/server";

// STAFF RBAC (Gate Z-3) — the OWNER-only staff-management surface. Every read and every
// action is OWNER-gated server-side (getStaff / createStaff / setStaffPermissions /
// deactivateStaff / reactivateStaff all requireOwner); this page is not authorization,
// it is the UI over those. Authorization administration only — not HR software.

export const metadata: Metadata = { robots: { index: false, follow: false } };

// A legacy StaffRole is required by createStaff (cosmetic/history only now); derive a
// plausible one from the chosen preset. Permissions are the real authority, set below.
const PRESET_LEGACY_ROLE: Record<StaffPresetName, "OPERATIONS" | "SUPPORT" | "FINANCE"> = {
  BOOKING_OPS: "OPERATIONS",
  PROVIDER_VERIFICATION: "OPERATIONS",
  CONTENT_MANAGER: "OPERATIONS",
  FINANCE: "FINANCE",
  SUPPORT: "SUPPORT",
  REVIEW_MODERATOR: "SUPPORT",
};

type Props = { searchParams: Promise<{ error?: string; notice?: string }> };

export default async function AdminStaffPage({ searchParams }: Props) {
  const locale = await getLocale();
  const t = await getServerTranslator("admin");
  const { error, notice } = await searchParams;

  let staffResult;
  try {
    staffResult = await getStaff({ pageSize: 100 });
  } catch (err) {
    if (err instanceof UnauthenticatedError) {
      redirect({ href: "/login", locale });
      return null;
    }
    if (err instanceof ForbiddenError) {
      notFound(); // a non-owner (incl. a non-owner admin) has no staff-management surface
      return null;
    }
    throw err;
  }

  // Dynamic label keys (module_* / preset_*) exist in admin.json for every value, but
  // next-intl's typed t() rejects template-literal keys — cast to its key type.
  type AdminKey = Parameters<typeof t>[0];
  const moduleLabel = (permKey: string): string => t(`module_${PERMISSION_MODULE[permKey as keyof typeof PERMISSION_MODULE]}` as AdminKey);
  const presetLabel = (name: StaffPresetName): string => t(`preset_${name}` as AdminKey);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-8 py-8">
      <div className="flex items-center gap-2">
        <UserCog size={22} strokeWidth={1.75} className="text-primary" />
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t("staffMgmtTitle")}</h1>
          <p className="mt-0.5 text-sm text-foreground/50">{t("staffMgmtSubtitle")}</p>
        </div>
      </div>

      {error && <Alert variant="danger">{t("staffActionError")}</Alert>}
      {notice && <Alert variant="success">{t("staffActionSuccess")}</Alert>}

      {/* Create / promote — resolves an existing, phone-verified BARQ identity and grants a
          preset. No UUIDs, no second login, no unverified identities (createStaff enforces). */}
      <Card hoverLift={false}>
        <h2 className="text-sm font-semibold text-foreground">{t("staffCreateHeading")}</h2>
        <p className="mt-1 text-xs text-foreground/50">{t("staffCreateHint")}</p>
        <form
          action={async (formData: FormData) => {
            "use server";
            const l = await getLocale();
            const phone = String(formData.get("phone") ?? "").trim();
            const preset = String(formData.get("preset") ?? "");
            const presetName = STAFF_PRESET_NAMES.find((p) => p === preset);
            if (!phone || !presetName) {
              redirect({ href: "/admin/staff?error=1", locale: l });
              return;
            }
            const created = await createStaff(phone, [PRESET_LEGACY_ROLE[presetName]]);
            if (!created.ok) {
              redirect({ href: "/admin/staff?error=1", locale: l });
              return;
            }
            // Resolve the just-created/updated Staff row by phone and apply the preset's
            // authoritative permissions (createStaff itself never sets permissions).
            const user = await prisma.user.findUnique({ where: { phoneNumber: phone }, select: { staff: { select: { id: true } } } });
            if (user?.staff) await setStaffPermissions(user.staff.id, { preset: presetName });
            redirect({ href: "/admin/staff?notice=1", locale: l });
          }}
          className="mt-4 flex flex-wrap items-end gap-3"
        >
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-xs font-medium text-foreground/60">{t("staffCreatePhoneLabel")}</span>
            <input
              name="phone"
              type="tel"
              required
              placeholder={t("staffCreatePhonePlaceholder")}
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-foreground/60">{t("staffCreatePresetLabel")}</span>
            <select name="preset" required defaultValue="" className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20">
              <option value="" disabled>{t("staffCreatePresetPlaceholder")}</option>
              {STAFF_PRESET_NAMES.map((p) => (
                <option key={p} value={p}>{presetLabel(p)}</option>
              ))}
            </select>
          </label>
          <SubmitButton className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
            {t("staffCreateButton")}
          </SubmitButton>
        </form>
      </Card>

      <Card hoverLift={false}>
        <h2 className="text-sm font-semibold text-foreground">{t("staffListHeading")}</h2>
        {staffResult.items.length === 0 ? (
          <p className="mt-3 text-sm text-foreground/50">{t("staffListEmpty")}</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {staffResult.items.map((member) => {
              const modules = Array.from(new Set(member.permissions.map((p) => moduleLabel(p))));
              return (
                <li key={member.id} className="flex flex-col gap-3 rounded-xl border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-foreground">{member.name || member.phoneNumber}</span>
                      <span className="text-xs text-foreground/40">{member.phoneNumber}</span>
                    </div>
                    <Badge variant={member.status === "ACTIVE" ? "success" : "default"}>
                      {member.status === "ACTIVE" ? t("staffStatusActiveLabel") : t("staffStatusDeactivatedLabel")}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {modules.length === 0 ? (
                      <span className="inline-flex items-center gap-1 text-xs text-warning">
                        <ShieldAlert size={13} strokeWidth={1.75} />
                        {t("staffNoPermissionsLabel")}
                      </span>
                    ) : (
                      modules.map((m) => <Badge key={m} variant="info">{m}</Badge>)
                    )}
                    {member.permissions.includes("bookings.cancel") && (
                      <Badge variant="warning">{t("staffCancelSensitiveLabel")}</Badge>
                    )}
                  </div>

                  <div className="flex flex-wrap items-end gap-2 border-t border-border/40 pt-3">
                    {/* Apply a preset (OWNER-only setStaffPermissions; sanitized server-side). */}
                    <form
                      action={async (formData: FormData) => {
                        "use server";
                        const l = await getLocale();
                        const preset = String(formData.get("preset") ?? "");
                        const staffId = String(formData.get("staffId") ?? "");
                        const presetName = STAFF_PRESET_NAMES.find((p) => p === preset);
                        if (!presetName) {
                          redirect({ href: "/admin/staff?error=1", locale: l });
                          return;
                        }
                        const r = await setStaffPermissions(staffId, { preset: presetName });
                        redirect({ href: r.ok ? "/admin/staff?notice=1" : "/admin/staff?error=1", locale: l });
                      }}
                      className="flex items-end gap-2"
                    >
                      <input type="hidden" name="staffId" value={member.id} />
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-foreground/50">{t("staffApplyPresetLabel")}</span>
                        <select name="preset" required defaultValue="" className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none">
                          <option value="" disabled>{t("staffCreatePresetPlaceholder")}</option>
                          {STAFF_PRESET_NAMES.map((p) => (
                            <option key={p} value={p}>{presetLabel(p)}</option>
                          ))}
                        </select>
                      </label>
                      <SubmitButton className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-accent/20 disabled:opacity-50">
                        {t("staffApplyPresetButton")}
                      </SubmitButton>
                    </form>

                    {member.status === "ACTIVE" ? (
                      <form
                        action={async (formData: FormData) => {
                          "use server";
                          const l = await getLocale();
                          const r = await deactivateStaff(String(formData.get("staffId") ?? ""));
                          redirect({ href: r.ok ? "/admin/staff?notice=1" : "/admin/staff?error=1", locale: l });
                        }}
                      >
                        <input type="hidden" name="staffId" value={member.id} />
                        <SubmitButton className="rounded-full border border-danger/30 px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/5 disabled:opacity-50">
                          {t("staffDeactivateButton")}
                        </SubmitButton>
                      </form>
                    ) : (
                      <form
                        action={async (formData: FormData) => {
                          "use server";
                          const l = await getLocale();
                          const r = await reactivateStaff(String(formData.get("staffId") ?? ""));
                          redirect({ href: r.ok ? "/admin/staff?notice=1" : "/admin/staff?error=1", locale: l });
                        }}
                      >
                        <input type="hidden" name="staffId" value={member.id} />
                        <SubmitButton className="rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
                          {t("staffActivateButton")}
                        </SubmitButton>
                      </form>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
