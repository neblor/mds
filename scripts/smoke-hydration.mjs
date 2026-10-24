#!/usr/bin/env node
/**
 * 水合回归（无头浏览器）：pnpm web:smoke:hydration
 *
 * 复现并锁死历史事故：持久化偏好里带 `mode:"bank"`（用户点过一次「词表」）时，
 * 服务端渲染「录入」界面、客户端水合却按偏好渲染「词表」界面，首帧结构不一致导致
 * Solid 水合失败，整页变成 `Error | Uncaught Client Exception` —— 重启必崩。
 *
 * 同时验证「挂载后恢复」这条链路真的可用（不只是不崩）：
 *   1. 服务端先导入一个最小的内置词表（走生产 /api/bank-import）
 *   2. 浏览器里写 mds.vocab.v1 = { mode:"bank", bankId:<该词表> }，再重载 = 二次启动
 *   3. 断言页面没有异常页，且**词表名字真的出现在界面上**
 *      （名字来自「恢复后补拉词表列表」的请求，所以这条断言也覆盖补拉逻辑）
 *
 * 为什么不用单测覆盖：Vitest（node 环境）解析到 solid-js 的 SSR 构建，onMount/effect
 * 不执行，水合与挂载恢复只能在真实浏览器里验。
 * 需要本机有 Chromium/Chrome；找不到浏览器时打印提示并跳过（退出码 0），
 * 这样在没装浏览器的机器上不会误报失败。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const startScript = join(projectRoot, "scripts", "start-web.mjs");
const smokeRoot = join(projectRoot, ".tmp", "hydration-smoke");
// 失败截图写在 .tmp 根下（smokeRoot 会在收尾时整个删掉，截图要留给排查）
const artifactDir = join(projectRoot, ".tmp");
const cacheDir = join(smokeRoot, "word-cache");
const errorText = "Uncaught Client Exception";
const VOCAB_PREFS_KEY = "mds.vocab.v1";
const SETTINGS_KEY = "mds.settings.v1";

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

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

/** 找一个可用浏览器：显式路径 > playwright 下载的 chromium > 系统 Chrome */
function findBrowserExecutable() {
	const explicit = process.env.MDS_SMOKE_BROWSER_PATH?.trim();
	if (explicit && existsSync(explicit)) return explicit;
	const playwrightRoot = join(
		process.env.HOME ?? "",
		".cache",
		"ms-playwright",
	);
	if (existsSync(playwrightRoot)) {
		const candidates = readdirSync(playwrightRoot)
			.filter((name) => name.startsWith("chromium-"))
			.sort((a, b) => b.localeCompare(a))
			.map((name) => {
				for (const sub of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
					const candidate = join(playwrightRoot, name, sub);
					if (existsSync(candidate)) return candidate;
				}
				return null;
			})
			.filter(Boolean);
		if (candidates.length > 0) return candidates[0];
	}
	for (const candidate of [
		"/usr/bin/google-chrome",
		"/usr/bin/chromium",
		"/usr/bin/chromium-browser",
	]) {
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

/** 读 JSON 文件并带上可读的错误上下文（清单/词表都可能被人改坏） */
function readJsonFile(path, label) {
	const raw = readFileSync(path, "utf8");
	try {
		return JSON.parse(raw);
	} catch (error) {
		throw new Error(`${label} 不是合法 JSON（${path}）：${error.message}`);
	}
}

/** 取最小的内置词表来导入，尽量少写磁盘、少等时间 */
function pickSmallestBundledBank() {
	const manifest = readJsonFile(
		join(projectRoot, "public", "banks", "manifest.json"),
		"内置词表清单",
	);
	const entries = (manifest.banks ?? []).filter(
		(entry) => entry?.bundled && typeof entry.id === "string",
	);
	if (entries.length === 0) throw new Error("内置词表清单为空");
	return entries.sort((a, b) => (a.count ?? 0) - (b.count ?? 0))[0];
}

const browserPath = findBrowserExecutable();
if (!browserPath) {
	console.log(
		"[hydration-smoke] 跳过：本机没有可用的 Chromium/Chrome。" +
			"可用 MDS_SMOKE_BROWSER_PATH 指定浏览器可执行文件。",
	);
	process.exit(0);
}

let chromium;
try {
	({ chromium } = await import("playwright-core"));
} catch (error) {
	console.log(`[hydration-smoke] 跳过：playwright-core 不可用（${error.message}）`);
	process.exit(0);
}

const port = await findFreePort();
rmSync(smokeRoot, { recursive: true, force: true });
mkdirSync(cacheDir, { recursive: true });

const child = spawn(
	process.execPath,
	[startScript, "--host", "127.0.0.1", "--port", String(port), "--cache-dir", cacheDir],
	{ cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"] },
);
let childOutput = "";
child.stdout.on("data", (chunk) => (childOutput += chunk));
child.stderr.on("data", (chunk) => (childOutput += chunk));

let browser;
try {
	const baseUrl = `http://127.0.0.1:${port}/`;
	let ready = false;
	for (let attempt = 0; attempt < 40 && !ready; attempt++) {
		if (child.exitCode !== null) {
			throw new Error(`Web 生产进程提前退出\n${childOutput}`);
		}
		try {
			const probe = await fetch(baseUrl);
			ready = probe.ok;
		} catch {
			// 尚未就绪，继续轮询
		}
		if (!ready) await delay(250);
	}
	if (!ready) throw new Error(`Web 生产服务未在 10 秒内就绪\n${childOutput}`);

	// 1. 服务端准备一个真实词表，让「恢复后补拉」有东西可拉
	const entry = pickSmallestBundledBank();
	const bankPayload = readJsonFile(
		join(projectRoot, "public", "banks", `${entry.id}.json`),
		`内置词表 ${entry.id}`,
	);
	const importResponse = await fetch(`${baseUrl}api/bank-import`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ bank: bankPayload }),
	});
	if (!importResponse.ok) {
		throw new Error(
			`导入内置词表失败：HTTP ${importResponse.status} ${await importResponse.text()}`,
		);
	}
	const importData = await importResponse.json().catch(() => null);
	const bankId = importData?.bank?.id;
	if (typeof bankId !== "string" || !bankId) {
		throw new Error(`导入内置词表后未拿到 bankId：${JSON.stringify(importData)}`);
	}

	// 2. 打开页面 → 写持久化偏好（模拟「上次点过词表」）→ 重载 = 二次启动
	browser = await chromium.launch({ executablePath: browserPath, headless: true });
	const context = await browser.newContext({
		viewport: { width: 1120, height: 820 },
	});
	const page = await context.newPage();
	const pageErrors = [];
	page.on("pageerror", (error) => pageErrors.push(`${error.name}: ${error.message}`));
	await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
	await page.evaluate(
		({ bankId, VOCAB_PREFS_KEY, SETTINGS_KEY }) => {
			localStorage.setItem(
				VOCAB_PREFS_KEY,
				JSON.stringify({ mode: "bank", bankId, batchSize: 10 }),
			);
			localStorage.setItem(
				SETTINGS_KEY,
				JSON.stringify({
					aiBaseUrl: "https://api.example.com/v1",
					aiApiKey: "",
					aiModel: "gpt-4o-mini",
				}),
			);
		},
		{ bankId, VOCAB_PREFS_KEY, SETTINGS_KEY },
	);
	await page.reload({ waitUntil: "networkidle" });
	await page.waitForTimeout(800);
	const bodyText = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();

	if (bodyText.includes(errorText)) {
		await page.screenshot({ path: join(artifactDir, "hydration-failure.png") });
		throw new Error(
			`二次启动水合失败（出现「${errorText}」），截图见 .tmp/hydration-failure.png\npageerror: ${pageErrors.join(" | ")}`,
		);
	}
	// 首帧形态 → 挂载后恢复：词表名字必须出现，说明偏好恢复 + 词表列表补拉都跑通了
	const bankName = bankPayload.name ?? entry.name;
	if (!bodyText.includes(bankName)) {
		await page.screenshot({ path: join(artifactDir, "hydration-restore-failure.png") });
		throw new Error(
			`偏好恢复后界面上没有词表名「${bankName}」（首帧应先是录入界面，挂载后切到词表模式）\n` +
				`当前页面文本：${bodyText.slice(0, 200)}\n截图：.tmp/hydration-restore-failure.png`,
		);
	}
	console.log(
		`[hydration-smoke] 通过：无「${errorText}」，重启后已恢复词表模式并显示「${bankName}」`,
	);
} finally {
	await browser?.close().catch(() => {});
	child.kill("SIGTERM");
	await delay(500);
	if (child.exitCode === null) child.kill("SIGKILL");
	child.stdout.destroy();
	child.stderr.destroy();
	rmSync(smokeRoot, { recursive: true, force: true });
}
