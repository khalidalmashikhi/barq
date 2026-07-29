import "server-only";
import { prisma } from "@/lib/db";

// Platform stats — Phase F.1 (UI/UX Redesign Foundation), landing
// page "BARQ in Numbers" section. Real counts, not fabricated
// marketing numbers — "Trust through clean design" (Product Vision)
// extends to never showing a made-up statistic. Read-only; does not
// touch Booking/Contract/Signature engines or any protected module.

export type PlatformStats = {
  publishedServicesCount: number;
  approvedProvidersCount: number;
};

export async function getPlatformStats(): Promise<PlatformStats> {
  const [publishedServicesCount, approvedProvidersCount] = await Promise.all([
    prisma.service.count({ where: { status: "PUBLISHED" } }),
    prisma.provider.count({ where: { status: "APPROVED" } }),
  ]);

  return { publishedServicesCount, approvedProvidersCount };
}
