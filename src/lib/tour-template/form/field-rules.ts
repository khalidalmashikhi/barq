import type { TourFieldRule } from "../get-tour-template-config";
import type { TourFieldKey } from "../field-registry";

// Pure lookups over the effective field-rule set (TOUR-2). getTourFieldRules()
// already returns every KNOWN registry key (unknown DB keys dropped) with its
// effective visible/required/order — so these helpers just read that. A hard
// server invariant (package -> vehicle) is NEVER expressed as a field rule, so no
// rule here can relax one.

export function findFieldRule(rules: readonly TourFieldRule[], key: TourFieldKey): TourFieldRule | undefined {
  return rules.find((rule) => rule.key === key);
}

export function isFieldVisible(rules: readonly TourFieldRule[], key: TourFieldKey): boolean {
  const rule = findFieldRule(rules, key);
  return rule ? rule.visible : true; // absent rule -> visible by default
}

export function isFieldRequired(rules: readonly TourFieldRule[], key: TourFieldKey): boolean {
  const rule = findFieldRule(rules, key);
  return rule ? rule.required : false; // absent rule -> optional by default
}

// The visible field keys in effective order (rules arrive pre-sorted by the reader).
export function visibleFieldKeys(rules: readonly TourFieldRule[]): TourFieldKey[] {
  return rules.filter((rule) => rule.visible).map((rule) => rule.key);
}
