/**
 * `scripts/get-explain.mjs` 回归测试（真实子进程 + 本地 stub AI 服务）
 *
 * 为什么要有这个文件：该脚本曾有一个只有「真正跑起来」才会暴露的 bug ——
 * 顶层 dispatch 写在 `const baseUrl / apiKey / model` 之前，于是任意实际调用
 * provider 的命令都命中 TDZ：
 *   ReferenceError: Cannot access 'baseUrl' before initialization
 * `--help`、空参数这些只打用法的分支侥幸不触发，所以静态看代码一切正常。
 *
 * 因此这里不 mock 内部函数，而是 spawn 真实子进程 + 起一个本地 HTTP stub 扮演
 * OpenAI 兼容端点，覆盖三条路径：
 *   1. 正常出释义（证明配置能传到 provider，且整条链路可跑通）
 *   2. 上游 500（证明错误被规范化成 provider 的 http 错误，而不是 ReferenceError）
 *   3. 缺配置（证明配置校验仍在、且不会误伤 --help）
 * 子进程的 `MDS_AI_*` 由本文件显式注入：`process.loadEnvFile()` 不覆盖已有环境变量，
 * 所以测试不会读到项目 .env 的真实 Key，也不会发出真实网络请求。
 */
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage } from "node:http";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = resolve(import.meta.dirname, "../../scripts/get-explain.mjs");
const WORDS = ["apple", "banana"];

/** 起一个本地 OpenAI 兼容 stub，返回固定的英文释义映射 */
async function startStub(
	respond: (req: IncomingMessage, body: string) => { status: number; body: string },
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
	const server = createServer((req, res) => {
		let raw = "";
		req.on("data", (chunk) => {
			raw += String(chunk);
		});
		req.on("end", () => {
			const { status, body } = respond(req, raw);
			res.writeHead(status, { "content-type": "application/json" });
			res.end(body);
		});
	});
	await new Promise<void>((resolve_) => server.listen(0, "127.0.0.1", resolve_));
	const address = server.address();
	if (address === null || typeof address === "string") {
		throw new Error("stub 服务未取得端口");
	}
	return {
		baseUrl: `http://127.0.0.1:${address.port}/v1`,
		close: () =>
			new Promise<void>((resolve_) => {
				server.close(() => resolve_());
			}),
	};
}

/**
 * 必须用异步 spawn：spawnSync 会阻塞宿主进程的事件循环，
 * 而同进程里的 stub 服务需要事件循环才能应答子进程请求——会直接死锁。
 */
function runScript(
	args: string[],
	env: Record<string, string>,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
	return new Promise((resolve_) => {
		const child = spawn(process.execPath, [scriptPath, ...args], {
			env: { ...process.env, ...env },
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => {
			stdout += String(chunk);
		});
		child.stderr.on("data", (chunk) => {
			stderr += String(chunk);
		});
		const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
		child.on("close", (status) => {
			clearTimeout(timer);
			resolve_({ status, stdout, stderr });
		});
	});
}

describe("scripts/get-explain.mjs", () => {
	it("能从 AI stub 取回释义并正常退出（守住 TDZ 回归）", async () => {
		const stub = await startStub(() => ({
			status: 200,
			body: JSON.stringify({
				choices: [
					{
						message: {
							content: JSON.stringify({
								apple: "A round sweet fruit.",
								banana: "A long curved yellow fruit.",
							}),
						},
					},
				],
			}),
		}));
		try {
			const run = await runScript(WORDS, {
				MDS_AI_BASE_URL: stub.baseUrl,
				MDS_AI_API_KEY: "test-key",
				MDS_AI_MODEL: "test-model",
			});

			expect(run.stderr).not.toContain("before initialization");
			expect(run.status).toBe(0);

			const payload = JSON.parse(run.stdout) as {
				definitions: Record<string, string>;
				missing: string[];
			};
			expect(Object.keys(payload.definitions)).toEqual(WORDS);
			expect(payload.definitions.apple).toBe("A round sweet fruit.");
			expect(payload.missing).toEqual([]);
		} finally {
			await stub.close();
		}
	});

	it("上游报错时报 provider 错误码，而不是 ReferenceError", async () => {
		const stub = await startStub(() => ({
			status: 500,
			body: JSON.stringify({ error: { message: "boom" } }),
		}));
		try {
			const run = await runScript(["apple"], {
				MDS_AI_BASE_URL: stub.baseUrl,
				MDS_AI_API_KEY: "test-key",
				MDS_AI_MODEL: "test-model",
			});

			expect(run.status).toBe(1);
			expect(run.stderr).not.toContain("before initialization");

			const payload = JSON.parse(run.stderr) as {
				error: string;
				code?: string;
			};
			expect(payload.code).toBe("http");
			expect(payload.error).not.toBe("ReferenceError");
		} finally {
			await stub.close();
		}
	});

	it("缺配置时提示配置项；--help 不受配置影响", async () => {
		const missing = await runScript(["apple"], {
			MDS_AI_BASE_URL: "",
			MDS_AI_API_KEY: "",
			MDS_AI_MODEL: "",
		});
		expect(missing.status).toBe(1);
		expect(missing.stderr).toContain("MDS_AI_BASE_URL");

		const help = await runScript(["--help"], {
			MDS_AI_BASE_URL: "",
			MDS_AI_API_KEY: "",
			MDS_AI_MODEL: "",
		});
		expect(help.status).toBe(0);
		expect(help.stdout).toContain("pnpm get:explain");
	});
});
