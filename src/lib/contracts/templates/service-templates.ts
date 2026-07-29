import "server-only";
import type { ContractTemplate, ContractRenderContext, ContractContent } from "./template";

// Contract Template Engine — Phase E.2. Three concrete templates
// (requirement #4's examples: Standard Service, Premium Service,
// Corporate). "Future Government" is deliberately NOT implemented here
// — see get-contract-template.ts's factory, which documents it as a
// reserved-but-unimplemented key.
//
// All wording below is clearly generic, placeholder legal-style
// boilerplate appropriate to a foundation phase — this is explicitly
// "NOT the final electronic signature implementation," and no
// governing document in this repository defines BARQ's actual
// contract wording. A future phase's legal/business review replaces
// this text; the template MECHANISM (parameterized, versioned,
// swappable by key) is this phase's actual deliverable.

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function baseSections(context: ContractRenderContext): ContractContent["sections"] {
  return [
    {
      heading: { ar: "أطراف الاتفاقية", en: "Parties" },
      body: {
        ar: `هذا العقد يوثق حجز الخدمة "${context.serviceName.ar}" المقدمة من "${context.providerName.ar}".`,
        en: `This contract documents the booking of the service "${context.serviceName.en}" provided by "${context.providerName.en}".`,
      },
    },
    {
      heading: { ar: "تفاصيل الحجز", en: "Booking Details" },
      body: {
        ar: `عدد المقاعد: ${context.seats}. السعر: ${context.priceAmount} ${context.priceCurrency}. رقم العقد: ${context.contractNumber}. تاريخ الإصدار: ${formatDate(context.generatedAt)}.`,
        en: `Seats: ${context.seats}. Price: ${context.priceAmount} ${context.priceCurrency}. Contract Number: ${context.contractNumber}. Issue Date: ${formatDate(context.generatedAt)}.`,
      },
    },
  ];
}

export const standardServiceTemplate: ContractTemplate = {
  key: "STANDARD_SERVICE",
  version: 1,
  render(context: ContractRenderContext): ContractContent {
    return {
      title: { ar: "عقد خدمة قياسي", en: "Standard Service Contract" },
      sections: baseSections(context),
    };
  },
};

export const premiumServiceTemplate: ContractTemplate = {
  key: "PREMIUM_SERVICE",
  version: 1,
  render(context: ContractRenderContext): ContractContent {
    return {
      title: { ar: "عقد خدمة مميزة", en: "Premium Service Contract" },
      sections: [
        ...baseSections(context),
        {
          heading: { ar: "مستوى الخدمة المميز", en: "Premium Service Level" },
          body: {
            ar: "يشمل هذا العقد مستوى خدمة مميزًا يتضمن أولوية الدعم والمرونة في إعادة الجدولة، وفق سياسات المنصة المعمول بها.",
            en: "This contract includes a premium service level with priority support and rescheduling flexibility, subject to the platform's applicable policies.",
          },
        },
      ],
    };
  },
};

export const corporateTemplate: ContractTemplate = {
  key: "CORPORATE",
  version: 1,
  render(context: ContractRenderContext): ContractContent {
    return {
      title: { ar: "عقد خدمة للشركات", en: "Corporate Service Contract" },
      sections: [
        ...baseSections(context),
        {
          heading: { ar: "الجهة التعاقدية", en: "Contracting Entity" },
          body: {
            ar: "يُبرم هذا العقد نيابة عن جهة اعتبارية (شركة أو مؤسسة)، وتخضع الفوترة والموافقات لسياسات الجهة التعاقدية.",
            en: "This contract is entered into on behalf of a corporate entity; invoicing and approvals are subject to that entity's own policies.",
          },
        },
      ],
    };
  },
};
