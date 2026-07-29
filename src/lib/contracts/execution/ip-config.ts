import "server-only";

// Signature Records — Phase E.3, requirement #3: "IP (configurable/
// privacy-aware)". Whether a signature's IP address is ever persisted
// is controlled here, not hardcoded at each call site — a deployment
// can disable IP capture entirely (e.g. for a jurisdiction/policy that
// treats it as unnecessary personal data collection) via one env var.
// Defaults to enabled: an IP address on a signature record is a
// normal, expected part of an audit trail, not itself sensitive
// contract content.

export function isSignatureIpLoggingEnabled(): boolean {
  const raw = process.env.CONTRACT_SIGNATURE_LOG_IP;
  if (raw === undefined || raw === "") return true;
  return raw !== "false" && raw !== "0";
}

export function resolveSignatureIp(ipAddress: string | undefined): string | null {
  if (!isSignatureIpLoggingEnabled()) return null;
  return ipAddress ?? null;
}
