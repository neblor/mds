import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = join(projectRoot, ".tmp", "vitest");
const vitestEntry = join(projectRoot, "node_modules", "vitest", "vitest.mjs");
mkdirSync(tempDir, { recursive: true });

const child = spawn(process.execPath, [vitestEntry, ...process.argv.slice(2)], {
	cwd: projectRoot,
	stdio: "inherit",
	env: {
		...process.env,
		// 避免 WSL 中继承 Windows TEMP 后，Vite/Vitest 临时目录被并发清理或解析失败。
		TEMP: tempDir,
		TMP: tempDir,
		TMPDIR: tempDir,
	},
});

child.on("error", (error) => {
	console.error(`无法启动 Vitest：${error.message}`);
	process.exitCode = 1;
});

child.on("exit", (code, signal) => {
	if (signal) {
		console.error(`Vitest 被信号 ${signal} 中止`);
		process.exitCode = 1;
		return;
	}
	process.exitCode = code ?? 1;
});
