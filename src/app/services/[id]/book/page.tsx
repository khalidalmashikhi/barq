import { redirect, notFound } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { requireAuth, UnauthenticatedError } from "@/lib/auth";
import { getServiceById, getActivePricesForService } from "@/lib/services/get-service-detail";
import { prisma } from "@/lib/db";
import { createBooking } from "@/lib/booking/create-booking";

// Booking form page — Engineering Sprint (Booking Engine).
//
// AUTH: uses getSession() (not requireAuth()) so an unauthenticated
// visitor gets a clean redirect to "/" rather than a thrown error on a
// page render — the actual mutation (createBooking) independently
// re-checks auth server-side regardless of what this page does, so
// this is a UX nicety, not the real security boundary.
//
// NO DATE/TIME SELECTION — Booking has no field to store a
// customer-chosen date, and Availability (which does model time slots)
// has no relation back to Booking at all. Building a picker that
// doesn't actually persist anything would be worse than omitting it —
// flagged here and in the sprint report, not silently worked around.

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function BookServicePage({ params, searchParams }: Props) {
  const { id } = await params;
  const { error } = await searchParams;

  let barqUserId: string;

  try {
    const { barqUser } = await requireAuth();
    barqUserId = barqUser.id;
  } catch (authError) {
    if (authError instanceof UnauthenticatedError) {
      redirect("/");
    }

    throw authError;
  }

  const fetchedService = await getServiceById(id);
  if (!fetchedService) {
    notFound();
    return null;
  }
  const service = fetchedService;

  const prices = await getActivePricesForService(service.id);

  // Check for a Customer profile here too, purely for a better message
  // before the user fills out the form — createBooking() independently
  // re-verifies this regardless.
  const customer = await prisma.customer.findUnique({
    where: { userId: barqUserId },
  });

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">حجز: {service.name}</h1>
        <p className="mt-1 text-sm text-foreground/50">{service.providerName}</p>
      </div>

      {error && error !== "NO_CUSTOMER_PROFILE" && (
        <div className="flex items-start gap-3 rounded-2xl border border-danger/40 bg-danger/10 p-4">
          <AlertCircle size={20} strokeWidth={1.75} className="mt-0.5 shrink-0 text-danger" />
          <p className="text-sm text-danger">{error}</p>
        </div>
      )}

      {!customer && (
        <div className="flex items-start gap-3 rounded-2xl border border-accent/40 bg-accent/10 p-4">
          <AlertCircle size={20} strokeWidth={1.75} className="mt-0.5 shrink-0 text-accent-foreground" />
          <p className="text-sm text-accent-foreground">
            يلزم إكمال الملف الشخصي كعميل قبل إتمام الحجز. تواصل مع الدعم إذا استمرت هذه الرسالة.
          </p>
        </div>
      )}

      {prices.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-10 text-center">
          <p className="text-sm text-foreground/50">لا تتوفر خيارات سعرية لهذه التجربة حالياً</p>
        </div>
      ) : (
        <form
          action={async (formData: FormData) => {
            "use server";
            const result = await createBooking(formData);
            if (!result.ok) {
              redirect(`/services/${service.id}/book?error=${encodeURIComponent(result.error)}`);
              return;
            }
            redirect(`/bookings/${result.bookingId}/confirmation`);
          }}
          className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm"
        >
          <input type="hidden" name="serviceId" value={service.id} />

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-foreground/80">اختر السعر</legend>
            {prices.map((price) => (
              <label
                key={price.id}
                className="flex items-center gap-3 rounded-xl border border-border px-4 py-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent/20"
              >
                <input type="radio" name="priceId" value={price.id} required className="accent-primary" />
                {price.amount} {price.currency}
              </label>
            ))}
          </fieldset>

          <button
            type="submit"
            disabled={!customer}
            className="rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            تأكيد طلب الحجز
          </button>
        </form>
      )}
    </main>
  );
}
