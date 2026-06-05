import type { IconBatch } from "../icon.js";
import { addIconGenerationInstructions } from "../icon.js";
import { addTransparentGenerationInstructions } from "./transparent.js";

export function buildImageGenerationPrompt(params: any, outputPath: string, transparent: boolean, iconBatch?: IconBatch): string {
	const basePrompt = iconBatch ? addIconGenerationInstructions(params.prompt, iconBatch) : params.prompt;
	const imagePrompt = transparent ? addTransparentGenerationInstructions(basePrompt) : basePrompt;
	return [
		"Generate a raster image using your built-in image generation tool/capability directly.",
		"Do not run codex, codex exec, or any other image-generation CLI recursively; you are already inside the image-generation backend.",
		"Do not create a fallback placeholder with Python or drawing code unless the image generation tool is unavailable and you explicitly report that limitation.",
		`Prompt: ${imagePrompt}`,
		iconBatch ? `Requested size/aspect: ${iconBatch.gridSize}x${iconBatch.gridSize}` : params.size ? `Requested size/aspect: ${params.size}` : undefined,
		`Quality target: ${params.quality || "high"}`,
		"Output format: png",
		`Save the image exactly to: ${outputPath}`,
		params.force ? "Overwrite the output path if it already exists." : "If the output path exists, create the image anyway only if safe; do not modify unrelated files.",
		"After generation, ensure the selected image file exists at the requested path.",
		"Final response: output only the saved path.",
	]
		.filter(Boolean)
		.join("\n");
}
