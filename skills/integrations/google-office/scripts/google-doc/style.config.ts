// Google Doc formal style configuration.
// Edit this file to restyle all google-doc scripts uniformly.
// All colours are expressed as hex strings; sizes in points.

export type RgbColor = { red: number; green: number; blue: number };
export type Pt       = { magnitude: number; unit: 'PT' };

export function pt(magnitude: number): Pt { return { magnitude, unit: 'PT' }; }

export function rgb(hex: string): RgbColor {
  const n = parseInt(hex.replace('#', ''), 16);
  return {
    red:   ((n >> 16) & 0xff) / 255,
    green: ((n >>  8) & 0xff) / 255,
    blue:  ( n        & 0xff) / 255,
  };
}

// ── Fonts ─────────────────────────────────────────────────────────────────────
// Poppins for display (title, headings); Inter for reading (body, tables).
export const Fonts = {
  title:   'Poppins',
  heading: 'Poppins',
  body:    'Inter',
  table:   'Inter',
  caption: 'Inter',
} as const;

// ── Colour palette ────────────────────────────────────────────────────────────
export const Colors = {
  title:           rgb('#0f2060'),  // deep navy — doc title
  heading:         rgb('#163872'),  // navy-blue — section headings
  headingBorder:   rgb('#2c5fa8'),  // medium blue — heading underline
  tableHeaderBg:   rgb('#163872'),  // same as heading
  tableHeaderText: rgb('#ffffff'),  // white
  tableRowAlt:     rgb('#f0f4fb'),  // very light blue tint — alternating rows
  tableBorder:     rgb('#c8d4e8'),  // blue-grey — cell borders
  body:            rgb('#1a1a1a'),  // near-black
  muted:           rgb('#666666'),  // grey — date / captions
  accent:          rgb('#2c5fa8'),  // blue — used for links or highlights
} as const;

// ── Font sizes (pt) ───────────────────────────────────────────────────────────
export const Sizes = {
  title:    22,
  heading1: 16,
  heading2: 14,
  heading3: 12,
  body:     11,
  table:    10.5,
  caption:  10,
} as const;

// ── Spacing (pt) ──────────────────────────────────────────────────────────────
export const Spacing = {
  paragraphBelow:   6,
  headingAbove:    18,
  headingBelow:     6,
  lineSpacing:    120,   // 120% = 1.2× line height
  tableLineSpacing: 110,
  tablePadding:      5,  // cell padding on each side
} as const;

// ── Page margins (pt; 1 inch = 72 pt) ─────────────────────────────────────────
export const Margins = {
  top:    72,
  bottom: 72,
  left:   72,
  right:  72,
} as const;
