export const CODEX_IMAGEGEN_PROMPT_SNIPPET = "codex_imagegen - Start raster image generation in a background task.";

export const CODEX_IMAGEGEN_PROMPT_GUIDELINES = [
	"Always use codex_imagegen when the user asks for anything related to image generation or image creation, even if they do not mention this tool by name.",
	"codex_imagegen always runs in the background. After calling it, tell the user the task id and expected output path instead of waiting for completion.",
	"Inspect codex_imagegen progress using the returned log path.",
	"Use codex_imagegen for raster image generation only, not SVG/vector/code-native assets.",
	"When the user asks for a transparent image, set transparent=true. The task will generate a green (#008000) background image first, convert that green background to transparency, save the final transparent image to the requested path, and remove the temporary green image.",
	"When the user asks for icon generation, use codex_imagegen and prefer the icons parameter with one prompt per icon. Batch multiple icons into one call, maximum 16 icons per call.",
	"Icon generation automatically uses the transparent workflow, asks the backend for a 1024x1024 icon grid, and slices outputs into individual 64x64 transparent PNG files.",
	"For icon requests, report both the grid output path and the generated icon output directory/files from the tool result.",
	"Save outputs under the workspace, normally output/imagegen/, and report final paths.",
];
