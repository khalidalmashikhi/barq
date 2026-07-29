import { describe, it, expect, afterEach } from "vitest";
import { getAppUrl, buildPublicUrl } from "./build-public-url";

describe("getAppUrl", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  it("falls back to localhost when NEXT_PUBLIC_APP_URL is unset", () => {
    expect(getAppUrl()).toBe("http://localhost:3000");
  });

  it("uses NEXT_PUBLIC_APP_URL when set", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://barq.example";
    expect(getAppUrl()).toBe("https://barq.example");
  });
});

describe("buildPublicUrl", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  it("builds a locale-prefixed absolute URL", () => {
    expect(buildPublicUrl("en", "/services/123")).toBe("http://localhost:3000/en/services/123");
  });

  it("respects NEXT_PUBLIC_APP_URL for the origin", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://barq.example";
    expect(buildPublicUrl("ar", "/providers/desert-co")).toBe("https://barq.example/ar/providers/desert-co");
  });
});
