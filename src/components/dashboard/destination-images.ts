// Destination image path manifest — extracted from destination-image.tsx
// (Phase F.1). That file is "use client" (DestinationImage needs an
// onError handler); a plain data constant exported from a "use client"
// module does not safely cross the Server Component boundary — Next.js
// treats the whole module as a client reference on the server side, so
// a Server Component importing DESTINATION_IMAGES from there received
// `undefined` for every value (confirmed live: Next Image's own
// "Image is missing required 'src' property" error, reproducible on a
// fresh load, not a dev-only artifact). Moving the plain data here (no
// "use client") fixes it for both the original client consumer and any
// future Server Component that needs these paths.
//
// *** REAL PHOTOGRAPHY IS NOT INCLUDED — NONE EXISTS IN THIS SANDBOX ***
// See destination-image.tsx's own comment for the full explanation.
//
// Phase 3 Wave 1 fix: the paths below deliberately point at
// public/images/real/ — a directory that does not exist yet — rather
// than the flat public/images/ directory. The 5 files that used to
// live there (salalah.jpg, jebel-akhdar.jpg, wadi-darbat.jpg,
// sharqiya-sands.jpg, musandam.jpg) are confirmed byte-identical
// (18,747 bytes each) leftover placeholder PNGs mislabeled as .jpg —
// not real photography — and because they DO successfully load (no
// 404), DestinationImage's onError fallback never triggered for them,
// so 4 of 6 destination cards were silently showing a leftover
// off-brand purple graphic instead of the new honest BrandPattern
// fallback. Pointing at a not-yet-existing path guarantees the
// fallback renders everywhere until a real photo is actually placed at
// the exact path below — at which point it appears with zero code
// changes, same mechanism as before. The 5 old files are left in place
// (not deleted) and are flagged as deletion candidates in this wave's
// report, not removed without approval.

export const DESTINATION_IMAGES = {
  muscat: "/images/real/muscat.jpg",
  salalah: "/images/real/salalah.jpg",
  jebelAkhdar: "/images/real/jebel-akhdar.jpg",
  wadiDarbat: "/images/real/wadi-darbat.jpg",
  sharqiyaSands: "/images/real/sharqiya-sands.jpg",
  musandam: "/images/real/musandam.jpg",
  misfatAlAbriyeen: "/images/real/misfat-al-abriyeen.jpg",
  nizwa: "/images/real/nizwa.jpg",
  mughsail: "/images/real/mughsail.jpg",
  rasAlJinz: "/images/real/ras-al-jinz.jpg",
} as const;
