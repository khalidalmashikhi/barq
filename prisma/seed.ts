import { PrismaClient } from "@prisma/client";

// BARQ Database Seed — Engineering Sprint (Database Seed).
//
// IDEMPOTENCY STRATEGY, STATED HONESTLY: most models here have no
// natural unique key Prisma can upsert on (Service, Price, Booking,
// Availability, Commission all rely solely on their generated UUID
// primary key — none is a natural business key). Rather than overclaim
// per-row upsert idempotency this schema can't actually support
// everywhere, this script uses a single "already seeded" marker check
// at the top (a fixed, well-known seed phone number) and exits early
// if found. This makes the *script* safe to run multiple times without
// creating duplicates — it does not mean every individual row is
// upserted by its own natural key, since most don't have one.
//
// SCOPE NOTES, per explicit task instructions:
//   - No image/asset seeding: confirmed (Entry 062) that no image field
//     exists anywhere in schema.prisma. Left empty, not fabricated.
//   - Availability: seeded as standalone rows only — confirmed
//     (Entry 063) that Booking has no relation to Availability at all,
//     so no Booking-Availability link is invented here either.
//   - No Payment records: not requested in the task's explicit list;
//     Invoices below are created with paymentId left null rather than
//     inventing Payment data out of scope.
//   - Commission: one ACTIVE Commission per provider is seeded (a real,
//     existing model) so CONFIRMED/COMPLETED bookings can carry a
//     realistic, non-fabricated commissionSnapshot — computed from the
//     provider's own seeded Commission tier, not an arbitrary number.

const prisma = new PrismaClient();

const SEED_MARKER_PHONE = "+96890000000";

function bilingual(ar: string, en: string) {
  return { ar, en };
}

async function main() {
  const existingMarker = await prisma.user.findUnique({
    where: { phoneNumber: SEED_MARKER_PHONE },
  });

  if (existingMarker) {
    console.log("Seed marker user already exists — database already seeded. Exiting without changes.");
    return;
  }

  console.log("Seeding BARQ database...");

  // ---------------------------------------------------------------
  // 1. PROVIDERS
  // ---------------------------------------------------------------

  const providerDefs = [
    {
      phone: "+96891100001",
      nameAr: "عمان تريلز",
      nameEn: "Oman Trails",
      descAr: "شركة رائدة في تنظيم الجولات السياحية في محافظة ظفار، متخصصة في جولات الطبيعة والمغامرات.",
      descEn: "A leading tour operator in Dhofar Governorate, specializing in nature and adventure tours.",
    },
    {
      phone: "+96891100002",
      nameAr: "دروب الصحراء",
      nameEn: "Desert Trails Oman",
      descAr: "متخصصون في رحلات الصحراء والتخييم في رمال الشرقية وضواحيها.",
      descEn: "Specialists in desert expeditions and camping across the Sharqiya Sands region.",
    },
    {
      phone: "+96891100003",
      nameAr: "أعماق الخليج للغوص",
      nameEn: "Gulf Depths Diving",
      descAr: "مركز غوص معتمد يقدم رحلات استكشاف الحياة البحرية في جزر الديمانيات ومسندم.",
      descEn: "A certified diving center offering marine life expeditions around the Daymaniyat Islands and Musandam.",
    },
    {
      phone: "+96891100004",
      nameAr: "تراث عُمان",
      nameEn: "Oman Heritage Tours",
      descAr: "جولات ثقافية وتراثية تشمل القلاع والأسواق التقليدية في مختلف ولايات السلطنة.",
      descEn: "Cultural and heritage tours covering forts and traditional souqs across the Sultanate.",
    },
    {
      phone: "+96891100005",
      nameAr: "مغامرات الجبل الأخضر",
      nameEn: "Green Mountain Adventures",
      descAr: "خبراء في رحلات التسلق والتخييم في الجبل الأخضر وجبل شمس.",
      descEn: "Trekking and camping experts in Jebel Akhdar and Jebel Shams.",
    },
  ];

  const providers: Array<{ id: string; userId: string }> = [];

  for (const def of providerDefs) {
    const user = await prisma.user.create({
      data: {
        phoneNumber: def.phone,
        phoneNumberVerified: true,
        status: "ACTIVE",
      },
    });

    const provider = await prisma.provider.create({
      data: {
        userId: user.id,
        businessName: bilingual(def.nameAr, def.nameEn),
        businessDescription: bilingual(def.descAr, def.descEn),
        status: "APPROVED",
      },
    });

    await prisma.commission.create({
      data: {
        providerId: provider.id,
        tier: "TIER_10",
        status: "ACTIVE",
      },
    });

    providers.push({ id: provider.id, userId: user.id });
  }

  console.log(`Created ${providers.length} providers (with linked Users and Commissions).`);

  // ---------------------------------------------------------------
  // 2 & 3. SERVICES + PRICES
  // ---------------------------------------------------------------

  type ServiceDef = {
    providerIndex: number;
    nameAr: string;
    nameEn: string;
    descAr: string;
    descEn: string;
    prices: Array<{ label: string; amount: string }>;
  };

  const serviceDefs: ServiceDef[] = [
    { providerIndex: 0, nameAr: "جولة وادي دربات", nameEn: "Wadi Darbat Tour", descAr: "جولة قوارب واستكشاف طبيعي في وادي دربات الأخضر، مع شلالات موسمية وبحيرات هادئة.", descEn: "A boat tour and nature walk through the lush Wadi Darbat, featuring seasonal waterfalls and calm lakes.", prices: [{ label: "بالغ", amount: "15.000" }, { label: "طفل", amount: "8.000" }, { label: "VIP", amount: "30.000" }] },
    { providerIndex: 0, nameAr: "مغامرة جبل سمحان", nameEn: "Jabal Samhan Adventure", descAr: "رحلة تسلق ومشاهدة الحياة البرية في محمية جبل سمحان الطبيعية.", descEn: "A trekking and wildlife-watching expedition in the Jabal Samhan Nature Reserve.", prices: [{ label: "بالغ", amount: "25.000" }, { label: "مجموعة خاصة", amount: "90.000" }] },
    { providerIndex: 0, nameAr: "رحلة شاطئ المغسيل", nameEn: "Mughsail Beach Trip", descAr: "زيارة إلى شاطئ المغسيل الساحر والمنافيخ البحرية الطبيعية.", descEn: "A visit to the stunning Mughsail Beach and its natural blowholes.", prices: [{ label: "بالغ", amount: "12.000" }, { label: "طفل", amount: "6.000" }] },
    { providerIndex: 0, nameAr: "كهف المرنيف", nameEn: "Al Marneef Cave", descAr: "استكشاف كهف المرنيف الطبيعي المطل على المحيط الهندي.", descEn: "Exploration of the natural Al Marneef Cave overlooking the Indian Ocean.", prices: [{ label: "بالغ", amount: "10.000" }, { label: "طفل", amount: "5.000" }] },
    { providerIndex: 0, nameAr: "عين رزات", nameEn: "Ain Razat Spring", descAr: "نزهة عائلية في حديقة عين رزات ذات الينابيع الطبيعية والمساحات الخضراء.", descEn: "A family outing at Ain Razat Park, known for its natural springs and green spaces.", prices: [{ label: "بالغ", amount: "8.000" }, { label: "طفل", amount: "4.000" }] },

    { providerIndex: 1, nameAr: "عين جرزيز", nameEn: "Ain Jarziz", descAr: "رحلة إلى ينبوع عين جرزيز الطبيعي وسط الجبال.", descEn: "A trip to the natural Ain Jarziz spring nestled in the mountains.", prices: [{ label: "بالغ", amount: "10.000" }, { label: "طفل", amount: "5.000" }] },
    { providerIndex: 1, nameAr: "سهل أتين", nameEn: "Athin Plain", descAr: "جولة سيارات دفع رباعي عبر سهل أتين الجبلي الخلاب.", descEn: "A 4x4 tour across the scenic mountainous Athin Plain.", prices: [{ label: "بالغ", amount: "20.000" }, { label: "مجموعة خاصة", amount: "75.000" }] },
    { providerIndex: 1, nameAr: "رمال الشرقية", nameEn: "Sharqiya Sands Expedition", descAr: "رحلة صحراوية بسيارات الدفع الرباعي عبر كثبان رمال الشرقية الذهبية.", descEn: "A 4x4 desert expedition across the golden dunes of Sharqiya Sands.", prices: [{ label: "بالغ", amount: "35.000" }, { label: "طفل", amount: "18.000" }, { label: "VIP خاص", amount: "120.000" }] },
    { providerIndex: 1, nameAr: "رحلة صحراوية", nameEn: "Desert Safari", descAr: "رحلة تجديف على الرمال وتجربة مخيم بدوي تقليدي.", descEn: "Dune bashing and a traditional Bedouin camp experience.", prices: [{ label: "بالغ", amount: "28.000" }, { label: "طفل", amount: "15.000" }] },
    { providerIndex: 1, nameAr: "تخييم في الصحراء", nameEn: "Desert Camping Experience", descAr: "ليلة تخييم كاملة تحت النجوم في قلب الصحراء مع عشاء تقليدي.", descEn: "A full overnight camping experience under the stars with a traditional dinner.", prices: [{ label: "فردي", amount: "40.000" }, { label: "مجموعة (٤ أشخاص)", amount: "140.000" }] },

    { providerIndex: 2, nameAr: "الغوص في الديمانيات", nameEn: "Daymaniyat Islands Diving", descAr: "رحلة غوص في محمية جزر الديمانيات الطبيعية الغنية بالشعاب المرجانية.", descEn: "A diving trip to the Daymaniyat Islands Nature Reserve, rich in coral reefs.", prices: [{ label: "غواص معتمد", amount: "45.000" }, { label: "مبتدئ (تجربة)", amount: "35.000" }] },
    { providerIndex: 2, nameAr: "مشاهدة الدلافين", nameEn: "Dolphin Watching", descAr: "رحلة بحرية صباحية لمشاهدة الدلافين في مياه خليج عمان.", descEn: "A morning boat trip to watch dolphins in the waters of the Gulf of Oman.", prices: [{ label: "بالغ", amount: "18.000" }, { label: "طفل", amount: "10.000" }] },
    { providerIndex: 2, nameAr: "مسندم - رحلة الفيوردات", nameEn: "Musandam Fjords Cruise", descAr: "رحلة بحرية بقارب تقليدي عبر فيوردات مسندم الخلابة.", descEn: "A traditional dhow cruise through the stunning fjords of Musandam.", prices: [{ label: "بالغ", amount: "22.000" }, { label: "طفل", amount: "12.000" }, { label: "قارب خاص", amount: "180.000" }] },
    { providerIndex: 2, nameAr: "رحلات بحرية", nameEn: "Sea Voyages", descAr: "رحلة إبحار مسائية على متن قارب شراعي تقليدي مع مشروبات وخفيفات.", descEn: "An evening sailing trip on a traditional dhow with refreshments.", prices: [{ label: "بالغ", amount: "20.000" }] },

    { providerIndex: 3, nameAr: "رحلة ثقافية", nameEn: "Cultural Heritage Tour", descAr: "جولة تعريفية بالتراث العماني الأصيل عبر متاحف ومواقع تاريخية مختارة.", descEn: "An introductory tour of authentic Omani heritage through selected museums and historic sites.", prices: [{ label: "بالغ", amount: "16.000" }, { label: "طفل", amount: "8.000" }] },
    { providerIndex: 3, nameAr: "الأسواق التقليدية", nameEn: "Traditional Souqs Tour", descAr: "جولة مشي في الأسواق التقليدية العمانية لاكتشاف الحرف اليدوية والبخور.", descEn: "A walking tour through traditional Omani souqs, discovering handicrafts and frankincense.", prices: [{ label: "بالغ", amount: "9.000" }] },
    { providerIndex: 3, nameAr: "القلاع والحصون", nameEn: "Omani Forts & Castles Tour", descAr: "زيارة موجهة إلى قلعة نزوى وحصون تاريخية أخرى في المنطقة الداخلية.", descEn: "A guided visit to Nizwa Fort and other historic castles in the interior region.", prices: [{ label: "بالغ", amount: "14.000" }, { label: "طفل", amount: "7.000" }] },

    { providerIndex: 4, nameAr: "الجبل الأخضر", nameEn: "Jebel Akhdar Trek", descAr: "رحلة تسلق إلى قمم الجبل الأخضر مع زيارة مدرجات الورد الشهيرة.", descEn: "A trekking trip to the peaks of Jebel Akhdar, including the famous rose terraces.", prices: [{ label: "بالغ", amount: "30.000" }, { label: "طفل", amount: "15.000" }, { label: "مرشد خاص", amount: "100.000" }] },
    { providerIndex: 4, nameAr: "الجبل شمس", nameEn: "Jebel Shams Trek", descAr: "رحلة إلى أعلى قمة في عُمان مع إطلالة على وادي غول الكبير.", descEn: "A trek to Oman's highest peak, overlooking the Grand Canyon of Wadi Ghul.", prices: [{ label: "بالغ", amount: "32.000" }, { label: "طفل", amount: "16.000" }] },
    { providerIndex: 4, nameAr: "مراقبة النجوم", nameEn: "Stargazing Experience", descAr: "أمسية مراقبة نجوم بعيدًا عن أضواء المدينة برفقة مرشد فلكي.", descEn: "An evening of stargazing far from city lights, guided by an astronomy expert.", prices: [{ label: "فردي", amount: "18.000" }, { label: "مجموعة", amount: "60.000" }] },
  ];

  const createdServices: Array<{ id: string; providerId: string; priceIds: string[] }> = [];

  for (const def of serviceDefs) {
    const provider = providers[def.providerIndex];
    if (!provider) {
      throw new Error(`Seed data error: no provider at index ${def.providerIndex}`);
    }
    const service = await prisma.service.create({
      data: {
        providerId: provider.id,
        // serviceType is descriptive only here — Experience (the CTI
        // specialization it names) is an OPTIONAL relation (Service.experience
        // is nullable), and no application query currently reads Experience
        // data, so leaving it unpopulated is a valid state, not a broken one.
        serviceType: "EXPERIENCE",
        name: bilingual(def.nameAr, def.nameEn),
        description: bilingual(def.descAr, def.descEn),
        status: "PUBLISHED",
      },
    });

    const priceIds: string[] = [];
    for (const price of def.prices) {
      const created = await prisma.price.create({
        data: {
          serviceId: service.id,
          amount: price.amount,
          currency: "OMR",
          status: "ACTIVE",
        },
      });
      priceIds.push(created.id);
    }

    createdServices.push({ id: service.id, providerId: provider.id, priceIds });
  }

  console.log(`Created ${createdServices.length} published services with ${createdServices.reduce((n, s) => n + s.priceIds.length, 0)} active prices.`);

  // ---------------------------------------------------------------
  // 4. CUSTOMER DATA
  // ---------------------------------------------------------------

  const demoUser = await prisma.user.create({
    data: {
      phoneNumber: SEED_MARKER_PHONE,
      phoneNumberVerified: true,
      status: "ACTIVE",
    },
  });

  const demoCustomer = await prisma.customer.create({
    data: { userId: demoUser.id },
  });

  const secondUser = await prisma.user.create({
    data: {
      phoneNumber: "+96890000002",
      phoneNumberVerified: true,
      status: "ACTIVE",
    },
  });

  const secondCustomer = await prisma.customer.create({
    data: { userId: secondUser.id },
  });

  console.log("Created 2 demo Users, each with a linked Customer.");

  // ---------------------------------------------------------------
  // 5. BOOKINGS (across all four statuses)
  // ---------------------------------------------------------------

  type BookingPlan = { customerId: string; serviceIndex: number; priceIndex: number; status: "CREATED" | "CONFIRMED" | "COMPLETED" | "CANCELLED" };

  const bookingPlans: BookingPlan[] = [
    { customerId: demoCustomer.id, serviceIndex: 0, priceIndex: 0, status: "COMPLETED" },
    { customerId: demoCustomer.id, serviceIndex: 7, priceIndex: 0, status: "CONFIRMED" },
    { customerId: demoCustomer.id, serviceIndex: 10, priceIndex: 0, status: "CREATED" },
    { customerId: demoCustomer.id, serviceIndex: 2, priceIndex: 0, status: "CANCELLED" },
    { customerId: secondCustomer.id, serviceIndex: 17, priceIndex: 0, status: "COMPLETED" },
    { customerId: secondCustomer.id, serviceIndex: 13, priceIndex: 0, status: "CONFIRMED" },
  ];

  const providerCommissionTier: Record<string, "TIER_10"> = {};
  for (const p of providers) providerCommissionTier[p.id] = "TIER_10";

  const createdBookings: Array<{ id: string; status: string; customerId: string; serviceId: string; providerId: string }> = [];

  for (const plan of bookingPlans) {
    const service = createdServices[plan.serviceIndex];
    if (!service) {
      throw new Error(`Seed data error: no service at index ${plan.serviceIndex}`);
    }
    const priceId = service.priceIds[plan.priceIndex];
    if (!priceId) continue;
    const price = await prisma.price.findUnique({ where: { id: priceId } });
    if (!price) continue;

    const isConfirmedOrCompleted = plan.status === "CONFIRMED" || plan.status === "COMPLETED";

    const booking = await prisma.booking.create({
      data: {
        customerId: plan.customerId,
        serviceId: service.id,
        providerId: service.providerId,
        status: plan.status,
        priceSnapshotAmount: price.amount,
        priceSnapshotCurrency: price.currency,
        // Commission snapshot only set once a booking is CONFIRMED/COMPLETED,
        // mirroring the schema comment ("snapshot at confirmation") —
        // amount computed from the provider's real seeded Commission (10%),
        // not an arbitrary number.
        commissionSnapshotTier: isConfirmedOrCompleted ? providerCommissionTier[service.providerId] : null,
        commissionSnapshotAmount: isConfirmedOrCompleted
          ? (Number(price.amount.toString()) * 0.1).toFixed(3)
          : null,
        confirmedAt: isConfirmedOrCompleted ? new Date() : null,
      },
    });

    createdBookings.push({ id: booking.id, status: booking.status, customerId: booking.customerId, serviceId: booking.serviceId, providerId: booking.providerId });
  }

  console.log(`Created ${createdBookings.length} bookings across CREATED/CONFIRMED/COMPLETED/CANCELLED statuses.`);

  // ---------------------------------------------------------------
  // 6. AVAILABILITY — standalone rows only, no Booking link exists
  // ---------------------------------------------------------------

  let availabilityCount = 0;
  for (const service of createdServices.slice(0, 8)) {
    const now = Date.now();
    for (let i = 0; i < 3; i++) {
      const start = new Date(now + (i + 1) * 24 * 60 * 60 * 1000);
      const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
      await prisma.availability.create({
        data: {
          serviceId: service.id,
          startTime: start,
          endTime: end,
          state: i === 0 ? "BOOKED" : "OPEN",
        },
      });
      availabilityCount++;
    }
  }

  console.log(`Created ${availabilityCount} standalone Availability slots (not linked to Bookings — no such relation exists in the schema).`);

  // ---------------------------------------------------------------
  // 8. REVIEWS + RATINGS — only for COMPLETED bookings
  // ---------------------------------------------------------------

  const completedBookings = createdBookings.filter((b) => b.status === "COMPLETED");
  const reviewTexts = [
    "تجربة رائعة، المرشد كان محترفاً والمكان أجمل من الصور.",
    "رحلة منظمة بشكل ممتاز، أنصح بها بشدة.",
  ];

  let reviewCount = 0;
  for (const booking of completedBookings) {
    const reviewText = reviewTexts[reviewCount % reviewTexts.length] ?? reviewTexts[0]!;
    const review = await prisma.review.create({
      data: {
        bookingId: booking.id,
        customerId: booking.customerId,
        providerId: booking.providerId,
        content: reviewText,
        moderationState: "PUBLISHED",
      },
    });
    await prisma.rating.create({
      data: { reviewId: review.id, value: 5 },
    });
    reviewCount++;
  }

  console.log(`Created ${reviewCount} Reviews (with Ratings) for COMPLETED bookings.`);

  // ---------------------------------------------------------------
  // 9. NOTIFICATIONS
  // ---------------------------------------------------------------

  let notificationCount = 0;
  for (const booking of createdBookings.filter((b) => b.customerId === demoCustomer.id)) {
    await prisma.notification.create({
      data: {
        userId: demoUser.id,
        content: bilingual(
          `تحديث بخصوص حجزك: الحالة الحالية ${booking.status}`,
          `Update on your booking: current status ${booking.status}`
        ),
        channel: "WHATSAPP",
        status: "DELIVERED",
        causingBookingId: booking.id,
      },
    });
    notificationCount++;
  }

  console.log(`Created ${notificationCount} Notifications for the demo customer.`);

  // ---------------------------------------------------------------
  // 10. INVOICES — for COMPLETED bookings, no Payment (out of scope)
  // ---------------------------------------------------------------

  let invoiceCount = 0;
  for (const booking of completedBookings) {
    const fullBooking = await prisma.booking.findUnique({ where: { id: booking.id } });
    if (!fullBooking) continue;

    const invoiceNumber = `BARQ-SEED-${booking.id.slice(0, 8).toUpperCase()}`;
    const invoiceContent = bilingual(
      `فاتورة حجز بقيمة ${fullBooking.priceSnapshotAmount} ${fullBooking.priceSnapshotCurrency}`,
      `Booking invoice for ${fullBooking.priceSnapshotAmount} ${fullBooking.priceSnapshotCurrency}`
    );

    await prisma.invoice.upsert({
      where: { invoiceNumber },
      update: {
        bookingId: booking.id,
        content: invoiceContent,
        status: "ISSUED",
      },
      create: {
        bookingId: booking.id,
        invoiceNumber,
        content: invoiceContent,
        status: "ISSUED",
        issuedAt: new Date(),
      },
    });
    invoiceCount++;
  }

  console.log(`Created ${invoiceCount} Invoices for COMPLETED bookings (no Payment linked — out of scope this sprint).`);

  console.log("\nSeed complete.");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
