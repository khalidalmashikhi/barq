import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("server-only", () => ({}));
import {
  getOtpSendIpRateLimit,
  getOtpSendPhoneRateLimit,
  getOtpVerifyIpRateLimit,
  otpSendIpKey,
  otpSendPhoneKey,
  otpVerifyIpKey,
} from "./otp-rate-limit-config";
import { normalizeOmanPhone } from "./normalize-oman-phone";
import { hmacRateLimitKey } from "@/lib/rate-limit/client-ip";

const SECRET = "test-secret";

const ENV_KEYS = [
  "AUTH_OTP_SEND_IP_MAX",
  "AUTH_OTP_SEND_IP_WINDOW_SECONDS",
  "AUTH_OTP_SEND_PHONE_MAX",
  "AUTH_OTP_VERIFY_IP_MAX",
];
afterEach(() => ENV_KEYS.forEach((k) => delete process.env[k]));

describe("otp-rate-limit-config — defaults + env tuning", () => {
  it("returns generous defaults when unset", () => {
    expect(getOtpSendIpRateLimit()).toEqual({ limit: 15, windowSeconds: 3600 });
    expect(getOtpSendPhoneRateLimit()).toEqual({ limit: 6, windowSeconds: 3600 });
    expect(getOtpVerifyIpRateLimit()).toEqual({ limit: 30, windowSeconds: 3600 });
  });

  it("honors a valid env override", () => {
    process.env.AUTH_OTP_SEND_IP_MAX = "40";
    expect(getOtpSendIpRateLimit().limit).toBe(40);
  });

  it("fails fast on a malformed-but-set value (never silently falls back)", () => {
    process.env.AUTH_OTP_SEND_IP_MAX = "not-a-number";
    expect(() => getOtpSendIpRateLimit()).toThrow(/positive integer/);
    process.env.AUTH_OTP_SEND_IP_MAX = "0";
    expect(() => getOtpSendIpRateLimit()).toThrow(/positive integer/);
  });
});

describe("limiter keys — namespaced, non-colliding, HMAC identities (no PII)", () => {
  it("send/verify + ip/phone scopes never collide (distinct prefixes)", () => {
    const keys = new Set([otpSendIpKey("HASH"), otpSendPhoneKey("HASH"), otpVerifyIpKey("HASH")]);
    expect(keys.size).toBe(3);
    expect(otpSendIpKey("HASH")).toBe("otp:send:ip:HASH");
    expect(otpVerifyIpKey("HASH")).toBe("otp:verify:ip:HASH");
    expect(otpSendPhoneKey("HASH")).toBe("otp:send:phone:HASH");
  });

  it("the IP key depends ONLY on the IP hash — same IP across different phones shares one IP-limiter key", () => {
    expect(otpSendIpKey("HASH_A")).toBe(otpSendIpKey("HASH_A"));
    expect(otpSendIpKey("HASH_A")).not.toBe(otpSendIpKey("HASH_B"));
  });

  it("the send-phone key is built from the HMAC of the canonical phone — NEVER the raw phone", () => {
    const canonical = "+96898115159";
    const key = otpSendPhoneKey(hmacRateLimitKey(canonical, SECRET));
    expect(key).not.toContain(canonical);
    expect(key).not.toContain("96898115159");
    expect(key).toMatch(/^otp:send:phone:[a-f0-9]{64}$/);
  });

  it("all P0-1 canonical phone variants HMAC to ONE send-phone limiter key (canonicalize BEFORE hashing)", () => {
    const keyFor = (raw: string) => {
      const n = normalizeOmanPhone(raw);
      return n.ok ? otpSendPhoneKey(hmacRateLimitKey(n.e164, SECRET)) : `REJECTED`;
    };
    const keys = new Set(["98115159", "+96898115159", "96898115159", "0096898115159", "+968 9811 5159"].map(keyFor));
    expect(keys.size).toBe(1);
    // The single shared key is the HMAC of the canonical E.164, with no plaintext phone in it.
    expect([...keys][0]).toBe(otpSendPhoneKey(hmacRateLimitKey("+96898115159", SECRET)));
    expect([...keys][0]).not.toContain("96898115159");
  });

  it("different canonical phones produce different send-phone limiter keys", () => {
    expect(otpSendPhoneKey(hmacRateLimitKey("+96898115159", SECRET))).not.toBe(
      otpSendPhoneKey(hmacRateLimitKey("+96871234567", SECRET))
    );
  });

  it("changing the HMAC secret changes the phone key digest", () => {
    expect(otpSendPhoneKey(hmacRateLimitKey("+96898115159", "s1"))).not.toBe(
      otpSendPhoneKey(hmacRateLimitKey("+96898115159", "s2"))
    );
  });
});
