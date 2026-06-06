#!/usr/bin/env bun

/**
 * read-line-messages — two-phase LINE reader.
 *
 *  Phase 1 (capture): use the `codex-computer-use` skill ONLY to drive the GUI
 *           (focus LINE, open a conversation, scroll), and take the actual window
 *           screenshots from THIS process with `screencapture -o -l<windowid>`.
 *           Why split it: the codex exec seatbelt sandbox strips macOS Screen
 *           Recording, so `screencapture` fails inside it — but it works from this
 *           skill's own shell. Per-window capture (`-l<id>`) works even though
 *           full-display capture is TCC-blocked for the terminal.
 *  Phase 2 (transcribe): attach those PNGs to a fresh non-interactive `codex exec`
 *           that transcribes the messages verbatim, each cited back to its source
 *           screenshot filename.
 */

import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

const SKILL_DIR = resolve(import.meta.dir, "..");
const REPO_ROOT = resolve(SKILL_DIR, "..", "..", "..");
const SCREENSHOTS_DIR = join(SKILL_DIR, "screenshots");
const CU_RUNNER = join(REPO_ROOT, ".agents/skills/codex-computer-use/scripts/run.ts");

type Params = {
	shots: number;
	scrollPages: number;
	conversation?: string;
	out: string;
	model?: string;
	keep: boolean;
	dryRun: boolean;
};

function usage(exitCode = 2): never {
	const stream = exitCode === 0 ? process.stdout : process.stderr;
	stream.write(`Usage: bun .agents/skills/read-line-messages/scripts/run.ts [options]

Captures LINE message screenshots via Computer Use, then transcribes them
verbatim with a second codex pass. Screenshots + transcript land in:
  ${SCREENSHOTS_DIR}

Options:
  -n, --shots <N>          Number of screenshots to capture (default: 3)
      --scroll-pages <P>   Pages to scroll up between captures (default: 1)
  -c, --conversation <s>   Open this conversation by name before capturing
  -o, --out <file>         Transcript output (default: screenshots/transcript.md)
  -m, --model <model>      Model for the transcription pass
      --keep               Keep existing screenshots (default: wipe line-*.png first)
      --dry-run            Print the planned commands, do not run anything
  -h, --help               Show this help
`);
	process.exit(exitCode);
}

function nextValue(argv: string[], index: number, arg: string): [string, number] {
	const value = argv[index + 1];
	if (!value) {
		console.error(`Missing value for ${arg}`);
		usage();
	}
	return [value, index + 1];
}

function parseArgs(argv: string[]): Params {
	const params: Params = {
		shots: 3,
		scrollPages: 1,
		out: join(SCREENSHOTS_DIR, "transcript.md"),
		keep: false,
		dryRun: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--shots" || arg === "-n") {
			const [v, ni] = nextValue(argv, i, arg);
			params.shots = Math.max(1, Number.parseInt(v, 10) || 1);
			i = ni;
		} else if (arg === "--scroll-pages") {
			const [v, ni] = nextValue(argv, i, arg);
			params.scrollPages = Math.max(1, Number.parseInt(v, 10) || 1);
			i = ni;
		} else if (arg === "--conversation" || arg === "-c") {
			[params.conversation, i] = nextValue(argv, i, arg);
		} else if (arg === "--out" || arg === "-o") {
			const [v, ni] = nextValue(argv, i, arg);
			params.out = isAbsolute(v) ? v : resolve(process.cwd(), v);
			i = ni;
		} else if (arg === "--model" || arg === "-m") {
			[params.model, i] = nextValue(argv, i, arg);
		} else if (arg === "--keep") {
			params.keep = true;
		} else if (arg === "--dry-run") {
			params.dryRun = true;
		} else if (arg === "--help" || arg === "-h") {
			usage(0);
		} else {
			console.error(`Unknown argument: ${arg}`);
			usage();
		}
	}
	return params;
}

function findCodex(): string {
	if (process.env.CODEX_BIN) return process.env.CODEX_BIN;
	const probe = spawnSync("codex", ["--version"], { stdio: "ignore" });
	if (!probe.error) return "codex";
	throw new Error("Codex CLI not available. Install codex or set CODEX_BIN=/path/to/codex.");
}

/** Find the on-screen LINE main window id (largest window owned by "LINE"). */
function findLineWindowId(): number {
	const py = `import Quartz, json
wins = Quartz.CGWindowListCopyWindowInfo(Quartz.kCGWindowListOptionOnScreenOnly, Quartz.kCGNullWindowID)
best = None
for w in wins:
    if w.get('kCGWindowOwnerName') != 'LINE':
        continue
    b = w.get('kCGWindowBounds') or {}
    area = (b.get('Width') or 0) * (b.get('Height') or 0)
    if best is None or area > best[1]:
        best = (w.get('kCGWindowNumber'), area)
print(best[0] if best else '')`;
	const res = spawnSync("python3", ["-c", py], { encoding: "utf8" });
	if (res.status !== 0) {
		throw new Error(`Could not query windows via python3/Quartz:\n${res.stderr || res.stdout}`);
	}
	const id = Number.parseInt((res.stdout || "").trim(), 10);
	if (!Number.isFinite(id) || id <= 0) {
		throw new Error("LINE does not appear to be running (no on-screen LINE window found).");
	}
	return id;
}

function buildFocusTask(params: Params): string {
	const conv = params.conversation
		? `Open the conversation named "${params.conversation}".`
		: "Use the conversation that is already open; if none is open, open the most recent one.";
	return `Prepare the LINE app for screenshotting. READ ONLY — do NOT send, reply, react, delete, type, or change any setting.

Steps:
1. Use Computer Use to focus the LINE app and bring its main conversation window frontmost and fully visible.
2. ${conv}
3. Make sure the message area is showing the newest messages (scrolled to the bottom).
Then STOP. Do NOT scroll further, do NOT take screenshots, do NOT run any shell commands. This run only positions the window; another process captures it.`;
}

function buildScrollTask(params: Params): string {
	return `Scroll older messages into view in the LINE app. READ ONLY — do NOT send, reply, react, delete, type, or change any setting.

Steps:
1. Use Computer Use to focus the LINE app conversation window.
2. Scroll UP by ${params.scrollPages} page(s) in the conversation MESSAGE area (not the chat list) using the Computer Use scroll action with direction "up", to reveal OLDER messages.
Then STOP. Do NOT take screenshots or run shell commands.
If the message area did not move because it is already at the very top/oldest message, end your final answer with the exact token: AT_TOP`;
}

function buildTranscribePrompt(files: string[]): string {
	const list = files.map((f, i) => `  ${i + 1}. ${f.split("/").pop()}${i === 0 ? "  (NEWEST view)" : "  (older — scrolled up)"}`).join("\n");
	return `You are given ${files.length} screenshot(s) of a LINE (chat app) conversation on macOS, attached in this order:
${list}

Transcribe the messages they show, VERBATIM. This is OCR from images — your job is to report exactly what is visible, not to interpret it.

Output format (Markdown):
- One section per screenshot, headed by its filename, e.g. "## line-01.png".
- If a conversation title is visible, note it once under the first section as "**Chat:** <title>".
- Under each section, list every visible message top-to-bottom as:
    - **<sender or "You">:** <exact text>   _[timestamp if visible]_
- End with a "## Low-confidence" section listing any spots you marked 〔?〕 and why.

Strict rules:
- Thai text: copy EXACTLY. Preserve every tone mark, vowel, and spelling. Do NOT correct, translate, normalize, or substitute a more "plausible" word. If a glyph is genuinely unreadable, write 〔?〕 instead of guessing.
- URLs: copy character by character. If a character is ambiguous (capital-I vs lowercase-l, O vs 0), mark it 〔?〕. Never invent URL characters.
- Adjacent screenshots overlap because of paging — that is expected. Repeat overlapping messages under each file so every message stays cited to its source screenshot.
- Ignore UI chrome (sidebar chat list, buttons, search box) except the conversation title.`;
}

/** Drive the GUI via the codex-computer-use skill. Returns the agent's final message. */
function runComputerUse(label: string, task: string): string {
	const outFile = join(tmpdir(), `rlm-cu-${label}.txt`);
	rmSync(outFile, { force: true });
	const args = [CU_RUNNER, "--task", task, "--sandbox", "read-only", "--cwd", REPO_ROOT, "--out", outFile];
	const res = spawnSync("bun", args, { cwd: REPO_ROOT, stdio: "inherit", env: process.env });
	if (res.error) throw res.error;
	if (res.status !== 0) throw new Error(`computer-use phase '${label}' exited with ${res.status}`);
	const msg = existsSync(outFile) ? readFileSync(outFile, "utf8") : "";
	rmSync(outFile, { force: true });
	return msg;
}

/** Capture one LINE window screenshot from THIS process (has Screen Recording). */
function captureWindow(winId: number, path: string) {
	rmSync(path, { force: true });
	const res = spawnSync("screencapture", ["-x", "-o", `-l${winId}`, path], { encoding: "utf8" });
	if (res.status !== 0 || !existsSync(path)) {
		throw new Error(`screencapture failed for window ${winId}: ${(res.stderr || "").trim() || "no output file"}`);
	}
}

function pad2(n: number): string {
	return String(n).padStart(2, "0");
}

function runCapture(params: Params, winId: number) {
	const pngPath = (i: number) => join(SCREENSHOTS_DIR, `line-${pad2(i)}.png`);

	if (params.dryRun) {
		console.log(`\n[phase 1: capture] window ${winId}, up to ${params.shots} shot(s)`);
		console.log("\n--- focus task (codex-computer-use, read-only) ---\n" + buildFocusTask(params));
		console.log("\n--- capture (this process) ---\n  screencapture -x -o -l" + winId + ` "${pngPath(1)}"  (then 02, 03, ...)`);
		if (params.shots > 1) console.log("\n--- scroll task between shots (codex-computer-use, read-only) ---\n" + buildScrollTask(params));
		return;
	}

	console.log(`\n=== Phase 1: capturing up to ${params.shots} screenshot(s) of LINE (window ${winId}) ===`);
	console.log("\n-- positioning LINE (focus / open conversation) --");
	runComputerUse("focus", buildFocusTask(params));
	captureWindow(winId, pngPath(1));
	console.log(`captured ${pngPath(1)}`);

	let prev = readFileSync(pngPath(1));
	for (let i = 2; i <= params.shots; i++) {
		console.log(`\n-- scrolling up for shot ${i}/${params.shots} --`);
		const msg = runComputerUse(`scroll-${i}`, buildScrollTask(params));
		captureWindow(winId, pngPath(i));
		const cur = readFileSync(pngPath(i));
		if (msg.includes("AT_TOP") || cur.equals(prev)) {
			// Already at the oldest message — this frame is a duplicate of the previous view.
			rmSync(pngPath(i), { force: true });
			console.log(`reached top of conversation at shot ${i}; stopping (removed duplicate frame).`);
			break;
		}
		console.log(`captured ${pngPath(i)}`);
		prev = cur;
	}
}

function collectScreenshots(): string[] {
	if (!existsSync(SCREENSHOTS_DIR)) return [];
	return readdirSync(SCREENSHOTS_DIR)
		.filter((f) => /^line-\d+\.png$/i.test(f))
		.sort()
		.map((f) => join(SCREENSHOTS_DIR, f));
}

function runTranscribe(params: Params, files: string[]) {
	const codex = findCodex();
	const prompt = buildTranscribePrompt(files);
	const args = [
		"exec",
		"--cd",
		REPO_ROOT,
		"--sandbox",
		"read-only",
		"--skip-git-repo-check",
		"--ephemeral",
		"--output-last-message",
		params.out,
	];
	if (params.model) args.push("--model", params.model);
	args.push("-i", ...files); // variadic; stops at end of argv. Prompt comes via stdin.

	if (params.dryRun) {
		console.log(`\n[phase 2: transcribe] (prompt via stdin) ${codex} ${args.join(" ")}`);
		console.log("\n--- transcribe prompt ---\n" + prompt);
		return;
	}
	console.log(`\n=== Phase 2: transcribing ${files.length} screenshot(s) -> ${params.out} ===`);
	const res = spawnSync(codex, args, {
		cwd: REPO_ROOT,
		input: prompt,
		stdio: ["pipe", "inherit", "inherit"],
		env: process.env,
	});
	if (res.error) throw res.error;
	if (res.status !== 0) throw new Error(`transcribe phase (codex exec) exited with ${res.status}`);
}

async function main() {
	const params = parseArgs(process.argv.slice(2));

	if (!existsSync(CU_RUNNER)) {
		throw new Error(`codex-computer-use runner not found at ${CU_RUNNER}`);
	}
	await mkdir(SCREENSHOTS_DIR, { recursive: true });
	if (params.out) await mkdir(dirname(params.out), { recursive: true });

	if (!params.keep && !params.dryRun) {
		for (const f of collectScreenshots()) rmSync(f, { force: true });
	}

	const winId = findLineWindowId();

	runCapture(params, winId);

	if (params.dryRun) {
		runTranscribe(params, [join(SCREENSHOTS_DIR, "line-01.png")]);
		return;
	}

	const files = collectScreenshots();
	if (files.length === 0) {
		throw new Error("No screenshots were produced — capture phase did not write any line-NN.png files.");
	}
	console.log(`\nCaptured ${files.length} screenshot(s):\n${files.map((f) => "  " + f).join("\n")}`);

	runTranscribe(params, files);

	console.log(`\nDone. Transcript: ${params.out}\nScreenshots referenced above remain in ${SCREENSHOTS_DIR}`);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
