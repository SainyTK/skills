// Shared helpers for Google Sheet scripts.
// Import this module instead of duplicating logic across scripts.
import { api } from '../scripts/lib';
import {
  SheetColors, SheetColumnWidths, SheetFonts, SheetFrozenRows,
  SheetRowHeights, SheetSizes,
} from './style.config';

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SheetStyleOptions {
  /** Which tab to style (defaults to the first sheet). */
  sheetName?: string;
  /**
   * Whether row 0 is a merged document title row (default: true).
   * Set false when your data starts directly with a column-header row.
   */
  hasTitleRow?: boolean;
}

interface SheetMeta {
  sheetId:        number;
  title:          string;
  gridRows:       number;
  gridCols:       number;
  bandedRangeIds: number[];
}

// ── Low-level helpers ─────────────────────────────────────────────────────────

export async function batchUpdate(email: string, spreadsheetId: string, requests: any[]) {
  return api(`${SHEETS}/${encodeURIComponent(spreadsheetId)}:batchUpdate`, email, {
    method: 'POST',
    body: { requests },
  });
}

// ── Sheet metadata ────────────────────────────────────────────────────────────

async function getSheetMeta(
  email: string,
  spreadsheetId: string,
  sheetName?: string,
): Promise<SheetMeta> {
  const data = await api(`${SHEETS}/${encodeURIComponent(spreadsheetId)}`, email, {
    query: {
      fields: 'sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount)),bandedRanges(bandedRangeId))',
    },
  });
  const sheets: any[] = data.sheets || [];
  const sheet = sheetName
    ? (sheets.find(s => s.properties.title === sheetName) ?? sheets[0])
    : sheets[0];

  return {
    sheetId:        sheet.properties.sheetId,
    title:          sheet.properties.title,
    gridRows:       sheet.properties.gridProperties.rowCount,
    gridCols:       sheet.properties.gridProperties.columnCount,
    bandedRangeIds: (sheet.bandedRanges || []).map((b: any) => b.bandedRangeId),
  };
}

/** Return the actual row and column extent of data in a sheet tab. */
async function detectDataExtent(
  email: string,
  spreadsheetId: string,
  sheetTitle: string,
): Promise<{ rows: number; cols: number }> {
  try {
    const data = await api(
      `${SHEETS}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(sheetTitle)}`,
      email,
    );
    const values: any[][] = data.values || [];
    return {
      rows: values.length,
      cols: Math.max(0, ...values.map((r: any[]) => r.length)),
    };
  } catch {
    return { rows: 0, cols: 0 };
  }
}

// ── Core: apply formal style ──────────────────────────────────────────────────

/**
 * Apply the full formal style to a spreadsheet tab.
 *
 * Structure assumed:
 *   hasTitleRow = true  → row 0: merged title | row 1: column headers | rows 2+: data
 *   hasTitleRow = false → row 0: column headers | rows 1+: data
 *
 * Styling applied:
 *   - Title row merged, deep navy background, Poppins white text (if hasTitleRow)
 *   - Header row navy-blue background, Poppins white bold text
 *   - Data rows: alternating white / light-blue banding, Inter body text
 *   - Outer + inner borders
 *   - Rows frozen (title + header, or header only)
 *   - Column widths: first column wider (label), rest standard
 */
export async function applyFormalStyle(
  email: string,
  spreadsheetId: string,
  options: SheetStyleOptions = {},
): Promise<{ requestsApplied: number }> {
  const { hasTitleRow = true } = options;

  const meta   = await getSheetMeta(email, spreadsheetId, options.sheetName);
  const extent = await detectDataExtent(email, spreadsheetId, meta.title);

  const numCols = Math.max(extent.cols, 1);
  const numRows = Math.max(extent.rows, hasTitleRow ? 2 : 1);

  const titleRow  = 0;
  const headerRow = hasTitleRow ? 1 : 0;
  const dataStart = headerRow + 1;
  const { sheetId } = meta;

  const requests: any[] = [];

  // ── 1. Remove any existing banded ranges on this sheet ──────────────────
  for (const bandedRangeId of meta.bandedRangeIds) {
    requests.push({ deleteBanding: { bandedRangeId } });
  }

  // ── 2. Title row ──────────────────────────────────────────────────────────
  if (hasTitleRow) {
    requests.push({
      mergeCells: {
        range: { sheetId, startRowIndex: titleRow, endRowIndex: titleRow + 1, startColumnIndex: 0, endColumnIndex: numCols },
        mergeType: 'MERGE_ALL',
      },
    });
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: titleRow, endRowIndex: titleRow + 1, startColumnIndex: 0, endColumnIndex: numCols },
        cell: {
          userEnteredFormat: {
            backgroundColor:    SheetColors.titleBg,
            horizontalAlignment: 'CENTER',
            verticalAlignment:   'MIDDLE',
            textFormat: {
              bold:            true,
              fontSize:        SheetSizes.title,
              fontFamily:      SheetFonts.title,
              foregroundColor: SheetColors.titleText,
            },
            padding:      { top: 12, bottom: 12, left: 8, right: 8 },
            wrapStrategy: 'WRAP',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat,padding,wrapStrategy)',
      },
    });
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'ROWS', startIndex: titleRow, endIndex: titleRow + 1 },
        properties: { pixelSize: SheetRowHeights.title },
        fields: 'pixelSize',
      },
    });
  }

  // ── 3. Column header row ──────────────────────────────────────────────────
  requests.push({
    repeatCell: {
      range: { sheetId, startRowIndex: headerRow, endRowIndex: headerRow + 1, startColumnIndex: 0, endColumnIndex: numCols },
      cell: {
        userEnteredFormat: {
          backgroundColor:    SheetColors.headerBg,
          horizontalAlignment: 'CENTER',
          verticalAlignment:   'MIDDLE',
          textFormat: {
            bold:            true,
            fontSize:        SheetSizes.header,
            fontFamily:      SheetFonts.header,
            foregroundColor: SheetColors.headerText,
          },
          padding:      { top: 8, bottom: 8, left: 6, right: 6 },
          wrapStrategy: 'WRAP',
        },
      },
      fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat,padding,wrapStrategy)',
    },
  });
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: 'ROWS', startIndex: headerRow, endIndex: headerRow + 1 },
      properties: { pixelSize: SheetRowHeights.header },
      fields: 'pixelSize',
    },
  });

  // ── 4. Data rows: alternating banding + text style ────────────────────────
  if (numRows > dataStart) {
    requests.push({
      addBanding: {
        bandedRange: {
          range: { sheetId, startRowIndex: dataStart, endRowIndex: numRows, startColumnIndex: 0, endColumnIndex: numCols },
          rowProperties: {
            firstBandColor:  SheetColors.dataWhite,
            secondBandColor: SheetColors.dataAlt,
          },
        },
      },
    });
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: dataStart, endRowIndex: numRows, startColumnIndex: 0, endColumnIndex: numCols },
        cell: {
          userEnteredFormat: {
            verticalAlignment: 'MIDDLE',
            textFormat: {
              bold:            false,
              fontSize:        SheetSizes.body,
              fontFamily:      SheetFonts.body,
              foregroundColor: SheetColors.bodyText,
            },
            padding:      { top: 6, bottom: 6, left: 6, right: 6 },
            wrapStrategy: 'WRAP',
          },
        },
        fields: 'userEnteredFormat(verticalAlignment,textFormat,padding,wrapStrategy)',
      },
    });
    // Uniform row height for data rows
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'ROWS', startIndex: dataStart, endIndex: numRows },
        properties: { pixelSize: SheetRowHeights.data },
        fields: 'pixelSize',
      },
    });
  }

  // ── 5. Borders: outer medium, inner thin ─────────────────────────────────
  requests.push({
    updateBorders: {
      range: { sheetId, startRowIndex: headerRow, endRowIndex: numRows, startColumnIndex: 0, endColumnIndex: numCols },
      top:             { style: 'SOLID_MEDIUM', colorStyle: { rgbColor: SheetColors.borderOuter } },
      bottom:          { style: 'SOLID_MEDIUM', colorStyle: { rgbColor: SheetColors.borderOuter } },
      left:            { style: 'SOLID_MEDIUM', colorStyle: { rgbColor: SheetColors.borderOuter } },
      right:           { style: 'SOLID_MEDIUM', colorStyle: { rgbColor: SheetColors.borderOuter } },
      innerHorizontal: { style: 'SOLID',        colorStyle: { rgbColor: SheetColors.borderInner } },
      innerVertical:   { style: 'SOLID',        colorStyle: { rgbColor: SheetColors.borderInner } },
    },
  });

  // ── 6. Freeze rows ────────────────────────────────────────────────────────
  requests.push({
    updateSheetProperties: {
      properties: {
        sheetId,
        gridProperties: {
          frozenRowCount: hasTitleRow
            ? SheetFrozenRows.withTitleRow
            : SheetFrozenRows.withoutTitleRow,
        },
      },
      fields: 'gridProperties.frozenRowCount',
    },
  });

  // ── 7. Column widths: first column wider, rest standard ───────────────────
  for (let c = 0; c < numCols; c++) {
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: c, endIndex: c + 1 },
        properties: { pixelSize: c === 0 ? SheetColumnWidths.label : SheetColumnWidths.default },
        fields: 'pixelSize',
      },
    });
  }

  await batchUpdate(email, spreadsheetId, requests);
  return { requestsApplied: requests.length };
}
