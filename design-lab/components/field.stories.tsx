import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Canvas, Specimen } from "../canvas";
import { SYNTHETIC, useLabCopy } from "../copy";
import { Field } from "./field";

const meta = {
  title: "Components/Form Field",
  component: Field,
  tags: ["states", "text-scale"],
  args: { label: "" },
} satisfies Meta<typeof Field>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: function Render() {
    const c = useLabCopy();
    return (
      <Canvas>
        <Field label={c.fieldMakeModel} defaultValue={c.valueMakeModel} />
      </Canvas>
    );
  },
};

export const States: Story = {
  render: function Render() {
    const c = useLabCopy();
    return (
      <Canvas>
        <Specimen label="default (empty, required)">
          <Field label={c.fieldMakeModel} required placeholder="…" />
        </Specimen>
        <Specimen label="hover">
          <Field label={c.fieldMakeModel} defaultValue={c.valueMakeModel} forceState="hover" />
        </Specimen>
        <Specimen label="focus">
          <Field label={c.fieldMakeModel} defaultValue={c.valueMakeModel} forceState="focus" />
        </Specimen>
        <Specimen label="needs review (suggested from the document)">
          <Field label={c.fieldYear} defaultValue={SYNTHETIC.year} valueDir="ltr" inputMode="numeric" review={c.fromDocument} />
        </Specimen>
        <Specimen label="error">
          <Field label={c.fieldSeats} required inputMode="numeric" valueDir="ltr" error={c.seatsNotRead} />
        </Specimen>
        <Specimen label="disabled">
          <Field label={c.fieldPlate} defaultValue={SYNTHETIC.plateMasked} valueDir="ltr" disabled />
        </Specimen>
      </Canvas>
    );
  },
};

export const Error: Story = {
  render: function Render() {
    const c = useLabCopy();
    return (
      <Canvas>
        <Field label={c.fieldSeats} required inputMode="numeric" valueDir="ltr" error={c.seatsNotRead} />
      </Canvas>
    );
  },
};
