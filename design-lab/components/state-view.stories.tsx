import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useTranslations } from "next-intl";
import { Canvas } from "../canvas";
import { useLabCopy } from "../copy";
import { Button } from "./button";
import { StateView } from "./state-view";

const meta = { title: "Components/States", component: StateView, tags: ["text-scale"], args: { kind: "loading", title: "" } } satisfies Meta<typeof StateView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  render: function Render() {
    const t = useTranslations("trips");
    return (
      <Canvas>
        <StateView kind="loading" title={t("generating")} body={t("generatingHint")} />
      </Canvas>
    );
  },
};

export const Empty: Story = {
  render: function Render() {
    const t = useTranslations("trips");
    const c = useLabCopy();
    return (
      <Canvas>
        <StateView kind="empty" title={c.noServicesTitle} body={t("planNoServices")} action={<Button fullWidth>{c.otherRegion}</Button>} secondaryAction={<Button variant="tertiary">{c.showGeneral}</Button>} />
      </Canvas>
    );
  },
};

export const Error: Story = {
  render: function Render() {
    const t = useTranslations("trips");
    return (
      <Canvas>
        <StateView kind="error" title={t("errorRateLimited")} action={<Button variant="secondary" fullWidth>{t("retry")}</Button>} />
      </Canvas>
    );
  },
};

export const Success: Story = {
  render: function Render() {
    const c = useLabCopy();
    return (
      <Canvas>
        <StateView kind="success" title={c.createdTitle} body={c.createdBody} action={<Button fullWidth>{c.viewVehicle}</Button>} />
      </Canvas>
    );
  },
};
