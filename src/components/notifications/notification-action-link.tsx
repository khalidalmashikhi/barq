"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { resolveNotificationAction } from "@/lib/notifications/resolve-notification-action";

// Gate B3 — the ONE shared, safe CTA renderer, used by both the client bell and
// the server notification pages (a client component embeds fine in a server
// page). It renders NOTHING when the resolver returns null (unknown/legacy event
// or invalid entity), so legacy notifications stay readable with no CTA. The
// href is a locale-agnostic internal path from the allowlist resolver; the
// localized <Link> prefixes the active locale. `onActivate` lets the bell mark
// the row read on click — navigation never depends on it succeeding.

type NotificationActionLinkProps = {
  eventType: string | null;
  entityType: string | null;
  entityId: string | null;
  onActivate?: () => void;
};

export function NotificationActionLink({ eventType, entityType, entityId, onActivate }: NotificationActionLinkProps) {
  const t = useTranslations("notifications");
  const action = resolveNotificationAction({ eventType, entityType, entityId });
  if (!action) return null;

  return (
    <Link
      href={action.href}
      onClick={onActivate}
      className="inline-flex w-fit items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      {t(action.labelKey)}
    </Link>
  );
}
