import { describe, it, expect, vi } from "vitest";

// Phase 3A — SlotDatePicker. Proves the calendar narrows REAL slots by day and still submits
// via the unchanged `availabilityId` radio (server booking contract untouched), that a
// single available day auto-selects, that multiple days require an explicit choice, and that
// days without slots are non-interactive. The component is hook-based and the project has no
// @testing-library, so we mock useState/useMemo and walk the returned element tree.

vi.mock("react", async (orig) => {
  const actual = await orig<typeof import("react")>();
  return {
    ...actual,
    useMemo: (fn: () => unknown) => fn(),
    useState: (init: unknown) => [typeof init === "function" ? (init as () => unknown)() : init, vi.fn()],
  };
});

const { SlotDatePicker } = await import("./slot-date-picker");

type El = { type: unknown; props: Record<string, unknown> };
function flatten(node: unknown, acc: El[] = []): El[] {
  if (!node || typeof node !== "object") return acc;
  if (Array.isArray(node)) { node.forEach((n) => flatten(n, acc)); return acc; }
  const el = node as El;
  if ("props" in el) { acc.push(el); flatten(el.props?.children, acc); }
  return acc;
}
const flattenText = (node: unknown, acc: string[] = []): string[] => {
  if (node == null) return acc;
  if (typeof node === "string" || typeof node === "number") { acc.push(String(node)); return acc; }
  if (Array.isArray(node)) { node.forEach((n) => flattenText(n, acc)); return acc; }
  if (typeof node === "object" && "props" in (node as El)) flattenText((node as El).props?.children, acc);
  return acc;
};

const labels = {
  legend: "Select a date",
  chooseDatePrompt: "Choose an available date to see the times.",
  timesHeading: "Available times",
  remainingSeats: "seats left",
  prevMonth: "Previous month",
  nextMonth: "Next month",
  todaySuffix: "Today",
};

function radios(tree: unknown) {
  return flatten(tree).filter((e) => e.type === "input" && e.props.name === "availabilityId");
}
function dayButtons(tree: unknown) {
  return flatten(tree).filter((e) => e.type === "button" && "aria-pressed" in e.props);
}

describe("SlotDatePicker", () => {
  it("a single available day auto-selects and renders its slot via the availabilityId radio", () => {
    const tree = SlotDatePicker({
      slots: [{ id: "slot-1", dayKey: "2026-09-01", timeLabel: "10:00 – 13:00", remainingSeats: 3 }],
      todayKey: "2026-08-15",
      locale: "en",
      labels,
    });
    const r = radios(tree);
    expect(r).toHaveLength(1);
    expect(r[0]!.props.value).toBe("slot-1");
    expect(r[0]!.props.defaultChecked).toBe(true);
    // the available day is a real, pressable button
    expect(dayButtons(tree).some((b) => b.props["aria-pressed"] === true)).toBe(true);
  });

  it("multiple available days do NOT auto-select — an explicit date choice is required first", () => {
    const tree = SlotDatePicker({
      slots: [
        { id: "s1", dayKey: "2026-09-01", timeLabel: "10:00 – 13:00", remainingSeats: 3 },
        { id: "s2", dayKey: "2026-09-05", timeLabel: "09:00 – 12:00", remainingSeats: 2 },
      ],
      todayKey: "2026-08-15",
      locale: "en",
      labels,
    });
    expect(radios(tree)).toHaveLength(0); // nothing submittable until a day is picked
    expect(flattenText(tree)).toContain("Choose an available date to see the times.");
    // both available days are pressable; none pressed yet
    expect(dayButtons(tree).length).toBeGreaterThanOrEqual(2);
    expect(dayButtons(tree).every((b) => b.props["aria-pressed"] === false)).toBe(true);
  });

  it("groups multiple slots on the SAME day and, once that day is the selection, shows both times", () => {
    const tree = SlotDatePicker({
      slots: [
        { id: "a", dayKey: "2026-09-02", timeLabel: "08:00 – 10:00", remainingSeats: 4 },
        { id: "b", dayKey: "2026-09-02", timeLabel: "14:00 – 16:00", remainingSeats: 4 },
      ],
      todayKey: "2026-08-15",
      locale: "en",
      labels,
    });
    // single available DAY → auto-selected → both of that day's slots render as radios
    const r = radios(tree);
    expect(r.map((x) => x.props.value).sort()).toEqual(["a", "b"]);
    expect(r.filter((x) => x.props.defaultChecked === true)).toHaveLength(1); // exactly one default
  });

  it("days with no slots are non-interactive (rendered as aria-hidden, never a button)", () => {
    const tree = SlotDatePicker({
      slots: [{ id: "slot-1", dayKey: "2026-09-10", timeLabel: "10:00 – 13:00", remainingSeats: 3 }],
      todayKey: "2026-08-15",
      locale: "en",
      labels,
    });
    // Sept has 30 days; only the 10th has a slot → exactly one pressable day button.
    expect(dayButtons(tree)).toHaveLength(1);
    // the rest of the month's day cells are non-button muted divs
    const mutedDivs = flatten(tree).filter((e) => e.type === "div" && e.props["aria-hidden"] === true);
    expect(mutedDivs.length).toBeGreaterThan(20);
  });
});
