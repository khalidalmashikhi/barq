// Locale-switch guard (2026-10-12) — the smallest hook point that lets a page with UNSAVED work that
// cannot survive a remount (e.g. private vehicle-registration values, which are never written to
// browser storage) stop the language switcher from silently discarding it.
//
// One slot, no state store: a mounted form registers ONE interceptor while it has such work and
// unregisters on cleanup. The LanguageSwitcher asks `interceptLocaleSwitch(href)` before following
// its link; `true` means the page took over (it shows its own "save first" prompt) and the link must
// not navigate. With nothing registered every switch behaves exactly as before. Client-only; nothing
// here is persisted, sent or logged.

export type LocaleSwitchInterceptor = (targetHref: string) => boolean;

let active: LocaleSwitchInterceptor | null = null;

/** Register the page's interceptor; returns the unregister function (removes only its own entry). */
export function registerLocaleSwitchInterceptor(interceptor: LocaleSwitchInterceptor): () => void {
  active = interceptor;
  return () => {
    if (active === interceptor) active = null;
  };
}

/** True when a page intercepted the switch to `targetHref` (the caller must then not navigate). */
export function interceptLocaleSwitch(targetHref: string): boolean {
  if (!active) return false;
  try {
    return active(targetHref) === true;
  } catch {
    return false;
  }
}
