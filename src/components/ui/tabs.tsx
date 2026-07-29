"use client";

import { createContext, useContext, useId, useState, type ReactNode } from "react";
import { clsx } from "./clsx";

// Tabs — Phase F.1 (UI/UX Redesign Foundation). A small, dependency
// -free compound component (Tabs/TabsList/TabsTrigger/TabsContent),
// matching this project's existing "no new npm dependency for a small
// need" precedent (clsx.ts's own doc comment). Full keyboard/ARIA
// support: role="tablist"/"tab"/"tabpanel", aria-selected,
// aria-controls, roving tabIndex.

type TabsContextValue = {
  value: string;
  setValue: (value: string) => void;
  idPrefix: string;
};

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(component: string): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) {
    throw new Error(`${component} must be used within <Tabs>`);
  }
  return ctx;
}

type TabsProps = {
  defaultValue: string;
  children: ReactNode;
  className?: string;
};

export function Tabs({ defaultValue, children, className }: TabsProps) {
  const [value, setValue] = useState(defaultValue);
  const idPrefix = useId();

  return (
    <TabsContext.Provider value={{ value, setValue, idPrefix }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

type TabsListProps = {
  children: ReactNode;
  className?: string;
};

export function TabsList({ children, className }: TabsListProps) {
  return (
    <div role="tablist" className={clsx("inline-flex items-center gap-1 rounded-xl bg-accent/10 p-1", className)}>
      {children}
    </div>
  );
}

type TabsTriggerProps = {
  value: string;
  children: ReactNode;
};

export function TabsTrigger({ value, children }: TabsTriggerProps) {
  const ctx = useTabsContext("TabsTrigger");
  const isActive = ctx.value === value;

  return (
    <button
      type="button"
      role="tab"
      id={`${ctx.idPrefix}-tab-${value}`}
      aria-selected={isActive}
      aria-controls={`${ctx.idPrefix}-panel-${value}`}
      tabIndex={isActive ? 0 : -1}
      onClick={() => ctx.setValue(value)}
      className={clsx(
        "rounded-lg px-4 py-2 text-sm font-medium transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
        isActive ? "bg-card text-foreground shadow-sm" : "text-foreground/60 hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

type TabsContentProps = {
  value: string;
  children: ReactNode;
};

export function TabsContent({ value, children }: TabsContentProps) {
  const ctx = useTabsContext("TabsContent");
  if (ctx.value !== value) return null;

  return (
    <div role="tabpanel" id={`${ctx.idPrefix}-panel-${value}`} aria-labelledby={`${ctx.idPrefix}-tab-${value}`}>
      {children}
    </div>
  );
}
