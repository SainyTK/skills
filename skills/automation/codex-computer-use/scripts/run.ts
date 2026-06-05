#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { spawnSync } from "node:child_process";

type Sandbox = "read-only" | "workspace-write" | "danger-full-access";

type Params = {
	task: string;
	cwd: string;
	sandbox: Sandbox;
	out?: string;
	model?: string;
	profile?: string;
	json: boolean;
	ephemeral: boolean;
	dryRun: boolean;
	extraInstruction?: string;
};

function usage(exitCode = 2): never {
	const stream = exitCode === 0 ? process.stdout : process.stderr;
	stream.write(`Usage: bun .agents/skills/codex-computer-use/scripts/run.ts --task <task> [options]

Options:
  -t, --task <text>          GUI task for the Codex sub-agent to complete
  -C, --cwd <dir>            Working directory for codex exec (default: current directory)
  -s, --sandbox <mode>       read-only | workspace-write | danger-full-access (default: workspace-write)
  -o, --out <file>           Write sub-agent final message to this file
  -m, --model <model>        Pass a model to codex exec
  -p, --profile <profile>    Pass a Codex config profile
      --json                 Print Codex JSONL events
      --no-ephemeral         Persist the Codex exec session
      --extra <text>         Extra instruction appended to the generated prompt
      --dry-run              Print the command and prompt, do not run Codex
  -h, --help                 Show this help

Examples:
  bun .agents/skills/codex-computer-use/scripts/run.ts --task "List running apps using Computer Use." --dry-run
  bun .agents/skills/codex-computer-use/scripts/run.ts --task "Read latest visible LINE messages. Do not reply." --out output/codex-computer-use/line.txt
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
		task: "",
		cwd: process.cwd(),
		sandbox: "workspace-write",
		json: false,
		ephemeral: true,
		dryRun: false,
	};

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--task" || arg === "-t") {
			[params.task, i] = nextValue(argv, i, arg);
		} else if (arg === "--cwd" || arg === "-C") {
			[params.cwd, i] = nextValue(argv, i, arg);
		} else if (arg === "--sandbox" || arg === "-s") {
			const [value, nextIndex] = nextValue(argv, i, arg);
			if (!["read-only", "workspace-write", "danger-full-access"].includes(value)) {
				throw new Error(`Invalid sandbox: ${value}`);
			}
			params.sandbox = value as Sandbox;
			i = nextIndex;
		} else if (arg === "--out" || arg === "-o") {
			[params.out, i] = nextValue(argv, i, arg);
		} else if (arg === "--model" || arg === "-m") {
			[params.model, i] = nextValue(argv, i, arg);
		} else if (arg === "--profile" || arg === "-p") {
			[params.profile, i] = nextValue(argv, i, arg);
		} else if (arg === "--json") {
			params.json = true;
		} else if (arg === "--no-ephemeral") {
			params.ephemeral = false;
		} else if (arg === "--extra") {
			[params.extraInstruction, i] = nextValue(argv, i, arg);
		} else if (arg === "--dry-run") {
			params.dryRun = true;
		} else if (arg === "--help" || arg === "-h") {
			usage(0);
		} else {
			console.error(`Unknown argument: ${arg}`);
			usage();
		}
	}

	params.task = params.task.trim();
	if (!params.task) usage();
	params.cwd = resolve(params.cwd);
	if (params.out) params.out = isAbsolute(params.out) ? params.out : resolve(params.cwd, params.out);
	return params;
}

function findCodex(): string {
	if (process.env.CODEX_BIN) return process.env.CODEX_BIN;
	const probe = spawnSync("codex", ["--version"], { stdio: "ignore" });
	if (!probe.error) return "codex";
	throw new Error("Codex CLI not available. Install codex or set CODEX_BIN=/path/to/codex.");
}

function buildPrompt(params: Params): string {
	const outputLine = params.out
		? `When finished, make your final answer concise. The Codex CLI wrapper will write that final answer to ${params.out}; do not create, edit, or overwrite that file yourself.`
		: "When finished, make your final answer concise.";
	const extra = params.extraInstruction ? `\n\nExtra instruction from caller:\n${params.extraInstruction}` : "";

	return `Use the computer-use skill to complete this GUI task on the local Mac.

Task:
${params.task}

Operating rules:
- Run in Codex non-interactive mode; do not ask the user questions unless impossible.
- Prefer read-only inspection. Do not reply, send, submit, delete, purchase, upload, change settings, or transmit sensitive data unless the task explicitly asks for that exact action and policy allows it.
- If Computer Use must interact with a visible app, keep actions minimal and report any app focus changes.
- If a non-disruptive or background Computer Use mode is available, use it. If not, use the default foreground Computer Use mode.
- Start by using the computer-use skill instructions if available.
- ${outputLine}${extra}`;
}

function createCodexArgs(params: Params, prompt: string): string[] {
	const args = [
		"exec",
		"--cd",
		params.cwd,
		"--sandbox",
		params.sandbox,
		"--skip-git-repo-check",
	];
	if (params.ephemeral) args.push("--ephemeral");
	if (params.json) args.push("--json");
	if (params.model) args.push("--model", params.model);
	if (params.profile) args.push("--profile", params.profile);
	if (params.out) args.push("--output-last-message", params.out);
	args.push(prompt);
	return args;
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

async function main() {
	const params = parseArgs(process.argv.slice(2));
	const prompt = buildPrompt(params);
	const codex = findCodex();
	const args = createCodexArgs(params, prompt);

	if (params.out) await mkdir(dirname(params.out), { recursive: true });

	if (params.dryRun) {
		console.log([codex, ...args.slice(0, -1), "<prompt>"].map(shellQuote).join(" "));
		console.log("\n--- prompt ---");
		console.log(prompt);
		return;
	}

	if (!existsSync(params.cwd)) throw new Error(`cwd does not exist: ${params.cwd}`);
	const result = spawnSync(codex, args, {
		cwd: params.cwd,
		stdio: "inherit",
		env: process.env,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`codex exec exited with ${result.status}`);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
