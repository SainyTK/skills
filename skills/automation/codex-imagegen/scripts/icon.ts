import { basename, dirname, extname, join } from "node:path";
import { slugify } from "./utils.js";

export const ICON_GRID_SIZE = 1024;
export const ICON_BATCH_LIMIT = 16;
export const ICON_FINAL_SIZE = 64;
export const ICON_GRID_COLUMNS = 16;
export const ICON_GRID_ROWS = 16;

export type IconBatch = {
	icons: string[];
	gridSize: number;
	finalSize: number;
	columns: number;
	rows: number;
	outputDir: string;
	outputPaths: string[];
};

export function isIconGeneration(params: { prompt: string; icons?: unknown }): boolean {
	if (Array.isArray(params.icons) && params.icons.some((icon) => typeof icon === "string" && icon.trim())) return true;
	return /\b(app\s*)?icons?\b|\bfavicon\b|\btoolbar icon\b|\bicon set\b|\bsprite sheet\b/i.test(params.prompt);
}

function promptIconList(prompt: string): string[] {
	const listed = prompt.match(/\b(?:icons?|icon set)\s*:\s*([^\n.]+)/i)?.[1]
		?.split(/[,;]|\band\b/i)
		.map((item) => item.replace(/^\s*(?:\d+[.)-]\s*)?/, "").trim())
		.filter(Boolean) ?? [];
	if (listed.length > 1) return listed;

	const numbered = prompt.match(/(?:^|[\n;,])\s*(?:\d+[.)-]\s*)?([^\n;,]+?\bicon\b[^\n;,]*)/gi)
		?.map((item) => item.replace(/^[\n;,\s]*(?:\d+[.)-]\s*)?/, "").trim())
		.filter(Boolean) ?? [];
	return numbered.length > 1 ? numbered : [prompt.trim()];
}

function normalizeIcons(params: { prompt: string; icons?: unknown }): string[] {
	const raw = Array.isArray(params.icons) ? params.icons : promptIconList(params.prompt);
	const icons = raw
		.map((icon) => (typeof icon === "string" ? icon.trim() : ""))
		.filter(Boolean);
	return icons.length ? icons : [params.prompt.trim()].filter(Boolean);
}

export function iconOutputDir(gridOutputPath: string): string {
	const ext = extname(gridOutputPath);
	const stem = ext ? basename(gridOutputPath, ext) : basename(gridOutputPath);
	return join(dirname(gridOutputPath), `${stem}-icons`);
}

export function createIconBatch(params: { prompt: string; icons?: unknown }, gridOutputPath: string): IconBatch {
	const icons = normalizeIcons(params);
	if (icons.length > ICON_BATCH_LIMIT) {
		throw new Error(`Icon generation supports at most ${ICON_BATCH_LIMIT} icons per batch; received ${icons.length}. Split the request into multiple codex_imagegen calls.`);
	}
	const outputDir = iconOutputDir(gridOutputPath);
	return {
		icons,
		gridSize: ICON_GRID_SIZE,
		finalSize: ICON_FINAL_SIZE,
		columns: ICON_GRID_COLUMNS,
		rows: ICON_GRID_ROWS,
		outputDir,
		outputPaths: icons.map((icon, index) => join(outputDir, `${String(index + 1).padStart(2, "0")}-${slugify(icon).slice(0, 36)}.png`)),
	};
}

export function addIconGenerationInstructions(prompt: string, batch: IconBatch): string {
	const slotSize = batch.gridSize / batch.columns;
	return [
		prompt,
		"",
		"ICON BATCH REQUIREMENTS:",
		`- Generate exactly one ${batch.gridSize}x${batch.gridSize} PNG sprite sheet.`,
		`- Use a ${batch.columns}x${batch.rows} grid. Each slot is ${slotSize}x${slotSize} pixels.`,
		`- Create ${batch.icons.length} icon(s), one per ${slotSize}x${slotSize} slot, in row-major order starting at the top-left slot.`,
		`- Each icon must be visually centered inside its own slot and use identical padding/scale.`,
		`- Design each icon to remain crisp and readable when exported as ${batch.finalSize}x${batch.finalSize}.`,
		"- Do not add labels, captions, slot numbers, borders, grid lines, shadows outside the slot, or extra decorative marks.",
		"- Leave unused slots empty background only.",
		"- Keep all icon artwork fully inside its slot; no overlap between slots.",
		"- Icons in row-major order:",
		...batch.icons.map((icon, index) => `  ${index + 1}. ${icon}`),
	].join("\n");
}

export function iconSlicingScript(batch: IconBatch): string {
	return String.raw`
from PIL import Image
import os, sys
inp = sys.argv[1]
out_dir = sys.argv[2]
paths = sys.argv[3:]
grid_size = int(os.environ.get("ICON_GRID_SIZE", "1024"))
columns = int(os.environ.get("ICON_GRID_COLUMNS", "4"))
final_size = int(os.environ.get("ICON_FINAL_SIZE", "64"))
slot = grid_size // columns
im = Image.open(inp).convert("RGBA")
if im.size != (grid_size, grid_size):
    im = im.resize((grid_size, grid_size), Image.Resampling.LANCZOS)
os.makedirs(out_dir, exist_ok=True)

def alpha_count(image):
    return sum(1 for px in image.getdata() if px[3] > 8)

def fit_icon(crop):
    bbox = crop.getbbox()
    if bbox:
        crop = crop.crop(bbox)
        w, h = crop.size
        side = max(w, h, 1)
        pad = max(2, int(side * 0.18))
        canvas = Image.new("RGBA", (side + pad * 2, side + pad * 2), (0, 0, 0, 0))
        canvas.alpha_composite(crop, ((canvas.width - w) // 2, (canvas.height - h) // 2))
        crop = canvas
    return crop.resize((final_size, final_size), Image.Resampling.LANCZOS)

crops = []
for index in range(len(paths)):
    row = index // columns
    col = index % columns
    crops.append(im.crop((col * slot, row * slot, (col + 1) * slot, (row + 1) * slot)))

# Some image backends ignore the requested 16x16 sprite sheet and render the requested
# icons as a single horizontal strip. If the expected cells are blank, recover by
# splitting visible alpha components left-to-right before exporting 64x64 icons.
if any(alpha_count(crop) < 32 for crop in crops):
    alpha = im.getchannel("A")
    cols = [x for x in range(im.width) if sum(1 for y in range(im.height) if alpha.getpixel((x, y)) > 8) > 4]
    rows = [y for y in range(im.height) if sum(1 for x in range(im.width) if alpha.getpixel((x, y)) > 8) > 4]
    if cols and rows:
        ranges = []
        start = prev = cols[0]
        gap = max(4, final_size // 8)
        for x in cols[1:]:
            if x > prev + gap:
                ranges.append((start, prev + 1))
                start = x
            prev = x
        ranges.append((start, prev + 1))
        if len(ranges) >= len(paths):
            y0, y1 = min(rows), max(rows) + 1
            crops = [im.crop((x0, y0, x1, y1)) for x0, x1 in ranges[:len(paths)]]

for crop, out in zip(crops, paths):
    fit_icon(crop).save(out)
`;
}
