import { describe, it, expect } from "vitest";
import { apiError, buildApiErrorBody, apiErrorMessage } from "./errors";

describe("buildApiErrorBody — stable envelope, no leakage", () => {
  it("builds { error: { code, message } } with the default (ar) message", () => {
    const body = buildApiErrorBody("NOT_FOUND");
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message).toBe("المورد المطلوب غير موجود.");
    expect(body.error).not.toHaveProperty("details");
    expect(body.error).not.toHaveProperty("retryAfterSeconds");
  });

  it("localizes the message for the requested locale (en)", () => {
    expect(buildApiErrorBody("NOT_FOUND", { locale: "en" }).error.message).toBe(
      "The requested resource was not found."
    );
  });

  it("falls back to English for a locale without a curated translation", () => {
    // de has no curated message → English fallback (never a raw/blank value)
    expect(buildApiErrorBody("INVALID_INPUT", { locale: "de" }).error.message).toBe("Invalid request data.");
  });

  it("includes optional details and retryAfterSeconds only when provided", () => {
    const body = buildApiErrorBody("INVALID_INPUT", { details: { field: "page" }, retryAfterSeconds: 30 });
    expect(body.error.details).toEqual({ field: "page" });
    expect(body.error.retryAfterSeconds).toBe(30);
  });

  it("never emits a raw exception message (message comes from the curated catalog)", () => {
    const body = buildApiErrorBody("INTERNAL_ERROR", { locale: "en" });
    expect(body.error.message).toBe("Something went wrong, please try again.");
  });
});

describe("apiErrorMessage", () => {
  it("resolves per-locale with English fallback", () => {
    expect(apiErrorMessage("FORBIDDEN", "en")).toBe("You do not have permission to perform this action.");
    expect(apiErrorMessage("FORBIDDEN", "ar")).toBe("ليست لديك صلاحية لتنفيذ هذا الإجراء.");
    expect(apiErrorMessage("FORBIDDEN", "fr")).toBe("You do not have permission to perform this action.");
  });
});

describe("SLOT_REQUIRED (BOOKING-SLOT-AUTHORITY)", () => {
  /**
   * A SEPARATE CODE, NOT A REUSE. SLOT_UNAVAILABLE means a slot WAS chosen and is no
   * longer valid; SLOT_REQUIRED means the service is slot-based and none was supplied.
   * Same 422, different instruction to the customer — so the messages must differ too.
   */
  it("is 422 and carries its own message, distinct from SLOT_UNAVAILABLE", () => {
    expect(apiError("SLOT_REQUIRED").status).toBe(422);
    expect(apiError("SLOT_UNAVAILABLE").status).toBe(422);
    expect(apiErrorMessage("SLOT_REQUIRED", "en")).not.toBe(apiErrorMessage("SLOT_UNAVAILABLE", "en"));
    expect(apiErrorMessage("SLOT_REQUIRED", "ar")).not.toBe(apiErrorMessage("SLOT_UNAVAILABLE", "ar"));
  });

  it("has a real curated message in both en and ar, never a raw code", () => {
    for (const locale of ["en", "ar"] as const) {
      const message = apiErrorMessage("SLOT_REQUIRED", locale);
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toContain("SLOT_REQUIRED");
    }
  });
});

describe("apiError (HTTP)", () => {
  it("maps codes to the right status and sets no-store", async () => {
    const notFound = apiError("NOT_FOUND", { locale: "en" });
    expect(notFound.status).toBe(404);
    expect(notFound.headers.get("cache-control")).toBe("no-store");
    const body = await notFound.json();
    expect(body).toEqual({ error: { code: "NOT_FOUND", message: "The requested resource was not found." } });
  });

  it("maps each code to its canonical status", () => {
    expect(apiError("INVALID_INPUT").status).toBe(400);
    expect(apiError("UNAUTHORIZED").status).toBe(401);
    expect(apiError("FORBIDDEN").status).toBe(403);
    expect(apiError("INTERNAL_ERROR").status).toBe(500);
  });
});

// PLATFORM-BOOKING-INCOMPLETE-ERROR-1 — the wire contract for an incomplete customer.
describe("CUSTOMER_INCOMPLETE — the incomplete-customer contract", () => {
  it("is 403: authenticated, but not currently permitted", () => {
    // Asserted through the REAL response rather than the private status table: the
    // status a client receives is the contract, and apiError() is what produces it.
    //
    // Same status as its neighbours NO_CUSTOMER_PROFILE / NO_PROVIDER_PROFILE, which
    // mean the same kind of thing. NOT 422: nothing about the REQUEST is malformed, and
    // a client must not think it can retry by changing the body.
    expect(apiError("CUSTOMER_INCOMPLETE", { locale: "en" }).status).toBe(403);
    expect(apiError("CUSTOMER_INCOMPLETE", { locale: "en" }).status).toBe(
      apiError("NO_CUSTOMER_PROFILE", { locale: "en" }).status
    );
  });

  it("carries a curated English message", () => {
    expect(apiErrorMessage("CUSTOMER_INCOMPLETE", "en")).toBe(
      "Please verify your email address before booking."
    );
  });

  it("carries a curated Arabic message", () => {
    const ar = apiErrorMessage("CUSTOMER_INCOMPLETE", "ar");
    expect(ar).toBe("يرجى تأكيد بريدك الإلكتروني قبل الحجز.");
    expect(ar).not.toBe(apiErrorMessage("CUSTOMER_INCOMPLETE", "en"));
  });

  /**
   * THE CODE IS THE STABLE HALF. A client branches on it, so it must be byte-identical
   * in every language while only the prose changes.
   */
  it("keeps the machine code identical across locales", () => {
    const en = buildApiErrorBody("CUSTOMER_INCOMPLETE", { locale: "en" });
    const ar = buildApiErrorBody("CUSTOMER_INCOMPLETE", { locale: "ar" });

    expect(en.error.code).toBe("CUSTOMER_INCOMPLETE");
    expect(ar.error.code).toBe("CUSTOMER_INCOMPLETE");
    expect(en.error.message).not.toBe(ar.error.message);
  });

  /**
   * NOTHING ABOUT THE AUTH INTERNALS. The message must not name the synthetic domain,
   * the provider, the session, or anything that would describe HOW completeness is
   * decided — and it must never carry a Next redirect digest.
   */
  it("leaks no auth internals and no redirect digest", () => {
    for (const locale of ["en", "ar"] as const) {
      const serialized = JSON.stringify(buildApiErrorBody("CUSTOMER_INCOMPLETE", { locale }));
      for (const forbidden of [
        "NEXT_REDIRECT", "digest", "onboarding", "phone.barq.internal",
        "authUserId", "emailVerified", "better-auth", "Location",
      ]) {
        expect(serialized).not.toContain(forbidden);
      }
    }
  });
});
