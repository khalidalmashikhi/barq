import { randomBytes } from "node:crypto";

// UUID v7 (RFC 9562) generator — time-ordered, matching the ids Prisma mints with `uuid(7)`
// (ADR-0006). Needed only where an id must be known BEFORE the row is inserted: the document-first
// vehicle onboarding derives the private storage key from the asset id and uploads the object
// before the single transaction that creates the asset.
//
// Layout: 48-bit Unix-ms timestamp | 4-bit version (7) | 12 random bits | 2-bit variant (10) |
// 62 random bits. Randomness is from the OS CSPRNG.

export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  const ms = BigInt(now);
  bytes[0] = Number((ms >> 40n) & 0xffn);
  bytes[1] = Number((ms >> 32n) & 0xffn);
  bytes[2] = Number((ms >> 24n) & 0xffn);
  bytes[3] = Number((ms >> 16n) & 0xffn);
  bytes[4] = Number((ms >> 8n) & 0xffn);
  bytes[5] = Number(ms & 0xffn);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122/9562 variant
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
