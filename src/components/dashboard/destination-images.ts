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
// BUG-5 remediation (remediation gate): every value is now the EMPTY STRING
// because no real destination photography exists in this project yet. An earlier
// phase pointed these at public/images/real/*.jpg — a directory that does not
// exist — to force DestinationImage's on-brand BrandPattern fallback; but a
// missing path still made <Image> fire a request that 404'd (visible as broken
// image requests in the network log) before the onError fallback took over.
// DestinationImage now renders the SAME BrandPattern fallback directly when the
// src is empty, so with these empty values there are zero broken image requests
// and the on-brand fallback shows everywhere.
//
// The 5 pre-existing files at the FLAT public/images/*.jpg (salalah, jebel-akhdar,
// wadi-darbat, sharqiya-sands, musandam) are confirmed byte-IDENTICAL placeholder
// PNGs mislabeled as .jpg — not real, distinct photography — so they are
// deliberately NOT used (they would show one off-brand image for every
// destination).
//
// TO ADD A REAL PHOTO LATER: drop the file at public/images/real/<name>.jpg and
// set this key back to "/images/real/<name>.jpg" — it then renders with zero
// other code changes (the onError fallback still protects against a broken file).
// Intended future filenames: muscat.jpg, salalah.jpg, jebel-akhdar.jpg,
// wadi-darbat.jpg, sharqiya-sands.jpg, musandam.jpg, misfat-al-abriyeen.jpg,
// nizwa.jpg, mughsail.jpg, ras-al-jinz.jpg.

export const DESTINATION_IMAGES = {
  muscat: "",
  salalah: "",
  jebelAkhdar: "",
  wadiDarbat: "",
  sharqiyaSands: "",
  musandam: "",
  misfatAlAbriyeen: "",
  nizwa: "",
  mughsail: "",
  rasAlJinz: "",
} as const;
