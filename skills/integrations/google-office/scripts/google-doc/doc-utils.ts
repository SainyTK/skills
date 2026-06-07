// Shared helpers for Google Doc scripts.
// Import this module instead of duplicating logic across scripts.
import { api } from '../lib';
import {
  Colors, Fonts, Margins, Sizes, Spacing, pt, rgb,
  type RgbColor,
} from './style.config';

const DOCS = 'https://docs.googleapis.com/v1/documents';

// ── Low-level wrappers ────────────────────────────────────────────────────────

export async function getDoc(email: string, docId: string) {
  return api(`${DOCS}/${encodeURIComponent(docId)}`, email);
}

export async function batchUpdate(email: string, docId: string, requests: any[]) {
  return api(`${DOCS}/${encodeURIComponent(docId)}:batchUpdate`, email, {
    method: 'POST',
    body: { requests },
  });
}

// ── Element finders ────────────────────────────────────────────────────────────

/** Return the endIndex of the first paragraph containing `needle`. */
export function findEnd(content: any[], needle: string): number {
  for (const el of content) {
    if (!el.paragraph) continue;
    const t = (el.paragraph.elements || []).map((e: any) => e.textRun?.content || '').join('');
    if (t.includes(needle)) return el.endIndex;
  }
  throw new Error(`Paragraph not found: "${needle}"`);
}

/** Return the startIndex of the first paragraph containing `needle`. */
export function findStart(content: any[], needle: string): number {
  for (const el of content) {
    if (!el.paragraph) continue;
    const t = (el.paragraph.elements || []).map((e: any) => e.textRun?.content || '').join('');
    if (t.includes(needle)) return el.startIndex;
  }
  throw new Error(`Paragraph not found: "${needle}"`);
}

/** Find the first table element at or after `anchorIndex`. Falls back to the last table in doc. */
export function findTableAfter(content: any[], anchorIndex: number): any {
  for (const el of content) {
    if (el.table && el.startIndex >= anchorIndex - 3) return el;
  }
  let last: any = null;
  for (const el of content) if (el.table) last = el;
  return last;
}

// ── Styled table insertion ────────────────────────────────────────────────────

/**
 * Insert a data table at `insertIndex`, fill it with `values`, and apply
 * formal header-row styling from style.config.
 *
 * `values[0]` is treated as the header row (dark background, white bold text).
 * Remaining rows get white background with Inter body text.
 */
export async function insertStyledTable(
  email: string,
  docId: string,
  insertIndex: number,
  values: string[][],
): Promise<void> {
  const rows = values.length;
  const cols = Math.max(...values.map(r => r.length));

  // 1. Insert empty table
  await batchUpdate(email, docId, [{
    insertTable: { rows, columns: cols, location: { index: insertIndex } },
  }]);

  // 2. Re-fetch → locate the new table → read cell start positions
  let doc      = await getDoc(email, docId);
  let content  = doc.body?.content || [];
  const tbl    = findTableAfter(content, insertIndex);
  if (!tbl) throw new Error('insertStyledTable: could not locate inserted table');

  const cellStarts: number[][] = (tbl.table.tableRows || []).map((row: any) =>
    (row.tableCells || []).map((cell: any) => {
      const first = (cell.content || [])[0];
      return typeof first?.startIndex === 'number' ? first.startIndex : -1;
    }),
  );

  // 3. Fill cells in reverse order so earlier indices remain valid
  const textReqs: any[] = [];
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = cols - 1; c >= 0; c--) {
      const text = values[r]?.[c] ?? '';
      const idx  = cellStarts[r]?.[c];
      if (text && typeof idx === 'number' && idx >= 0) {
        textReqs.push({ insertText: { location: { index: idx }, text } });
      }
    }
  }
  if (textReqs.length > 0) await batchUpdate(email, docId, textReqs);

  // 4. Re-fetch → apply header/body cell styling
  doc      = await getDoc(email, docId);
  content  = doc.body?.content || [];
  const tbl2     = findTableAfter(content, insertIndex);
  const tableRows = tbl2.table.tableRows || [];
  const tableStart: number = tbl2.startIndex;

  const fmtReqs: any[] = [];
  for (let r = 0; r < tableRows.length; r++) {
    const isHeader = r === 0;
    const cells    = tableRows[r].tableCells || [];
    for (let c = 0; c < cells.length; c++) {
      const cell        = cells[c];
      const cellContent = cell.content || [];
      if (cellContent.length === 0) continue;

      const startIdx = cellContent[0].startIndex;
      const endIdx   = cellContent[cellContent.length - 1].endIndex;

      fmtReqs.push({
        updateTextStyle: {
          range: { startIndex: startIdx, endIndex: endIdx },
          textStyle: {
            bold: isHeader,
            fontSize: pt(Sizes.table),
            weightedFontFamily: { fontFamily: Fonts.table },
            foregroundColor: {
              color: { rgbColor: isHeader ? Colors.tableHeaderText : Colors.body },
            },
          },
          fields: 'bold,fontSize,weightedFontFamily,foregroundColor',
        },
      });

      fmtReqs.push({
        updateParagraphStyle: {
          range: { startIndex: startIdx, endIndex: endIdx },
          paragraphStyle: {
            alignment: 'START',
            lineSpacing: Spacing.tableLineSpacing,
          },
          fields: 'alignment,lineSpacing',
        },
      });

      fmtReqs.push({
        updateTableCellStyle: {
          tableCellStyle: {
            backgroundColor: {
              color: { rgbColor: isHeader ? Colors.tableHeaderBg : { red: 1, green: 1, blue: 1 } },
            },
            paddingTop:    pt(Spacing.tablePadding),
            paddingBottom: pt(Spacing.tablePadding),
            paddingLeft:   pt(Spacing.tablePadding + 1),
            paddingRight:  pt(Spacing.tablePadding + 1),
          },
          tableRange: {
            tableCellLocation: {
              tableStartLocation: { index: tableStart },
              rowIndex:    r,
              columnIndex: c,
            },
            rowSpan: 1, columnSpan: 1,
          },
          fields: 'backgroundColor,paddingTop,paddingBottom,paddingLeft,paddingRight',
        },
      });
    }
  }

  if (fmtReqs.length > 0) await batchUpdate(email, docId, fmtReqs);
}

// ── Image insertion ────────────────────────────────────────────────────────────

/**
 * Insert a public image URL at `insertIndex` and centre its paragraph.
 * `width` and `height` are in points (72 pt = 1 inch). Omit to use native size.
 */
export async function insertImage(
  email: string,
  docId: string,
  insertIndex: number,
  uri: string,
  width?: number,
  height?: number,
): Promise<void> {
  const req: any = { insertInlineImage: { uri, location: { index: insertIndex } } };
  if (width || height) {
    req.insertInlineImage.objectSize = {
      ...(width  ? { width:  pt(width)  } : {}),
      ...(height ? { height: pt(height) } : {}),
    };
  }
  await batchUpdate(email, docId, [req]);

  // Centre the paragraph that now holds the image
  const doc     = await getDoc(email, docId);
  const content = doc.body?.content || [];
  for (const el of content) {
    if (!el.paragraph) continue;
    const hasImg = (el.paragraph.elements || []).some((e: any) => e.inlineObjectElement);
    if (hasImg && el.startIndex >= insertIndex - 5) {
      await batchUpdate(email, docId, [{
        updateParagraphStyle: {
          range: { startIndex: el.startIndex, endIndex: el.endIndex },
          paragraphStyle: {
            alignment: 'CENTER',
            spaceBelow: pt(12),
          },
          fields: 'alignment,spaceBelow',
        },
      }]);
      break;
    }
  }
}

// ── Formal style application ───────────────────────────────────────────────────

/**
 * Apply the full formal style (fonts, colours, spacing, page margins) to all
 * paragraphs of a document based on their namedStyleType.
 *
 * Call this after `docs-create` or on any existing doc that needs styling.
 */
export async function applyFormalStyle(email: string, docId: string): Promise<{ requestsApplied: number }> {
  const doc     = await getDoc(email, docId);
  const content = doc.body?.content || [];
  const requests: any[] = [];

  // Page margins
  requests.push({
    updateDocumentStyle: {
      documentStyle: {
        marginTop:    pt(Margins.top),
        marginBottom: pt(Margins.bottom),
        marginLeft:   pt(Margins.left),
        marginRight:  pt(Margins.right),
      },
      fields: 'marginTop,marginBottom,marginLeft,marginRight',
    },
  });

  for (const el of content) {
    if (!el.paragraph) continue;
    const text = (el.paragraph.elements || []).map((e: any) => e.textRun?.content || '').join('');
    if (!text.trim()) continue;

    const namedStyle: string = el.paragraph.paragraphStyle?.namedStyleType || 'NORMAL_TEXT';
    const range = { startIndex: el.startIndex, endIndex: el.endIndex };
    const isDateLine = text.trim().toLowerCase().startsWith('date:');

    switch (namedStyle) {
      case 'TITLE':
        requests.push({
          updateParagraphStyle: {
            range,
            paragraphStyle: {
              alignment: 'CENTER',
              spaceAbove: pt(0),
              spaceBelow: pt(10),
            },
            fields: 'alignment,spaceAbove,spaceBelow',
          },
        });
        requests.push({
          updateTextStyle: {
            range,
            textStyle: {
              bold: true,
              fontSize: pt(Sizes.title),
              weightedFontFamily: { fontFamily: Fonts.title },
              foregroundColor: { color: { rgbColor: Colors.title } },
            },
            fields: 'bold,fontSize,weightedFontFamily,foregroundColor',
          },
        });
        break;

      case 'HEADING_1':
        requests.push({
          updateParagraphStyle: {
            range,
            paragraphStyle: {
              alignment: 'START',
              spaceAbove: pt(Spacing.headingAbove),
              spaceBelow: pt(Spacing.headingBelow),
            },
            fields: 'alignment,spaceAbove,spaceBelow',
          },
        });
        requests.push({
          updateTextStyle: {
            range,
            textStyle: {
              bold: true,
              fontSize: pt(Sizes.heading1),
              weightedFontFamily: { fontFamily: Fonts.heading },
              foregroundColor: { color: { rgbColor: Colors.heading } },
            },
            fields: 'bold,fontSize,weightedFontFamily,foregroundColor',
          },
        });
        break;

      case 'HEADING_2':
        requests.push({
          updateParagraphStyle: {
            range,
            paragraphStyle: {
              alignment: 'START',
              spaceAbove: pt(Spacing.headingAbove),
              spaceBelow: pt(Spacing.headingBelow),
              borderBottom: {
                color:     { color: { rgbColor: Colors.headingBorder } },
                width:     pt(0.75),
                padding:   pt(3),
                dashStyle: 'SOLID',
              },
            },
            fields: 'alignment,spaceAbove,spaceBelow,borderBottom',
          },
        });
        requests.push({
          updateTextStyle: {
            range,
            textStyle: {
              bold: true,
              fontSize: pt(Sizes.heading2),
              weightedFontFamily: { fontFamily: Fonts.heading },
              foregroundColor: { color: { rgbColor: Colors.heading } },
              smallCaps: false,
            },
            fields: 'bold,fontSize,weightedFontFamily,foregroundColor,smallCaps',
          },
        });
        break;

      case 'HEADING_3':
        requests.push({
          updateParagraphStyle: {
            range,
            paragraphStyle: {
              alignment: 'START',
              spaceAbove: pt(10),
              spaceBelow: pt(4),
            },
            fields: 'alignment,spaceAbove,spaceBelow',
          },
        });
        requests.push({
          updateTextStyle: {
            range,
            textStyle: {
              bold: true,
              italic: false,
              fontSize: pt(Sizes.heading3),
              weightedFontFamily: { fontFamily: Fonts.heading },
              foregroundColor: { color: { rgbColor: Colors.heading } },
            },
            fields: 'bold,italic,fontSize,weightedFontFamily,foregroundColor',
          },
        });
        break;

      default: // NORMAL_TEXT, list paragraphs, etc.
        requests.push({
          updateParagraphStyle: {
            range,
            paragraphStyle: {
              alignment: isDateLine ? 'CENTER' : 'JUSTIFIED',
              spaceAbove: pt(0),
              spaceBelow: pt(isDateLine ? 14 : Spacing.paragraphBelow),
              lineSpacing: Spacing.lineSpacing,
            },
            fields: 'alignment,spaceAbove,spaceBelow,lineSpacing',
          },
        });
        requests.push({
          updateTextStyle: {
            range,
            textStyle: {
              bold: false,
              italic: isDateLine,
              fontSize: pt(isDateLine ? Sizes.caption + 1 : Sizes.body),
              weightedFontFamily: { fontFamily: Fonts.body },
              foregroundColor: {
                color: { rgbColor: isDateLine ? Colors.muted : Colors.body },
              },
            },
            fields: 'bold,italic,fontSize,weightedFontFamily,foregroundColor',
          },
        });
        break;
    }
  }

  await batchUpdate(email, docId, requests);
  return { requestsApplied: requests.length };
}
