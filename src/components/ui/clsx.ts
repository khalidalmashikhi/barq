// Minimal className joiner — Visual Identity Sprint.
//
// Deliberately not the npm `clsx` or `tailwind-merge` packages: this
// project's dependency list is already fixed by TECH_STACK.md, and this
// need is small enough not to justify adding a new one. Filters out
// falsy values only — does not deduplicate conflicting Tailwind
// classes, unlike `tailwind-merge`. If component composition ever needs
// real conflict resolution (e.g. two different padding classes merging
// unpredictably), that's the signal to revisit this decision, not a
// silent limitation to work around ad hoc.

export function clsx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
