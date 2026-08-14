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
