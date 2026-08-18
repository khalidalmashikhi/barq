import { describe, it, expect } from "vitest";
import { isFieldVisible, isFieldRequired, visibleFieldKeys } from "./field-rules";
import type { TourFieldRule } from "../get-tour-template-config";

const rules: TourFieldRule[] = [
  { key: "meetingPoint", visible: true, required: true, sortOrder: 0, label: null, helpText: null },
  { key: "maxGuests", visible: true, required: false, sortOrder: 1, label: null, helpText: null },
  { key: "vehicleYear", visible: false, required: false, sortOrder: 2, label: null, helpText: null },
];

describe("field-rule helpers", () => {
  it("isFieldVisible reflects the effective rule", () => {
    expect(isFieldVisible(rules, "meetingPoint")).toBe(true);
    expect(isFieldVisible(rules, "vehicleYear")).toBe(false); // admin hid it
  });

  it("isFieldRequired reflects a safe required toggle", () => {
    expect(isFieldRequired(rules, "meetingPoint")).toBe(true);
    expect(isFieldRequired(rules, "maxGuests")).toBe(false);
  });

  it("visibleFieldKeys returns only visible keys in effective order", () => {
    expect(visibleFieldKeys(rules)).toEqual(["meetingPoint", "maxGuests"]);
  });

  it("defaults to visible/optional for a key with no rule row", () => {
    expect(isFieldVisible([], "duration")).toBe(true);
    expect(isFieldRequired([], "duration")).toBe(false);
  });
});
