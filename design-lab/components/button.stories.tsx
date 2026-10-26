import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { PencilLine, ScanLine } from "lucide-react";
import { Canvas, Specimen } from "../canvas";
import { useLabCopy } from "../copy";
import { Button } from "./button";

const meta = {
  title: "Components/Button",
  component: Button,
  tags: ["states", "text-scale"],
  args: { children: "", variant: "primary" },
} satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: function Render() {
    const c = useLabCopy();
    return (
      <Canvas>
        <Button fullWidth icon={<ScanLine size={20} aria-hidden />}>
          {c.consentRead}
        </Button>
      </Canvas>
    );
  },
};

export const Variants: Story = {
  render: function Render() {
    const c = useLabCopy();
    return (
      <Canvas>
        <Specimen label="primary">
          <Button fullWidth>{c.create}</Button>
        </Specimen>
        <Specimen label="secondary">
          <Button variant="secondary" fullWidth>
            {c.saveLater}
          </Button>
        </Specimen>
        <Specimen label="tertiary">
          <Button variant="tertiary" icon={<PencilLine size={18} aria-hidden />}>
            {c.startManual}
          </Button>
        </Specimen>
        <Specimen label="destructive (inside a confirm dialog only)">
          <Button variant="destructive" fullWidth>
            {c.hide}
          </Button>
        </Specimen>
        <Specimen label="small">
          <Button size="sm" variant="secondary">
            {c.edit}
          </Button>
        </Specimen>
      </Canvas>
    );
  },
};

export const States: Story = {
  render: function Render() {
    const c = useLabCopy();
    return (
      <Canvas>
        <Specimen label="default">
          <Button fullWidth>{c.create}</Button>
        </Specimen>
        <Specimen label="hover">
          <Button fullWidth forceState="hover">
            {c.create}
          </Button>
        </Specimen>
        <Specimen label="focus">
          <Button fullWidth forceState="focus">
            {c.create}
          </Button>
        </Specimen>
        <Specimen label="pressed">
          <Button fullWidth forceState="pressed">
            {c.create}
          </Button>
        </Specimen>
        <Specimen label="disabled + reason">
          <Button fullWidth disabled disabledReason={c.remaining(3)}>
            {c.create}
          </Button>
        </Specimen>
        <Specimen label="loading">
          <Button fullWidth loading loadingLabel={c.creating}>
            {c.create}
          </Button>
        </Specimen>
      </Canvas>
    );
  },
};

export const Disabled: Story = {
  render: function Render() {
    const c = useLabCopy();
    return (
      <Canvas>
        <Button fullWidth disabled disabledReason={c.remaining(3)}>
          {c.create}
        </Button>
      </Canvas>
    );
  },
};
