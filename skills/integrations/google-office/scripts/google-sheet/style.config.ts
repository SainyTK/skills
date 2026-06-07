// Google Sheet formal style configuration.
// Edit this file to restyle all google-sheet scripts uniformly.

export type RgbColor = { red: number; green: number; blue: number };

export function rgb(hex: string): RgbColor {
  const n = parseInt(hex.replace('#', ''), 16);
  return {
    red:   ((n >> 16) & 0xff) / 255,
    green: ((n >>  8) & 0xff) / 255,
    blue:  ( n        & 0xff) / 255,
  };
}

// ── Fonts ─────────────────────────────────────────────────────────────────────
export const SheetFonts = {
  title:  'Poppins',
  header: 'Poppins',
  body:   'Inter',
} as const;

// ── Colour palette ────────────────────────────────────────────────────────────
export const SheetColors = {
  titleBg:     rgb('#0f2060'),  // deep navy   — merged title row background
  titleText:   rgb('#ffffff'),
  headerBg:    rgb('#163872'),  // navy blue   — column header row background
  headerText:  rgb('#ffffff'),
  dataWhite:   rgb('#ffffff'),  // data rows   — even rows
  dataAlt:     rgb('#eef2fa'),  // data rows   — odd rows (very light blue)
  borderOuter: rgb('#163872'),  // outer border: dark blue
  borderInner: rgb('#c8d4e8'),  // inner grid:  blue-grey
  bodyText:    rgb('#1a1a1a'),
  mutedText:   rgb('#666666'),
} as const;

// ── Font sizes (integer pt — Sheets API requirement) ──────────────────────────
export const SheetSizes = {
  title:  14,
  header: 11,
  body:   10,
} as const;

// ── Row heights (px) ──────────────────────────────────────────────────────────
export const SheetRowHeights = {
  title:  48,
  header: 36,
  data:   28,
} as const;

// ── Column widths (px) — applied left-to-right ────────────────────────────────
// First column is treated as the "label" column; rest use the default width.
// Override per-script when you know the column content type.
export const SheetColumnWidths = {
  label:  200,   // first / label column
  default: 150,  // standard columns
  narrow: 100,   // number-only columns
  wide:   280,   // note / description columns
} as const;

// ── Frozen rows ───────────────────────────────────────────────────────────────
export const SheetFrozenRows = {
  withTitleRow:    2,  // title row + header row
  withoutTitleRow: 1,  // header row only
} as const;
