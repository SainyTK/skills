import { isAbsolute, resolve } from "node:path";

export function slugify(text: string): string {
	const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
	return slug || "image";
}

export function resolveInCwd(cwd: string, path: string): string {
	return isAbsolute(path) ? path : resolve(cwd, path);
}

export function defaultOutputPath(cwd: string, prompt: string): string {
	const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "");
	return resolve(cwd, "output", "imagegen", `${slugify(prompt)}-${stamp}.png`);
}

export function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function mimeFor(path: string): string {
	const lower = path.toLowerCase();
	if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
	if (lower.endsWith(".webp")) return "image/webp";
	return "image/png";
}

export type PixelSize = { width: number; height: number };

export function requestedPixelSize(size?: string): PixelSize | undefined {
	const match = size?.trim().match(/^(\d{2,5})\s*x\s*(\d{2,5})$/i);
	if (!match) return undefined;
	return { width: Number(match[1]), height: Number(match[2]) };
}

export function resizeScript(): string {
	return String.raw`
from PIL import Image
import sys
inp, out, width, height = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
im = Image.open(inp)
if im.size != (width, height):
    im = im.resize((width, height), Image.Resampling.LANCZOS)
    im.save(out)
`;
}
