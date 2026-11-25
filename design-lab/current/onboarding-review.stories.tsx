import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { VehicleJourneySteps } from "@/components/provider/vehicle-journey/journey-steps";
import { JOURNEY_CARD, JOURNEY_PAGE, JOURNEY_TITLE } from "@/components/provider/vehicle-journey/journey-ui";
import { vehicleTypeOptions } from "@/lib/vehicles/vehicle-type-options";
import type { Locale } from "@/i18n/locales";
import { OnboardingReviewForm, type FieldView } from "@/app/[locale]/provider/vehicles/new/[vehicleId]/_components/onboarding-review-form";

// The REAL onboarding review form (wizard step 3, "review vehicle details") with SYNTHETIC data, for
// before/after visual QA at phone widths. Its server actions resolve to design-lab/mocks (see
// .storybook/main.ts), so nothing is saved or sent. The page header and the document card (passed to
// the form as children, as page.tsx does) are a markup replica of
// src/app/[locale]/provider/vehicles/new/[vehicleId]/page.tsx (a server component that cannot run
// here) — only the form itself is the app's own component.
//
// Every value below is invented (no real registration, plate, VIN or person).

type F = Partial<FieldView> & Pick<FieldView, "key">;
const spec: Record<FieldView["key"], Pick<FieldView, "group" | "kind" | "sensitive" | "required">> = {
  make: { group: "CUSTOMER", kind: "text", sensitive: false, required: true },
  model: { group: "CUSTOMER", kind: "text", sensitive: false, required: true },
  modelYear: { group: "CUSTOMER", kind: "int", sensitive: false, required: true },
  color: { group: "CUSTOMER", kind: "text", sensitive: false, required: true },
  bookablePassengerCapacity: { group: "CUSTOMER", kind: "int", sensitive: false, required: true },
  licensedPassengerCapacity: { group: "PRIVATE", kind: "int", sensitive: false, required: true },
  registeredSeats: { group: "PRIVATE", kind: "int", sensitive: false, required: false },
  plateNumber: { group: "PRIVATE", kind: "plate", sensitive: true, required: true },
  plateType: { group: "PRIVATE", kind: "text", sensitive: false, required: false },
  vin: { group: "PRIVATE", kind: "vin", sensitive: true, required: true },
  engineNumber: { group: "PRIVATE", kind: "text", sensitive: true, required: false },
  usageClassification: { group: "PRIVATE", kind: "text", sensitive: false, required: false },
  engineCapacity: { group: "PRIVATE", kind: "int", sensitive: false, required: false },
  emptyWeight: { group: "PRIVATE", kind: "int", sensitive: false, required: false },
  maximumLoad: { group: "PRIVATE", kind: "int", sensitive: false, required: false },
  axleCount: { group: "PRIVATE", kind: "int", sensitive: false, required: false },
  licenseValidFrom: { group: "PRIVATE", kind: "date", sensitive: false, required: false },
  licenseExpiry: { group: "PRIVATE", kind: "date", sensitive: false, required: true },
  firstRegistrationDate: { group: "PRIVATE", kind: "date", sensitive: false, required: false },
};
const field = (f: F): FieldView => ({
  ...spec[f.key],
  extractedValue: null,
  confidence: null,
  confirmedValue: null,
  decision: null,
  source: "UNRESOLVED",
  needsReview: false,
  ...f,
});
const read = (value: string | number, confidence: FieldView["confidence"] = "HIGH") => ({ extractedValue: value, confidence, source: "NATIVE_PDF_TEXT" as const });

/** A typical partial reading: make/model only derived (suggestions), a few direct values, VIN and
 *  bookable capacity missing, the licensed capacity uncertain. */
const PARTIAL_READING: FieldView[] = [
  field({ key: "make", ...read("Synthmotor", "MEDIUM"), heuristic: true, needsReview: true }),
  field({ key: "model", ...read("Lab 7", "MEDIUM"), heuristic: true, needsReview: true }),
  field({ key: "modelYear", ...read(2021) }),
  field({ key: "color", ...read("أبيض") }),
  field({ key: "bookablePassengerCapacity" }),
  field({ key: "licensedPassengerCapacity", ...read(7, "LOW"), needsReview: true }),
  field({ key: "registeredSeats" }),
  field({ key: "plateNumber", ...read("SYN 0000") }),
  field({ key: "plateType", ...read("خصوصي") }),
  field({ key: "vin", needsReview: true }),
  field({ key: "engineNumber" }),
  field({ key: "usageClassification", ...read("خاص") }),
  field({ key: "engineCapacity", ...read(2000) }),
  field({ key: "emptyWeight" }),
  field({ key: "maximumLoad" }),
  field({ key: "axleCount", ...read(2) }),
  field({ key: "licenseValidFrom", ...read("2026-01-10") }),
  field({ key: "licenseExpiry", ...read("2027-01-09") }),
  field({ key: "firstRegistrationDate" }),
];

function ReviewScreen({ fields }: { fields: FieldView[] }) {
  const t = useTranslations("provider");
  const td = t as unknown as (key: string, values?: Record<string, string | number>) => string;
  const locale = useLocale() as Locale;
  return (
    <div className="min-h-screen bg-background">
      <div className={JOURNEY_PAGE}>
        {/* replica of the page header (page.tsx) */}
        <span className="inline-flex min-h-11 w-fit items-center gap-2 text-sm text-foreground/70">
          <ArrowRight size={16} strokeWidth={1.75} aria-hidden className="ltr:rotate-180" />
          {t("backToVehiclesLabel")}
        </span>
        <div className="flex flex-col gap-1.5">
          <h1 className={JOURNEY_TITLE}>{t("vehicleOnboardReviewTitle")}</h1>
          <p className="text-sm text-foreground/70">{t("vehicleOnboardReviewSubtitle")}</p>
        </div>
        <VehicleJourneySteps progress={{ stage: "review", reading: "succeeded" }} />
        <OnboardingReviewForm
          vehicleId="lab-synthetic-vehicle"
          fields={fields}
          vehicleTypeOptions={vehicleTypeOptions(locale)}
          suggestedVehicleType="VAN"
          documentDescription="SYNTHMOTOR LAB 7"
          noticeKey={null}
          noticeVariant="info"
        >
          {/* replica of the document card (page.tsx) — a synthetic PDF, no preview image */}
          <section aria-label={t("vehicleRegDocumentLabel")} className={`${JOURNEY_CARD} flex flex-col gap-3`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-base font-semibold text-foreground">
                <FileText size={20} strokeWidth={1.75} aria-hidden className="text-secondary-700" />
                {t("vehicleRegDocumentLabel")}
              </p>
              <Badge variant="success">{t("vehicleRegStateExtracted")}</Badge>
            </div>
            <p className="text-sm text-foreground/75">{t("vehicleOnboardSetSummaryPdf")}</p>
            <p className="text-sm text-foreground/80">
              {td("vehicleCardDocFound", { found: 12, total: 18 })}
              {" · "}
              <span className="font-semibold text-foreground">{td("vehicleCardDocReview", { count: 3 })}</span>
            </p>
            <ul className="flex flex-wrap gap-3">
              <li className="flex min-w-0 flex-1 basis-36 flex-col gap-1.5 rounded-2xl border border-border bg-background p-2">
                <p className="flex min-h-24 items-center justify-center gap-2 rounded-xl bg-card px-2 py-3 text-center text-sm text-foreground/80">
                  <FileText size={20} strokeWidth={1.6} aria-hidden className="shrink-0 text-secondary-700" />
                  <span className="min-w-0">
                    <bdi>synthetic-registration.pdf</bdi> · {td("vehicleOnboardFileSizeMb", { size: "0.42" })}
                  </span>
                </p>
                <div className="flex flex-wrap items-center justify-between gap-x-2 px-1">
                  <span className="text-sm font-medium text-foreground/80">{t("vehicleRegPagePdf")}</span>
                  <span className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4">{t("vehicleDocViewButton")}</span>
                </div>
              </li>
            </ul>
          </section>
        </OnboardingReviewForm>
      </div>
    </div>
  );
}

const meta = { title: "Current app (before)/Onboarding review (real form)", tags: ["text-scale"], parameters: { a11y: { test: "todo" }, nextjs: { appDirectory: true, navigation: { pathname: "/ar/provider/vehicles/new/lab-synthetic-vehicle" } } } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const PartialReading: Story = {
  name: "Review — partial reading (synthetic)",
  render: () => <ReviewScreen fields={PARTIAL_READING} />,
};
