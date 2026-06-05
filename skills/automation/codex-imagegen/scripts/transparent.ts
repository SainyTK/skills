export function wantsTransparent(params: { transparent?: boolean; prompt: string }): boolean {
	return Boolean(params.transparent || /\b(transparent|transparency|alpha|no background)\b/i.test(params.prompt));
}

export function greenOutputPath(outputPath: string): string {
	const dot = outputPath.lastIndexOf(".");
	const stem = dot >= 0 ? outputPath.slice(0, dot) : outputPath;
	return `${stem}.green-${Date.now()}-${process.pid}.png`;
}

export function conversionScript(): string {
	return String.raw`
from PIL import Image
import sys, math
inp, out = sys.argv[1], sys.argv[2]
im = Image.open(inp).convert("RGBA")
pixels = im.load()
w, h = im.size
for y in range(h):
    for x in range(w):
        r, g, b, a = pixels[x, y]
        dist = math.sqrt((r - 0) ** 2 + (g - 128) ** 2 + (b - 0) ** 2)
        green_dominant = g > 70 and g > r * 1.15 and g > b * 1.15
        if dist <= 30 or (dist <= 95 and green_dominant):
            if dist <= 30:
                new_a = 0
            else:
                new_a = int(a * ((dist - 30) / 65))
            pixels[x, y] = (r, g, b, max(0, min(255, new_a)))
im.save(out)
`;
}
