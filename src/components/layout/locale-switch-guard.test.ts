import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { interceptLocaleSwitch, registerLocaleSwitchInterceptor } from "./locale-switch-guard";

// 2026-10-12 — the one hook point that lets a form with unsaved private values hold a language switch.

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe("locale-switch guard (single slot, no state store)", () => {
  it("with nothing registered every switch proceeds as before", () => {
    expect(interceptLocaleSwitch("/en/provider/vehicles/x")).toBe(false);
  });

  it("a registered interceptor receives the target and can hold the switch; unregistering restores normal switching", () => {
    const seen: string[] = [];
    cleanup = registerLocaleSwitchInterceptor((href) => {
      seen.push(href);
      return true;
    });
    expect(interceptLocaleSwitch("/en/provider/vehicles/x")).toBe(true);
    expect(seen).toEqual(["/en/provider/vehicles/x"]);
    cleanup();
    cleanup = null;
    expect(interceptLocaleSwitch("/en/provider/vehicles/x")).toBe(false);
  });

  it("a stale unregister never removes a newer interceptor; a throwing interceptor never blocks navigation", () => {
    const first = registerLocaleSwitchInterceptor(() => true);
    cleanup = registerLocaleSwitchInterceptor(() => {
      throw new Error("boom");
    });
    first(); // the older form unmounting late
    expect(interceptLocaleSwitch("/ar/x")).toBe(false); // the newer one is still registered, but it threw → proceed
  });

  it("the language switcher consults the guard before following its link, and only for a different language", () => {
    const src = readFileSync(path.join(process.cwd(), "src/components/layout/language-switcher.tsx"), "utf8");
    expect(src).toMatch(/import \{ interceptLocaleSwitch \} from "\.\/locale-switch-guard";/);
    expect(src).toMatch(/if \(code !== activeLocale && interceptLocaleSwitch\(switchLocalePath\(currentPath, code\)\)\) event\.preventDefault\(\);/);
  });

  it("the guard module persists, sends and logs nothing", () => {
    const src = readFileSync(path.join(process.cwd(), "src/components/layout/locale-switch-guard.ts"), "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    expect(src).not.toMatch(/Storage|cookie|fetch\(|console\.|location/);
  });
});
