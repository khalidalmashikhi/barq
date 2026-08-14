import { describe, it, expect } from "vitest";
import { resolveApiLocale, negotiateAcceptLanguage } from "./locale";

function req(url: string, headers?: Record<string, string>): Request {
  return new Request(url, { headers });
}

describe("resolveApiLocale — priority: query > Accept-Language > default(ar)", () => {
  it("uses a valid ?locale= query param", () => {
    expect(resolveApiLocale(req("http://x/api/v1/services?locale=en"))).toBe("en");
    expect(resolveApiLocale(req("http://x/api/v1/services?locale=de"))).toBe("de");
  });

  it("ignores an invalid ?locale= and falls back to Accept-Language", () => {
    expect(
      resolveApiLocale(req("http://x/api/v1/services?locale=zz", { "accept-language": "fr" }))
    ).toBe("fr");
  });

  it("falls back to Accept-Language when no query locale", () => {
    expect(resolveApiLocale(req("http://x/api/v1/services", { "accept-language": "en-US,en;q=0.9" }))).toBe("en");
  });

  it("defaults to ar when neither query nor a supported Accept-Language is present", () => {
    expect(resolveApiLocale(req("http://x/api/v1/services"))).toBe("ar");
    expect(resolveApiLocale(req("http://x/api/v1/services", { "accept-language": "zh-CN,ja;q=0.8" }))).toBe("ar");
  });
});

describe("negotiateAcceptLanguage", () => {
  it("returns undefined for null/empty", () => {
    expect(negotiateAcceptLanguage(null)).toBeUndefined();
    expect(negotiateAcceptLanguage("")).toBeUndefined();
  });

  it("picks the highest-q supported BARQ locale by primary subtag", () => {
    // ru has higher q than en here
    expect(negotiateAcceptLanguage("en;q=0.5, ru;q=0.9")).toBe("ru");
  });

  it("matches the primary subtag of a region-tagged language", () => {
    expect(negotiateAcceptLanguage("it-IT")).toBe("it");
  });

  it("skips unsupported languages and finds the first supported one", () => {
    expect(negotiateAcceptLanguage("zh-CN, ja, pl")).toBe("pl");
  });

  it("returns undefined when nothing maps to a BARQ locale", () => {
    expect(negotiateAcceptLanguage("zh-CN, ja")).toBeUndefined();
  });
});
