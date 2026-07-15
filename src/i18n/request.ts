import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import { routing } from "./routing";
import { namespaces } from "./namespaces";

// next-intl request configuration — BARQ Internationalization, Phase 0.
//
// Loads every namespace's message file for the resolved locale and
// merges them into one object keyed by namespace (e.g.
// messages.common, messages.booking, ...) — this merged shape is what
// the type augmentation (src/types/i18n.d.ts) declares as canonical,
// so a typo'd namespace or key is a compile-time error once real call
// sites start using it in a later phase.
//
// Falls back to routing.defaultLocale (Arabic) for any unresolved or
// invalid locale — the same fallback this project's stored-preference/
// negotiation chain (LOCALIZATION.md §3) already specifies elsewhere;
// no new fallback rule is invented here.

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  const loadedNamespaces = await Promise.all(
    namespaces.map(async (namespace) => {
      const messages = (await import(`../../messages/${locale}/${namespace}.json`)).default;
      return [namespace, messages] as const;
    })
  );

  return {
    locale,
    messages: Object.fromEntries(loadedNamespaces),
  };
});
