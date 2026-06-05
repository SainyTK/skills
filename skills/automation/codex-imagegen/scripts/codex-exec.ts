import { spawnSync } from "node:child_process";

export function findCodex(): string {
	if (process.env.CODEX_BIN) return process.env.CODEX_BIN;
	const probe = spawnSync("codex", ["--version"], { stdio: "ignore" });
	if (!probe.error) return "codex";
	throw new Error("Image generation backend not available. Set CODEX_BIN=/path/to/backend if needed.");
}

export function createCodexExecCommand(cwd: string, prompt: string): string[] {
	return [
		findCodex(),
		"exec",
		"--cd",
		cwd,
		"--sandbox",
		"workspace-write",
		"--skip-git-repo-check",
		prompt,
	];
}
