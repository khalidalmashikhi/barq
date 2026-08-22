import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => {
  class UnauthenticatedError extends Error {}
  class ForbiddenError extends Error {}
  return { requireAuth: vi.fn(), UnauthenticatedError, ForbiddenError };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/with-request-tracing", () => ({
  withRequestTracing: (_n: string, handler: () => Promise<Response>) => handler(),
}));
vi.mock("@/lib/auth", () => ({
  requireAuth: (...a: unknown[]) => h.requireAuth(...a),
  UnauthenticatedError: h.UnauthenticatedError,
  ForbiddenError: h.ForbiddenError,
}));

const createReviewMock = vi.fn();
vi.mock("@/lib/booking/create-review", () => ({ createReview: (...a: unknown[]) => createReviewMock(...a) }));

const { POST } = await import("./route");

beforeEach(() => {
  h.requireAuth.mockReset();
  createReviewMock.mockReset();
  h.requireAuth.mockResolvedValue({ authUserId: "au1", barqUser: { id: "u1" } });
  createReviewMock.mockResolvedValue({ ok: true });
});

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const req = (body: unknown) =>
  new Request("http://x/api/v1/me/bookings/b1/review?locale=en", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const valid = { rating: 5, content: "Wonderful trip, the guide was excellent." };

/** The nth call to createReview(), as its real (bookingId, formData) pair. */
const callAt = (index: number): [string, FormData] => {
  const call = createReviewMock.mock.calls[index];
  expect(call, `expected a createReview call at index ${index}`).toBeDefined();
  return call as [string, FormData];
};

/** What createReview() actually received on the most recent call. */
const forwarded = () => {
  const [, form] = callAt(createReviewMock.mock.calls.length - 1);
  return { rating: form.get("rating"), content: form.get("content") };
};

describe("POST /api/v1/me/bookings/{id}/review", () => {
  // --- success -------------------------------------------------------------

  it("200 { ok: true } and delegates to the authoritative createReview", async () => {
    const res = await POST(req(valid), params("b1"));

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true });
    expect(createReviewMock).toHaveBeenCalledTimes(1);
    expect(callAt(0)[0]).toBe("b1");
  });

  it("forwards the booking id from the route, never from the body", async () => {
    await POST(req({ ...valid, bookingId: "someone-elses" }), params("b1"));

    expect(callAt(0)[0]).toBe("b1");
  });

  // NOTHING AUTHORITATIVE IS ACCEPTED FROM THE CLIENT. createReview() reads
  // provider/service linkage off the Booking row it fetched, and the adapter
  // forwards only the two fields the contract defines.
  it("forwards only rating and content, dropping any other field the client sends", async () => {
    await POST(
      req({
        ...valid,
        customerId: "c-other",
        providerId: "p-other",
        serviceId: "s-other",
        status: "COMPLETED",
        hasReview: false,
        moderationState: "PUBLISHED",
      }),
      params("b1")
    );

    const [, form] = callAt(0);
    expect([...form.keys()].sort()).toEqual(["content", "rating"]);
  });

  it("preserves multiline content and unicode exactly as sent", async () => {
    const content = "أفضل رحلة\nخلال العام 🌟";
    await POST(req({ rating: 4, content }), params("b1"));

    expect(forwarded().content).toBe(content);
  });

  // --- rating: validated by the domain, forwarded faithfully ---------------

  it("accepts the boundary ratings 1 and 5", async () => {
    await POST(req({ ...valid, rating: 1 }), params("b1"));
    expect(forwarded().rating).toBe("1");

    await POST(req({ ...valid, rating: 5 }), params("b1"));
    expect(forwarded().rating).toBe("5");
  });

  // The adapter does NOT pre-validate: a second copy of "integer 1-5" here could
  // drift from the domain's. It forwards, and createReview() rejects.
  it.each([
    ["zero", 0, "0"],
    ["above the range", 6, "6"],
    ["a decimal", 2.5, "2.5"],
    ["a string", "5", "5"],
    ["a boolean", true, "true"],
  ])("forwards %s verbatim for the domain to reject", async (_label, rating, expected) => {
    createReviewMock.mockResolvedValue({ ok: false, error: "INVALID_RATING" });

    const res = await POST(req({ ...valid, rating }), params("b1"));

    expect(forwarded().rating).toBe(expected);
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("INVALID_RATING");
  });

  it("forwards an empty rating when the field is missing or null", async () => {
    await POST(req({ content: valid.content }), params("b1"));
    expect(forwarded().rating).toBe("");

    await POST(req({ ...valid, rating: null }), params("b1"));
    expect(forwarded().rating).toBe("");
  });

  it("422 INVALID_RATING is surfaced with its own code", async () => {
    createReviewMock.mockResolvedValue({ ok: false, error: "INVALID_RATING" });

    const res = await POST(req({ ...valid, rating: 0 }), params("b1"));

    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("INVALID_RATING");
  });

  // --- content -------------------------------------------------------------

  it("forwards an empty string when content is missing or not a string", async () => {
    await POST(req({ rating: 5 }), params("b1"));
    expect(forwarded().content).toBe("");

    await POST(req({ rating: 5, content: 42 }), params("b1"));
    expect(forwarded().content).toBe("");
  });

  // Trimming is the domain's job — the adapter must not pre-trim, or a
  // whitespace-only body would arrive as "" and be indistinguishable from absent.
  it("forwards whitespace-only content untrimmed for the domain to reject", async () => {
    createReviewMock.mockResolvedValue({ ok: false, error: "INVALID_CONTENT" });

    const res = await POST(req({ rating: 5, content: "   \n  " }), params("b1"));

    expect(forwarded().content).toBe("   \n  ");
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("INVALID_CONTENT");
  });

  it("forwards content at and beyond the 2000-character bound without truncating", async () => {
    await POST(req({ rating: 5, content: "a".repeat(2000) }), params("b1"));
    expect(String(forwarded().content).length).toBe(2000);

    createReviewMock.mockResolvedValue({ ok: false, error: "INVALID_CONTENT" });
    const res = await POST(req({ rating: 5, content: "a".repeat(2001) }), params("b1"));
    expect(String(forwarded().content).length).toBe(2001);
    expect(res.status).toBe(422);
  });

  // --- malformed transport --------------------------------------------------

  it("400 INVALID_INPUT for a body that is not JSON (createReview never called)", async () => {
    const res = await POST(req("not json at all"), params("b1"));

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_INPUT");
    expect(createReviewMock).not.toHaveBeenCalled();
  });

  it("400 INVALID_INPUT for a JSON body that is not an object", async () => {
    const res = await POST(req("null"), params("b1"));

    expect(res.status).toBe(400);
    expect(createReviewMock).not.toHaveBeenCalled();
  });

  it("400 INVALID_INPUT when the domain rejects a malformed booking id", async () => {
    createReviewMock.mockResolvedValue({ ok: false, error: "INVALID_INPUT" });

    const res = await POST(req(valid), params("not-a-uuid"));

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_INPUT");
  });

  // --- auth / ownership -----------------------------------------------------

  it("401 unauthenticated, and createReview is never reached", async () => {
    h.requireAuth.mockRejectedValue(new h.UnauthenticatedError());

    const res = await POST(req(valid), params("b1"));

    expect(res.status).toBe(401);
    expect(createReviewMock).not.toHaveBeenCalled();
  });

  it("403 for a suspended or deactivated account", async () => {
    h.requireAuth.mockRejectedValue(new h.ForbiddenError());

    const res = await POST(req(valid), params("b1"));

    expect(res.status).toBe(403);
    expect(createReviewMock).not.toHaveBeenCalled();
  });

  it("403 NO_CUSTOMER_PROFILE for a user with no Customer row", async () => {
    createReviewMock.mockResolvedValue({ ok: false, error: "NO_CUSTOMER_PROFILE" });

    const res = await POST(req(valid), params("b1"));

    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("NO_CUSTOMER_PROFILE");
  });

  /**
   * ANTI-ENUMERATION. createReview() answers BOOKING_NOT_FOUND for a booking that
   * does not exist AND for one belonging to another customer. The API must be
   * equally unable to tell them apart, so this asserts the two responses are
   * byte-identical rather than merely both 404.
   */
  it("404 for a missing booking and for a foreign booking, indistinguishably", async () => {
    createReviewMock.mockResolvedValue({ ok: false, error: "BOOKING_NOT_FOUND" });

    const missing = await POST(req(valid), params("00000000-0000-0000-0000-000000000001"));
    const foreign = await POST(req(valid), params("00000000-0000-0000-0000-000000000002"));

    expect(missing.status).toBe(404);
    expect(foreign.status).toBe(404);
    expect(await missing.json()).toEqual(await foreign.json());
    expect((await (await POST(req(valid), params("b1"))).json()).error.code).toBe("NOT_FOUND");
  });

  // --- eligibility -----------------------------------------------------------

  it("422 BOOKING_NOT_REVIEWABLE for a booking that is not COMPLETED", async () => {
    createReviewMock.mockResolvedValue({ ok: false, error: "BOOKING_NOT_REVIEWABLE" });

    const res = await POST(req(valid), params("b1"));

    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("BOOKING_NOT_REVIEWABLE");
  });

  // --- duplicate / the retry contract ----------------------------------------

  /**
   * NOT IDEMPOTENT, and this is the whole point of the code.
   *
   * Review.bookingId is @unique, so a second insert is refused rather than quietly
   * accepted. The second call here returns 409 — never a silent 200 — because a
   * client must be able to tell "I just created this" from "one already existed".
   */
  it("a second review for the same booking is 409, never a silent 200", async () => {
    createReviewMock
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, error: "ALREADY_REVIEWED" });

    const first = await POST(req(valid), params("b1"));
    const second = await POST(req(valid), params("b1"));

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe("ALREADY_REVIEWED");
  });

  /**
   * THE LOST-RESPONSE RETRY. The domain returns ALREADY_REVIEWED both from its
   * pre-check and from the P2002 unique-violation backstop, so a concurrent race
   * and an ordinary duplicate are indistinguishable to a client — deliberately.
   * Either way the code is stable, which is what lets a client that never saw its
   * first response conclude the review did commit.
   */
  it("the P2002 race and the ordinary duplicate produce the same stable code", async () => {
    createReviewMock.mockResolvedValue({ ok: false, error: "ALREADY_REVIEWED" });

    const preCheck = await POST(req(valid), params("b1"));
    const race = await POST(req(valid), params("b1"));

    expect(preCheck.status).toBe(409);
    expect(race.status).toBe(409);
    expect(await preCheck.json()).toEqual(await race.json());
  });

  // --- rate limit and failures ------------------------------------------------

  it("429 RATE_LIMITED, preserving the domain's per-customer limit", async () => {
    createReviewMock.mockResolvedValue({ ok: false, error: "RATE_LIMITED" });

    const res = await POST(req(valid), params("b1"));

    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("RATE_LIMITED");
  });

  it("500 INTERNAL_ERROR for the domain's unexpected catch-all", async () => {
    createReviewMock.mockResolvedValue({ ok: false, error: "UNKNOWN_ERROR" });

    const res = await POST(req(valid), params("b1"));

    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("INTERNAL_ERROR");
  });

  // --- no reimplementation ----------------------------------------------------

  /**
   * The route owns transport, not rules. If it ever started rejecting a rating or a
   * length itself, that logic would be a second copy free to drift from
   * createReview()'s — so every one of these reaches the domain.
   */
  it("never rejects a well-formed body on its own — every rule is the domain's", async () => {
    createReviewMock.mockResolvedValue({ ok: false, error: "INVALID_RATING" });

    for (const rating of [0, 6, 2.5, -1, 99]) {
      createReviewMock.mockClear();
      await POST(req({ ...valid, rating }), params("b1"));
      expect(createReviewMock).toHaveBeenCalledTimes(1);
    }
  });
});
