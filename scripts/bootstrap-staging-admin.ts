import { prisma } from "../src/lib/db";

// One-off, idempotent STAGING admin bootstrap.
//
// Promotes a specific target phone number to the sole ACTIVE Admin in the
// staging environment and deactivates (never deletes) the demo admin. It is
// deliberately separate from scripts/bootstrap-admin.ts (which is the generic
// "create the very first Admin" bootstrap and refuses if any Admin exists) —
// this script is the staging-specific hand-over to a real operator identity.
//
// SAFETY / SCOPE:
//   - STAGING ONLY: refuses to run unless APP_ENV=staging (never production,
//     never local). It never touches production or main.
//   - DRY-RUN BY DEFAULT: prints the plan and changes nothing. Pass --apply to
//     execute. There is no way to mutate without --apply.
//   - IDEMPOTENT: re-running produces the same safe result (uses upsert and
//     conditional updateMany, not blind inserts/deletes).
//   - NON-DESTRUCTIVE to identity: only User.status / User.phoneNumberVerified
//     and Admin.status are touched. It never deletes the target or demo User,
//     their Better Auth identity (AuthUser), sessions, or Customer profile.
//   - The demo admin is DEACTIVATED (Admin.status = DEACTIVATED), not removed —
//     the row, the User, and everything linked to it are preserved.
//   - All mutations run inside ONE Prisma transaction.
//   - Prints only non-sensitive IDs and masked phone numbers.
//
// USAGE:
//   APP_ENV=staging npx tsx scripts/bootstrap-staging-admin.ts            # dry-run
//   APP_ENV=staging npx tsx scripts/bootstrap-staging-admin.ts --apply    # execute

const TARGET_ADMIN_PHONE = "+96898115159";
const DEMO_ADMIN_PHONE = "+96891100001";

function maskPhone(phone: string): string {
  return phone.length <= 6 ? "***" : `${phone.slice(0, 4)}***${phone.slice(-2)}`;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const mode = apply ? "APPLY" : "DRY-RUN (no changes)";

  // 1. Staging-only guard — refuse anywhere else, before any DB access.
  if (process.env.APP_ENV !== "staging") {
    console.error(
      `Refusing to run: APP_ENV must be "staging" (got "${process.env.APP_ENV ?? "unset"}"). ` +
        "This bootstrap is staging-only and never runs against production or local."
    );
    process.exitCode = 1;
    return;
  }

  // 2. Find the target User by exact normalized phone number.
  const target = await prisma.user.findUnique({
    where: { phoneNumber: TARGET_ADMIN_PHONE },
    include: { admin: true },
  });

  // 3. Fail clearly if the target User does not exist.
  if (!target) {
    console.error(
      `Target User not found for ${maskPhone(TARGET_ADMIN_PHONE)}. ` +
        "That person must sign in at least once via the normal OTP flow first — this script promotes an existing User, it never creates one."
    );
    process.exitCode = 1;
    return;
  }

  // Look up the demo admin User (may legitimately not exist — that's fine).
  const demo = await prisma.user.findUnique({
    where: { phoneNumber: DEMO_ADMIN_PHONE },
    include: { admin: true },
  });

  // Build the plan (what WOULD change) for both dry-run and apply reporting.
  const willActivateUser = target.status !== "ACTIVE";
  const willVerifyPhone = !target.phoneNumberVerified;
  const adminAction = !target.admin ? "create ACTIVE admin" : target.admin.status !== "ACTIVE" ? "reactivate admin" : "no-op (already ACTIVE)";
  const demoNeedsDeactivate = Boolean(demo?.admin && demo.admin.status === "ACTIVE");

  console.log("=== Staging admin bootstrap ===");
  console.log(`mode: ${mode}`);
  console.log(`target User: id=${target.id} phone=${maskPhone(TARGET_ADMIN_PHONE)} status=${target.status} phoneNumberVerified=${target.phoneNumberVerified}`);
  console.log(`  - User.status -> ACTIVE:            ${willActivateUser ? "CHANGE" : "already ACTIVE"}`);
  console.log(`  - User.phoneNumberVerified -> true: ${willVerifyPhone ? "CHANGE" : "already true"}`);
  console.log(`  - target Admin:                     ${adminAction}${target.admin ? ` (id=${target.admin.id})` : ""}`);
  if (demo) {
    console.log(`demo admin User: id=${demo.id} phone=${maskPhone(DEMO_ADMIN_PHONE)} admin=${demo.admin ? `${demo.admin.status} (id=${demo.admin.id})` : "none"}`);
    console.log(`  - demo Admin.status -> DEACTIVATED: ${demoNeedsDeactivate ? "CHANGE" : demo.admin ? "already DEACTIVATED" : "no admin — nothing to do"}`);
  } else {
    console.log(`demo admin User: not found (${maskPhone(DEMO_ADMIN_PHONE)}) — nothing to deactivate`);
  }

  if (!apply) {
    console.log("\nDRY-RUN complete. No changes were made. Re-run with --apply to execute.");
    return;
  }

  // 8. All mutations inside a single transaction. Every operation is
  //    idempotent, so a second --apply run converges to the same state.
  const result = await prisma.$transaction(async (tx) => {
    // 4. Target User -> ACTIVE + phoneNumberVerified=true (idempotent).
    const user = await tx.user.update({
      where: { id: target.id },
      data: { status: "ACTIVE", phoneNumberVerified: true },
      select: { id: true, status: true, phoneNumberVerified: true },
    });

    // 5. Ensure exactly one ACTIVE Admin for the target. Admin.userId is
    //    unique, so upsert guarantees exactly one row, set ACTIVE.
    const admin = await tx.admin.upsert({
      where: { userId: target.id },
      create: { userId: target.id, status: "ACTIVE" },
      update: { status: "ACTIVE" },
      select: { id: true, status: true },
    });

    // 6. Deactivate the demo admin's access — only its Admin.status, and
    //    only if currently ACTIVE (idempotent). Never deletes anything.
    let demoDeactivated = 0;
    if (demo) {
      const res = await tx.admin.updateMany({
        where: { userId: demo.id, status: "ACTIVE" },
        data: { status: "DEACTIVATED" },
      });
      demoDeactivated = res.count;
    }

    return { user, admin, demoDeactivated };
  });

  console.log("\n=== APPLIED (single transaction) ===");
  console.log(`target User:  id=${result.user.id} status=${result.user.status} phoneNumberVerified=${result.user.phoneNumberVerified}`);
  console.log(`target Admin: id=${result.admin.id} status=${result.admin.status}`);
  console.log(`demo Admin deactivated: ${result.demoDeactivated} row(s)`);
  console.log("Success. Idempotent — re-running produces the same result.");
}

main()
  .catch((error) => {
    console.error("bootstrap-staging-admin failed:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
