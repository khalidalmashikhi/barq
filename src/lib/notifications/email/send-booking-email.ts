import "server-only";
import { getBookingEmailProvider } from "./booking-email-config";
import { logger } from "@/lib/logger";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

// BOOKING NOTIFICATION DELIVERY — the transactional booking-email SENDER. Calls the Resend HTTP API
// directly (a separate path from the OTP ResendEmailProvider, which is tightly coupled to OTP), so
// OTP behavior is untouched. Classifies every outcome into retryable vs terminal (§11) and NEVER
// returns or logs the recipient address or body — only a sanitized error class.

export type SendBookingEmailParams = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type SendBookingEmailResult =
  | { ok: true; providerMessageId: string | null }
  // retryable: transient network / rate-limit / 5xx — try again later within the retry budget.
  | { ok: false; retryable: true; errorClass: string }
  // terminal: a permanent provider rejection (bad address, auth, unprocessable) — do not retry.
  | { ok: false; retryable: false; errorClass: string }
  // the provider is disabled/misconfigured — the worker should not even reach here (it checks first).
  | { ok: false; retryable: false; errorClass: "DISABLED" };

/** Classify an HTTP status into retryable vs terminal. 408/425/429 and any 5xx are transient. */
function classifyHttp(status: number): { retryable: boolean; errorClass: string } {
  if (status === 408 || status === 425 || status === 429 || status >= 500) {
    return { retryable: true, errorClass: `HTTP_${status}` };
  }
  return { retryable: false, errorClass: `HTTP_${status}` };
}

export async function sendBookingEmail(params: SendBookingEmailParams): Promise<SendBookingEmailResult> {
  const provider = getBookingEmailProvider();

  if (provider.kind === "disabled") {
    return { ok: false, retryable: false, errorClass: "DISABLED" };
  }

  if (provider.kind === "console") {
    // Dev/local: prove the render pipeline without sending. Log the subject only — never the body
    // (may contain the recipient's booking facts) and never the address.
    logger.info("bookingEmail.console", { subject: params.subject });
    return { ok: true, providerMessageId: null };
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: provider.from,
        to: [params.to],
        subject: params.subject,
        html: params.html,
        text: params.text,
      }),
    });

    if (!response.ok) {
      const { retryable, errorClass } = classifyHttp(response.status);
      return { ok: false, retryable, errorClass };
    }

    const body = (await response.json().catch(() => null)) as { id?: string } | null;
    return { ok: true, providerMessageId: body?.id ?? null };
  } catch {
    // Network failure / timeout / DNS — transient by nature. Never include the caught error (it can
    // carry the endpoint/address); a fixed class is enough to diagnose without leaking PII.
    return { ok: false, retryable: true, errorClass: "NETWORK" };
  }
}
