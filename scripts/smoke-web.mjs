import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const startScript = join(projectRoot, "scripts", "start-web.mjs");
const cacheRoot = join(projectRoot, ".tmp", "web-smoke-cache");
const cacheDir = join(cacheRoot, "word-cache");
const mediaProbeName = "smoke_000000.mp3";
const mediaProbeBytes = new Uint8Array([0x49, 0x44, 0x33, 0, 0, 0]);

function findFreePort() {
	return new Promise((resolvePort, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : 0;
			server.close((error) => (error ? reject(error) : resolvePort(port)));
		});
	});
}

function delay(ms) {
	return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function waitForChildExit(childProcess, timeoutMs) {
	if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
		return Promise.resolve(true);
	}
	return Promise.race([
		new Promise((resolveExit) =>
			childProcess.once("exit", () => resolveExit(true)),
		),
		delay(timeoutMs).then(() => false),
	]);
}

const port = await findFreePort();
rmSync(cacheRoot, { recursive: true, force: true });
mkdirSync(cacheDir, { recursive: true });
writeFileSync(join(cacheDir, mediaProbeName), mediaProbeBytes);
const child = spawn(
	process.execPath,
	[
		startScript,
		"--host",
		"127.0.0.1",
		"--port",
		String(port),
		"--cache-dir",
		cacheDir,
	],
	{
		cwd: projectRoot,
		stdio: ["ignore", "pipe", "pipe"],
	},
);

let childOutput = "";
child.stdout.on("data", (chunk) => {
	childOutput += chunk;
});
child.stderr.on("data", (chunk) => {
	childOutput += chunk;
});

try {
	let response;
	for (let attempt = 0; attempt < 40; attempt++) {
		if (child.exitCode !== null) {
			throw new Error(`Web 生产进程提前退出\n${childOutput}`);
		}
		try {
			response = await fetch(`http://127.0.0.1:${port}/`);
			if (response.ok) break;
		} catch {
			// 服务尚未就绪，继续轮询
		}
		await delay(250);
	}
	if (!response?.ok) {
		throw new Error(`Web 生产服务未在 10 秒内就绪\n${childOutput}`);
	}
	await response.arrayBuffer();
	// Electron 使用同一 Nitro 生产路由。即使浏览器把请求标为 audio，也必须动态读外置缓存。
	const mediaProbe = await fetch(
		`http://127.0.0.1:${port}/api/audio?name=${mediaProbeName}`,
		{ headers: { "sec-fetch-dest": "audio" } },
	);
	const mediaBytes = new Uint8Array(await mediaProbe.arrayBuffer());
	if (
		mediaProbe.status !== 200 ||
		mediaBytes.length !== mediaProbeBytes.length ||
		!mediaBytes.every((byte, index) => byte === mediaProbeBytes[index])
	) {
		throw new Error(
			`生产媒体路由异常：HTTP ${mediaProbe.status}, ${mediaBytes.length} bytes`,
		);
	}
	// 缺失文件仍必须由动态路由返回结构化 404。
	const cacheProbe = await fetch(
		`http://127.0.0.1:${port}/api/audio?name=missing_000000.mp3`,
	);
	await cacheProbe.arrayBuffer();
	if (cacheProbe.status !== 404) {
		throw new Error(`缓存路由探测预期 404，实际为 ${cacheProbe.status}`);
	}
	if (!existsSync(cacheDir)) {
		throw new Error("Web 生产缓存目录未按参数创建");
	}
	console.log(
		`Web production smoke passed: HTTP ${response.status}, cache: ${cacheDir}`,
	);
} finally {
	child.kill("SIGTERM");
	const exited = await waitForChildExit(child, 2_000);
	if (!exited) {
		child.kill("SIGKILL");
		await waitForChildExit(child, 2_000);
	}
	child.stdout.destroy();
	child.stderr.destroy();
	rmSync(cacheRoot, { recursive: true, force: true });
}
