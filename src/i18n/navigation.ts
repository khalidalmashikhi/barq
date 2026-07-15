import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

// Locale-aware navigation primitives — BARQ Internationalization,
// Phase 0.
//
// Not consumed by any existing page/component yet, per this phase's
// explicit "do not migrate existing pages/components" scope — prepared
// here so later phases (B onward) have a single, ready-made
// replacement for the current raw next/navigation `redirect()` calls
// and next/link `<Link>` usages found across the codebase, rather than
// each phase inventing its own locale-prefixing logic ad hoc.

export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
