// Shared nav link data — Visual Identity Sprint.
//
// Single source for both desktop nav (navbar.tsx) and mobile nav
// (mobile-nav.tsx), avoiding duplicated link data (this project's
// standing "no duplicated code" rule, applied to data as much as logic).
//
// Same caveat as navbar.tsx: these routes don't exist yet.

export const navLinks = [
  { label: "التجارب", href: "/experiences" }, // Experiences
  { label: "الجولات", href: "/tours" }, // Tours
  { label: "النقل", href: "/transportation" }, // Transportation
  { label: "السائقون", href: "/drivers" }, // Drivers
  { label: "من نحن", href: "/about" }, // About
  { label: "تواصل معنا", href: "/contact" }, // Contact
];
