import { describe, it, expect, vi, beforeEach } from "vitest";
import { Archive } from "lucide-react";

// Admin action UX polish (§6) — ConfirmActionDialog gates a destructive action behind an
// explicit confirmation. This proves the WIRING without a DOM renderer (the project has no
// @testing-library): the SAME server action is what the dialog's form submits (so RBAC and
// business rules are untouched), Cancel closes without submitting, and the trigger opens the
// dialog. The component uses only useState, which we mock to drive open/closed.

let openState = false;
const setOpen = vi.fn();
vi.mock("react", async (orig) => {
  const actual = await orig<typeof import("react")>();
  return { ...actual, useState: () => [openState, setOpen] };
});

// useFormStatus is only reached when the (unexpanded) ConfirmButton renders; stub it safely.
vi.mock("react-dom", async (orig) => {
  const actual = await orig<typeof import("react-dom")>();
  return { ...actual, useFormStatus: () => ({ pending: false }) };
});

const { ConfirmActionDialog } = await import("./confirm-action-dialog");

type El = { type: unknown; props: Record<string, unknown> };
function flatten(node: unknown, acc: El[] = []): El[] {
  if (!node || typeof node !== "object") return acc;
  if (Array.isArray(node)) {
    node.forEach((n) => flatten(n, acc));
    return acc;
  }
  const el = node as El;
  if ("props" in el) {
    acc.push(el);
    flatten(el.props?.children, acc);
  }
  return acc;
}

const action = vi.fn();
const baseProps = {
  action,
  triggerLabel: "Archive provider",
  triggerIcon: <Archive size={14} />,
  title: "Archive this provider?",
  description: "The provider will be removed from active listings.",
  confirmLabel: "Archive provider",
  cancelLabel: "Cancel",
  confirmVariant: "danger" as const,
};

beforeEach(() => {
  openState = false;
  setOpen.mockReset();
  action.mockReset();
});

describe("ConfirmActionDialog", () => {
  it("renders a labelled trigger (icon + text, never icon-only) and does NOT fire the action on render", () => {
    const tree = ConfirmActionDialog(baseProps);
    const els = flatten(tree);
    const trigger = els.find((e) => e.type === "button" && e.props.type === "button");
    expect(trigger).toBeTruthy();
    expect(flatten(trigger!.props.children).some((e) => e.type === Archive)).toBe(true);
    // action must not run just by rendering
    expect(action).not.toHaveBeenCalled();
  });

  it("opens the dialog when the trigger is activated", () => {
    const tree = ConfirmActionDialog(baseProps);
    const trigger = flatten(tree).find((e) => e.type === "button" && e.props.type === "button")!;
    (trigger.props.onClick as () => void)();
    expect(setOpen).toHaveBeenCalledWith(true);
  });

  it("when open, the dialog carries the title/description and its form submits the SAME server action", () => {
    openState = true;
    const tree = ConfirmActionDialog(baseProps);
    const els = flatten(tree);
    const dialog = els.find((e) => typeof e.type === "function" && e.props.title === "Archive this provider?");
    expect(dialog).toBeTruthy();
    expect(dialog!.props.description).toBe("The provider will be removed from active listings.");
    expect(dialog!.props.open).toBe(true);
    const form = flatten(dialog!.props.children).find((e) => e.type === "form");
    expect(form).toBeTruthy();
    expect(form!.props.action).toBe(action); // the unchanged authoritative action
  });

  it("Cancel closes without invoking the action (no mutation)", () => {
    openState = true;
    const tree = ConfirmActionDialog(baseProps);
    const buttons = flatten(tree).filter((e) => e.type === "button" && e.props.type === "button");
    // The Cancel button renders the cancelLabel string directly as its only child.
    const cancel = buttons.find((b) => b.props.children === "Cancel");
    expect(cancel).toBeTruthy();
    (cancel!.props.onClick as () => void)();
    expect(setOpen).toHaveBeenCalledWith(false);
    expect(action).not.toHaveBeenCalled();
  });
});
