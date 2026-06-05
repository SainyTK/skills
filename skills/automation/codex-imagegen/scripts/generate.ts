#!/usr/bin/env bun
/**
 * Standalone smoke-test/utility runner for the codex-imagegen skill scripts.
 *
 * Usage:
 *   bun .agents/skills/codex-imagegen/scripts/generate.ts \
 *     --prompt "pixel-art cat" \
 *     --out output/imagegen/cat.png \
 *     --size 1024x1024 \
 *     --quality draft \
 *     --force
 */

import { existsSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { createCodexExecCommand } from "./codex-exec.js";
import { createIconBatch, iconSlicingScript, isIconGeneration } from "./icon.js";
import { buildImageGenerationPrompt } from "./prompts/image-generation.js";
import { conversionScript, greenOutputPath, wantsTransparent } from "./transparent.js";
import { defaultOutputPath, requestedPixelSize, resizeScript, resolveInCwd } from "./utils.js";

type Params = {
	prompt: string;
	out?: string;
	size?: string;
	quality?: string;
	force?: boolean;
	transparent?: boolean;
	icons?: string[];
};

function usage(exitCode = 2): never {
	const stream = exitCode === 0 ? process.stdout : process.stderr;
	stream.write(`Usage: bun .agents/skills/codex-imagegen/scripts/generate.ts --prompt <text> [--out <path>] [--size <size>] [--quality <quality>] [--transparent] [--force] [--icon <prompt> ...]

Examples:
  bun .agents/skills/codex-imagegen/scripts/generate.ts --prompt "pixel-art cat" --out output/imagegen/cat.png --size 1024x1024 --quality draft --force
  bun .agents/skills/codex-imagegen/scripts/generate.ts --prompt "toolbar icons" --icon "save icon" --icon "search icon" --out output/imagegen/icons.png --force\n`);
	process.exit(exitCode);
}

function parseArgs(argv: string[]): Params {
	const params: Params = { prompt: "" };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const next = () => {
			const value = argv[++i];
			if (!value) usage();
			return value;
		};
		if (arg === "--prompt" || arg === "-p") params.prompt = next();
		else if (arg === "--out" || arg === "-o") params.out = next();
		else if (arg === "--size") params.size = next();
		else if (arg === "--quality" || arg === "-q") params.quality = next();
		else if (arg === "--transparent") params.transparent = true;
		else if (arg === "--force") params.force = true;
		else if (arg === "--icon") (params.icons ??= []).push(next());
		else if (arg === "--help" || arg === "-h") usage(0);
		else {
			console.error(`Unknown argument: ${arg}`);
			usage();
		}
	}
	if (!params.prompt.trim() && !(params.icons?.length)) usage();
	if (!params.prompt.trim()) params.prompt = "icon batch";
	return params;
}

function run(command: string, args: string[], options: { env?: NodeJS.ProcessEnv } = {}) {
	const result = spawnSync(command, args, {
		stdio: "inherit",
		env: options.env ?? process.env,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}

async function main() {
	const cwd = process.cwd();
	const params = parseArgs(process.argv.slice(2));
	const outputPath = params.out ? resolveInCwd(cwd, params.out) : defaultOutputPath(cwd, params.prompt);
	const iconMode = isIconGeneration(params);
	const iconBatch = iconMode ? createIconBatch(params, outputPath) : undefined;
	const transparent = iconMode || wantsTransparent(params);
	const generationPath = transparent ? greenOutputPath(outputPath) : outputPath;

	if (existsSync(outputPath) && !params.force) {
		throw new Error(`Output already exists: ${outputPath}. Pass --force to overwrite.`);
	}
	for (const iconPath of iconBatch?.outputPaths ?? []) {
		if (existsSync(iconPath) && !params.force) {
			throw new Error(`Icon output already exists: ${iconPath}. Pass --force to overwrite.`);
		}
	}

	await mkdir(dirname(outputPath), { recursive: true });
	if (iconBatch) await mkdir(iconBatch.outputDir, { recursive: true });

	const prompt = buildImageGenerationPrompt(params, generationPath, transparent, iconBatch);
	const command = createCodexExecCommand(cwd, prompt);
	console.error(`Running: ${command.slice(0, -1).join(" ")} <prompt>`);
	run(command[0], command.slice(1));

	const expectedGeneratedPath = transparent ? generationPath : outputPath;
	if (!existsSync(expectedGeneratedPath)) {
		throw new Error(`Expected generated file not found: ${expectedGeneratedPath}`);
	}

	if (transparent) {
		console.error("Converting green background to transparency...");
		run("python3", ["-c", conversionScript(), generationPath, outputPath]);
		rmSync(generationPath, { force: true });
	}

	const targetSize = requestedPixelSize(params.size);
	if (targetSize && !iconBatch) {
		console.error(`Resizing output to ${targetSize.width}x${targetSize.height}...`);
		run("python3", ["-c", resizeScript(), outputPath, outputPath, String(targetSize.width), String(targetSize.height)]);
	}

	if (iconBatch) {
		console.error(`Slicing icon grid into ${iconBatch.finalSize}x${iconBatch.finalSize} PNG files...`);
		run("python3", ["-c", iconSlicingScript(iconBatch), outputPath, iconBatch.outputDir, ...iconBatch.outputPaths], {
			env: {
				...process.env,
				ICON_GRID_SIZE: String(iconBatch.gridSize),
				ICON_GRID_COLUMNS: String(iconBatch.columns),
				ICON_FINAL_SIZE: String(iconBatch.finalSize),
			},
		});
	}

	console.log(outputPath);
	if (iconBatch) {
		console.log(iconBatch.outputDir);
		for (const iconPath of iconBatch.outputPaths) console.log(iconPath);
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
