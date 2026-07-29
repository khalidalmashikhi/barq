import { prisma } from "../src/lib/db";

// Admin bootstrap — Phase 1.1 (Core Business Platform) prerequisite.
//
// WHY THIS EXISTS: flagged by Phase 0.2's Technical Debt review — no code
// path anywhere creates an Admin row (every BARQ User is auto-provisioned as
// a Customer on first sign-in, per resolveBarqUser(); Provider is an
// explicit self-service upgrade via apply-as-provider.ts; Admin has no
// equivalent). Phase 1.1 is the first phase that makes a second admin
// capability (Category management) meaningfully necessary to reach, so this
// closes the gap as this phase's own prerequisite, not a standalone phase.
//
// DELIBERATELY A CLI SCRIPT, NOT A ROUTE OR SERVER ACTION: an HTTP-reachable
// "become admin" endpoint of any kind is exactly the attack surface a
// bootstrap mechanism must not open. This only runs from a trusted operator's
// own shell, against the same DATABASE_URL the app itself uses.
//
// GUARD: refuses unconditionally if any Admin row already exists anywhere —
// this is a one-time bootstrap for the very first Admin, not an ongoing
// provisioning tool. Promoting additional admins after the first one exists
// is intentionally left to a future, explicitly-admin-authored capability
// (e.g. an Admin inviting another Admin) — not to this script, and not to
// direct DB access either, once a real workflow exists.
//
// PRECONDITION: the target phone number must already belong to a real BARQ
// User (i.e., that person has signed in at least once via the normal OTP
// flow, which auto-provisions a User + Customer row). This script never
// creates a User from scratch — it only promotes an existing one — so it
// can never be used to conjure an identity that was never verified through
// real authentication.
//
// USAGE: npx tsx scripts/bootstrap-admin.ts +968XXXXXXXX

async function main() {
  const phoneNumber = process.argv[2];

  if (!phoneNumber) {
    console.error("Usage: npx tsx scripts/bootstrap-admin.ts <phoneNumber>");
    process.exitCode = 1;
    return;
  }

  const existingAdminCount = await prisma.admin.count();
  if (existingAdminCount > 0) {
    console.error(
      `Refusing to run: ${existingAdminCount} Admin row(s) already exist. ` +
        "This script is a one-time bootstrap for the very first Admin only."
    );
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findUnique({ where: { phoneNumber } });

  if (!user) {
    console.error(
      `No User found for phone number ${phoneNumber}. That person must sign in at least once ` +
        "via the normal OTP flow before they can be promoted to Admin."
    );
    process.exitCode = 1;
    return;
  }

  const existingAdminForUser = await prisma.admin.findUnique({ where: { userId: user.id } });
  if (existingAdminForUser) {
    console.error(`User ${user.id} is already an Admin.`);
    process.exitCode = 1;
    return;
  }

  const admin = await prisma.admin.create({ data: { userId: user.id } });

  console.log(`Created the first Admin: id=${admin.id}, userId=${user.id}, phoneNumber=${phoneNumber}`);
}

main()
  .catch((error) => {
    console.error("bootstrap-admin failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
