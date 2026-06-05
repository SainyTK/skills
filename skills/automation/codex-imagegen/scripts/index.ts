/**
 * Image generation tool for pi.
 *
 * Starts raster image generation as a background process so pi stays responsive.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import { defineTool, type ExtensionAPI, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Container, Image, Text } from "@mariozechner/pi-tui";
import { createCodexExecCommand } from "./codex-exec.js";
import { createIconBatch, iconSlicingScript, isIconGeneration, type IconBatch } from "./icon.js";
import { buildImageGenerationPrompt } from "./prompts/image-generation.js";
import { CODEX_IMAGEGEN_PROMPT_GUIDELINES, CODEX_IMAGEGEN_PROMPT_SNIPPET } from "./prompts/tool.js";
import {
	conversionScript,
	greenOutputPath,
	wantsTransparent,
} from "./transparent.js";
import { defaultOutputPath, mimeFor, requestedPixelSize, resizeScript, resolveInCwd, shellQuote, slugify, type PixelSize } from "./utils.js";

type BackgroundTaskSnapshot = {
	id: string;
	title: string;
	command: string;
	cwd: string;
	pid: number;
	logFile: string;
	startedAt: number;
	updatedAt: number;
	lastOutputAt: number | null;
	expiresAt: number | null;
	status: "running" | "completed" | "failed" | "stopped";
	exitCode: number | null;
	reactToOutput: boolean;
	notifyPattern?: string;
	outputBytes: number;
};

type BackgroundTasksApi = {
	spawnTask(options: {
		command: string;
		title?: string;
		cwd?: string;
		reactToOutput?: boolean;
		notifyPattern?: string;
		expiresAt?: number | null;
	}): BackgroundTaskSnapshot;
};

type Details = {
	background: true;
	taskId: string;
	taskName: string;
	command: string;
	cwd: string;
	outputPath: string;
	greenOutputPath?: string;
	transparent: boolean;
	iconBatch?: IconBatch;
	taskDir: string;
	runnerPath: string;
	logPath: string;
	bgTask: BackgroundTaskSnapshot;
};

const Params = Type.Object({
	prompt: Type.String({ description: "Image prompt. Include subject, style, constraints, and any exact text." }),
	out: Type.Optional(
		Type.String({
			description: "Output path, relative to cwd unless absolute. Default: output/imagegen/<prompt-slug>-<timestamp>.png",
		}),
	),
	size: Type.Optional(Type.String({ description: "Requested size/aspect, e.g. 1024x1024, 2048x1152, wallpaper landscape." })),
	quality: Type.Optional(Type.String({ description: "Quality target, e.g. draft, low, medium, high. Default: high." })),
	force: Type.Optional(Type.Boolean({ description: "Overwrite output if it exists. Default: false." })),
	transparent: Type.Optional(Type.Boolean({ description: "Generate with a transparent background. Default: false. Forced on for icon generation." })),
	icons: Type.Optional(Type.Array(Type.String(), { description: "Optional icon batch prompts. When provided, generates up to 16 icons in one transparent 1024x1024 grid and slices each icon to a 64x64 PNG." })),
	include_image: Type.Optional(Type.Boolean({ description: "Ignored for background execution; inspect the output path after the task completes." })),
});

function getBackgroundTasksApi(pi: ExtensionAPI): BackgroundTasksApi {
	const apiKey = Symbol.for("oh-pi.background-tasks.api");
	const api =
		(pi as unknown as Record<PropertyKey, unknown>)[apiKey] ??
		(globalThis as unknown as Record<PropertyKey, unknown>)[apiKey];
	if (!api || typeof api !== "object" || typeof (api as BackgroundTasksApi).spawnTask !== "function") {
		throw new Error(
			"Local background-tasks extension API is not available. Ensure ~/.pi/agent/extensions/background-tasks is loaded before codex-imagegen and reload pi.",
		);
	}
	return api as BackgroundTasksApi;
}

function runnerScript(command: string[], outputPath: string, greenPath: string | undefined, transparent: boolean, targetSize?: PixelSize, iconBatch?: IconBatch): string {
	const shellCommand = command.map(shellQuote).join(" ");
	const output = shellQuote(outputPath);
	const green = greenPath ? shellQuote(greenPath) : undefined;
	const expected = transparent ? green! : output;
	const iconOutputs = iconBatch?.outputPaths.map(shellQuote).join(" ");
	const resizeStep = targetSize && !iconBatch ? `
if [ "$code" -eq 0 ]; then
  echo "Resizing output to ${targetSize.width}x${targetSize.height}..."
  python3 -c ${shellQuote(resizeScript())} ${output} ${output} ${targetSize.width} ${targetSize.height}
  code=$?
fi` : "";
	return `#!/usr/bin/env bash
set +e
mkdir -p ${shellQuote(dirname(outputPath))}
echo "Starting codex image generation..."
${shellCommand}
code=$?
if [ "$code" -eq 0 ] && [ ! -f ${expected} ]; then
  echo "Expected generated file not found: ${transparent ? greenPath : outputPath}"
  code=2
fi
${transparent ? `
if [ "$code" -eq 0 ]; then
  echo "Converting green background to transparency..."
  python3 -c ${shellQuote(conversionScript())} ${green} ${output}
  code=$?
  rm -f ${green}
fi` : ""}
${resizeStep}
${iconBatch ? `
if [ "$code" -eq 0 ]; then
  echo "Slicing icon grid into ${iconBatch.finalSize}x${iconBatch.finalSize} PNG files..."
  ICON_GRID_SIZE=${iconBatch.gridSize} ICON_GRID_COLUMNS=${iconBatch.columns} ICON_FINAL_SIZE=${iconBatch.finalSize} python3 -c ${shellQuote(iconSlicingScript(iconBatch))} ${output} ${shellQuote(iconBatch.outputDir)} ${iconOutputs}
  code=$?
fi` : ""}
exit "$code"
`;
}

async function startBackgroundImageTask(pi: ExtensionAPI, ctx: ExtensionContext, params: any, outputPath: string, transparent: boolean, generationPath: string, iconBatch?: IconBatch): Promise<Details> {
	const bg = getBackgroundTasksApi(pi);
	const prompt = buildImageGenerationPrompt(params, generationPath, transparent, iconBatch);
	const command = createCodexExecCommand(ctx.cwd, prompt);
	const taskName = `imagegen-${slugify(params.prompt).slice(0, 28)}`;
	const taskDir = join(ctx.cwd, "output", "imagegen", "tasks", `${taskName}-${randomUUID().slice(0, 8)}`);
	const runnerPath = join(taskDir, "runner.sh");
	const metadataPath = join(taskDir, "metadata.json");

	await mkdir(taskDir, { recursive: true });
	if (iconBatch) await mkdir(iconBatch.outputDir, { recursive: true });
	const targetSize = requestedPixelSize(params.size);
	await writeFile(runnerPath, runnerScript(command, outputPath, transparent ? generationPath : undefined, transparent, targetSize, iconBatch), "utf8");
	await chmod(runnerPath, 0o700);

	const bgTask = bg.spawnTask({
		command: `bash ${shellQuote(runnerPath)}`,
		title: taskName,
		cwd: ctx.cwd,
		reactToOutput: false,
		expiresAt: null,
	});

	const details: Details = {
		background: true,
		taskId: bgTask.id,
		taskName,
		command: bgTask.command,
		cwd: bgTask.cwd,
		outputPath,
		greenOutputPath: transparent ? generationPath : undefined,
		transparent,
		iconBatch,
		taskDir,
		runnerPath,
		logPath: bgTask.logFile,
		bgTask,
	};

	await writeFile(metadataPath, JSON.stringify({
		id: bgTask.id,
		name: taskName,
		command: command.map(shellQuote).join(" "),
		purpose: "Generate image via codex_imagegen",
		cwd: ctx.cwd,
		createdAt: Date.now(),
		taskDir,
		runnerPath,
		logPath: bgTask.logFile,
		outputPath,
		greenOutputPath: transparent ? generationPath : undefined,
		iconBatch,
		backgroundTask: bgTask,
	}, null, 2), "utf8");

	return details;
}

function createCodexImagegen(pi: ExtensionAPI) {
	return defineTool({
		name: "codex_imagegen",
		label: "Codex ImageGen",
		description:
			"Generate raster images as a background process. Icon requests generate a transparent 1024x1024 batch grid and slice up to 16 icons into 64x64 PNG files. Returns immediately with task/log paths using @ifi/pi-background-tasks-compatible task metadata.",
		promptSnippet: CODEX_IMAGEGEN_PROMPT_SNIPPET,
		promptGuidelines: CODEX_IMAGEGEN_PROMPT_GUIDELINES,
		parameters: Params,
		executionMode: "parallel",

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const outputPath = params.out ? resolveInCwd(ctx.cwd, params.out) : defaultOutputPath(ctx.cwd, params.prompt);
			const iconMode = isIconGeneration(params);
			const iconBatch = iconMode ? createIconBatch(params, outputPath) : undefined;
			const transparent = iconMode || wantsTransparent(params);
			const generationPath = transparent ? greenOutputPath(outputPath) : outputPath;
			if (existsSync(outputPath) && !params.force) {
				throw new Error(`Output already exists: ${outputPath}. Set force=true to overwrite.`);
			}
			for (const iconPath of iconBatch?.outputPaths ?? []) {
				if (existsSync(iconPath) && !params.force) {
					throw new Error(`Icon output already exists: ${iconPath}. Set force=true to overwrite.`);
				}
			}
			await mkdir(dirname(outputPath), { recursive: true });

			const details = await startBackgroundImageTask(pi, ctx, params, outputPath, transparent, generationPath, iconBatch);
			pi.appendEntry("background-task", { event: "started", id: details.taskId, name: details.taskName, command: details.command, cwd: details.cwd, logFile: details.logPath, startedAt: Date.now() });

			const iconText = iconBatch ? `\nExpected icon output directory: ${iconBatch.outputDir}\nExpected icon files:\n${iconBatch.outputPaths.map((path) => `- ${path}`).join("\n")}` : "";
			return {
				content: [{ type: "text", text: `Image generation started as background task.\nTask: ${details.taskId}\nExpected output: ${outputPath}${iconText}\nLog: ${details.logPath}` }],
				details,
			};
		},

		renderCall(args, theme) {
			const out = args.out ? ` → ${basename(args.out)}` : "";
			return new Text(theme.fg("toolTitle", theme.bold("codex_imagegen ")) + theme.fg("accent", "background") + theme.fg("muted", out), 0, 0);
		},

		renderResult(result, { isPartial }, theme, context) {
			if (isPartial) return new Text(theme.fg("warning", "Starting image generation background task..."), 0, 0);

			const details = result.details as Details | undefined;
			const outputPath = details?.outputPath;
			const container = new Container();

			container.addChild(new Text(
				theme.fg("success", `Image generation started${details?.taskId ? `: ${details.taskId}` : ""}`) +
				(outputPath ? theme.fg("muted", `\nOutput: ${outputPath}`) : "") +
				(details?.iconBatch ? theme.fg("muted", `\nIcon outputs: ${details.iconBatch.outputDir}`) : ""),
				0,
				0,
			));

			if (outputPath && context.showImages && existsSync(outputPath) && statSync(outputPath).size <= 8 * 1024 * 1024) {
				container.addChild(
					new Image(
						readFileSync(outputPath).toString("base64"),
						mimeFor(outputPath),
						{ fallbackColor: (text: string) => theme.fg("muted", text) },
						{ maxWidthCells: 40, maxHeightCells: 12, filename: basename(outputPath) },
					),
				);
			}

			return container;
		},
	});
}

export default function (pi: ExtensionAPI) {
	pi.registerTool(createCodexImagegen(pi));
}
