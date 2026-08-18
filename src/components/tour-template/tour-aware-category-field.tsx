"use client";

import { useState } from "react";
import { CategorySelector, type CategorySelectorLabels } from "@/components/categories/category-selector";
import { searchCategoryTree, getCategoryBreadcrumb, type CategoryTree } from "@/lib/categories/category-tree";
import { SmartTourGuideSection } from "./smart-tour-guide-section";
import type { GuideProfileSummary } from "@/lib/tour-template/form/guide-profile";
import type { SmartTourFormConfig } from "@/lib/tour-template/form/get-smart-tour-form-config";
import type { TourFormState } from "@/lib/tour-template/form/tour-form-state";

// Smart Tour-Guide Template — the category field that becomes tour-aware (TOUR-2).
// Same contract as CategoryField (owns the selection, emits a hidden `categoryId`
// input) but additionally renders <SmartTourGuideSection> when the SELECTED
// category is the canonical tourist-guide activity AND the provider is INDIVIDUAL
// — decided by ID equality against the server-resolved touristGuideCategoryId,
// never by label text. When the smart section is not active it is unmounted, so
// no `guidingContent` is submitted for a generic/ineligible service. The server
// (TOUR-1) re-validates regardless — this coordination is presentation only.

type Props = {
  name: string;
  tree: CategoryTree;
  defaultValue?: string | null;
  labels: CategorySelectorLabels;
  hint?: string;
  providerType: string;
  touristGuideCategoryId: string | null;
  smartConfig: SmartTourFormConfig | null;
  guideProfile: GuideProfileSummary | null;
  initialTourState: TourFormState | null;
  tourMalformed: boolean;
};

export function TourAwareCategoryField({
  name,
  tree,
  defaultValue = null,
  labels,
  hint,
  providerType,
  touristGuideCategoryId,
  smartConfig,
  guideProfile,
  initialTourState,
  tourMalformed,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(defaultValue);
  const [query, setQuery] = useState("");

  const visibleTree = searchCategoryTree(tree, query);
  const breadcrumb = selectedId ? getCategoryBreadcrumb(tree, selectedId) : [];

  const smartActive =
    providerType === "INDIVIDUAL" &&
    smartConfig !== null &&
    guideProfile !== null &&
    selectedId !== null &&
    touristGuideCategoryId !== null &&
    selectedId === touristGuideCategoryId;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <input type="hidden" name={name} value={selectedId ?? ""} />
        <CategorySelector
          tree={visibleTree}
          selectedId={selectedId}
          breadcrumb={breadcrumb}
          query={query}
          onSelect={setSelectedId}
          onQueryChange={setQuery}
          labels={labels}
        />
        {hint && <span className="text-xs text-foreground/40">{hint}</span>}
      </div>

      {smartActive && (
        <SmartTourGuideSection
          config={smartConfig}
          guideProfile={guideProfile}
          initialState={initialTourState}
          malformed={tourMalformed}
        />
      )}
    </div>
  );
}
