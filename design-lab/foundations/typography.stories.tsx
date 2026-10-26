import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useLocale } from "next-intl";
import { Canvas, Specimen } from "../canvas";
import { TEXT } from "../tokens";

// Proposed type scale (rem; one scale on every viewport). Specimen text in both scripts.

const SAMPLE = {
  ar: { display: "خطط رحلتك", title: "راجع بيانات المركبة", heading: "ما يراه العملاء", body: "نص أساسي بحجم ١٨ بكسل وارتفاع سطر ١٫٧ للعربية، مريح للقراءة على الهاتف.", label: "رقم اللوحة", support: "نص مساعد أو حالة بحجم ١٦ بكسل.", caption: "اقتراح من المستند — الحد الأدنى ١٥ بكسل." },
  en: { display: "Plan your trip", title: "Review vehicle details", heading: "What customers see", body: "Body text at 18 px with comfortable leading for reading on a phone.", label: "Plate number", support: "Supporting or status text at 16 px.", caption: "Suggested from the document — 15 px minimum." },
} as const;

const SIZES = { display: "30 / Bold", title: "26 / Bold", heading: "20 / SemiBold", body: "18 / Regular", label: "17 / SemiBold", support: "16 / Regular", caption: "15 / Regular (minimum)" } as const;

const meta = { title: "Foundations/Typography", tags: ["text-scale"] } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Scale: Story = {
  render: function Render() {
    const s = useLocale() === "en" ? SAMPLE.en : SAMPLE.ar;
    return (
      <Canvas>
        {(Object.keys(SIZES) as (keyof typeof SIZES)[]).map((k) => (
          <Specimen key={k} label={`${k} · ${SIZES[k]} px`}>
            <p className={TEXT[k]}>{s[k]}</p>
          </Specimen>
        ))}
      </Canvas>
    );
  },
};

export const ArabicAndEnglish: Story = {
  name: "Arabic + English together",
  render: () => (
    <Canvas>
      <Specimen label="mixed run (RTL paragraph with LTR values)">
        <p className={TEXT.body}>
          رقم اللوحة <span dir="ltr">•••• 01</span> · سنة الصنع <span dir="ltr">2021</span> · <span dir="ltr">OMR 25 – 40</span>
        </p>
      </Specimen>
      <Specimen label="Latin specimen">
        <p dir="ltr" className={TEXT.body}>
          IBM Plex Sans — matched Latin companion of IBM Plex Sans Arabic.
        </p>
      </Specimen>
    </Canvas>
  ),
};
