import { ImageResponse } from "next/og";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getProviderProfile } from "@/lib/services/get-provider-profile";

// Dynamic Open Graph image — Growth Foundations phase. One per real,
// APPROVED+visible provider, generated on demand (no generateStaticParams
// — never pre-built for every provider at `next build` time). Reuses
// the existing logo asset and brand colors (tailwind.config.ts) only —
// no AI image generation, no remote fetch during render: the logo PNG
// is read once from the local filesystem at module load and embedded
// as a base64 data URI. Deliberately does NOT attempt to embed
// provider.logoUrl (a provider-supplied external URL) — that would be
// exactly the "fetch a remote asset during rendering" this phase's own
// scope forbids.

export const alt = "BARQ";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const logoDataUri = `data:image/png;base64,${readFileSync(join(process.cwd(), "public", "Barqlogo.png")).toString("base64")}`;

type Props = { params: Promise<{ idOrSlug: string }> };

export default async function Image({ params }: Props) {
  const { idOrSlug } = await params;
  const provider = await getProviderProfile(idOrSlug);
  const name = provider?.name ?? "BARQ";
  const city = provider?.city ?? "";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 64,
          backgroundColor: "#F7F8FA",
          fontFamily: "sans-serif",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- next/og's ImageResponse renderer requires a plain <img>, not next/image. */}
        <img src={logoDataUri} width={72} height={72} alt="" style={{ borderRadius: 16 }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <span style={{ fontSize: 56, fontWeight: 700, color: "#0F172A", lineHeight: 1.15 }}>{name}</span>
          {city && <span style={{ fontSize: 28, color: "#094367" }}>{city}</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 10, height: 10, borderRadius: 9999, backgroundColor: "#1ABBAF" }} />
          <span style={{ fontSize: 24, fontWeight: 600, color: "#094367" }}>BARQ</span>
        </div>
      </div>
    ),
    { ...size }
  );
}
