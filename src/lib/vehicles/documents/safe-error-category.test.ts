import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { safeErrorCategory } from "./safe-error-category";

const SECRET_KEY = "asset-documents/0198aaaa-bbbb-7ccc-8ddd-eeeeeeeeeeee/vehicle_registration/1b2c.jpg";

describe("the vehicle-document upload paths never log a raw error message", () => {
  it.each([
    "src/lib/vehicles/onboarding/start-vehicle-onboarding.ts",
    "src/lib/vehicles/onboarding/cancel-onboarding-request.ts",
    "src/lib/vehicles/onboarding/onboarding-request.ts",
    "src/lib/vehicles/documents/upload-vehicle-document.ts",
    "src/lib/vehicles/documents/replace-vehicle-document.ts",
    "src/lib/vehicles/documents/prepare-vehicle-document.ts",
    "src/lib/file-safety/normalize-private-image.ts",
    "src/lib/vehicles/registration-extraction/registration-pdf-policy.ts",
    "src/app/api/provider/vehicles/onboarding/upload/route.ts",
  ])("%s", (rel) => {
    const code = readFileSync(path.join(process.cwd(), rel), "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code).not.toMatch(/error\.message|String\(error\)|console\./);
    for (const line of code.split("\n").filter((l) => /logger\.(error|warn|info)/.test(l))) {
      expect(line).toMatch(/error: safeErrorCategory\(error\)/);
      expect(line).not.toMatch(/objectKey|requestKey|originalFilename|input\.|newKey/);
    }
  });
});

describe("safeErrorCategory", () => {
  it("reduces an error to its class name — never its message", () => {
    class StorageOperationError extends Error {
      constructor(m: string) {
        super(m);
        this.name = "StorageOperationError";
      }
    }
    const out = safeErrorCategory(new StorageOperationError(`upload failed for ${SECRET_KEY} https://x.supabase.co/sign/abc?token=secret`));
    expect(out).toBe("StorageOperationError");
  });

  it("keeps a short machine code (e.g. a Prisma code) but not the message or meta", () => {
    const err = new Prisma.PrismaClientKnownRequestError(`Invalid invocation { onboardingRequestKey: "my-request-key-123" }`, { code: "P2002", clientVersion: "5.22.0", meta: { target: ["providerId", "onboardingRequestKey"] } });
    const out = safeErrorCategory(err);
    expect(out).toBe("PrismaClientKnownRequestError:P2002");
    expect(out).not.toContain("my-request-key-123");
  });

  it("a hostile name or code cannot smuggle content into the log", () => {
    const err = new Error("x") as Error & { code?: unknown };
    err.name = `Leaky ${SECRET_KEY}`;
    err.code = SECRET_KEY;
    expect(safeErrorCategory(err)).toBe("Error");
    err.name = "Fine";
    err.code = { nested: SECRET_KEY };
    expect(safeErrorCategory(err)).toBe("Fine");
  });

  it("non-Error throwables are a fixed label", () => {
    for (const thrown of [SECRET_KEY, 42, null, undefined, { message: SECRET_KEY }]) expect(safeErrorCategory(thrown)).toBe("NonError");
  });
});
