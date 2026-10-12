/**
 * `scripts/get-cloze.mjs` 回归测试（真实子进程 + 本地 stub AI 服务）
 *
 * 与 get-explain 同一套路：不 mock 内部函数，而起一个本地 OpenAI 兼容 stub，
 * 覆盖三条路径：
 *   1. 正常出题（证明配置能传到 provider、整条链路可跑通，且输出含耗时/覆盖诊断）
 *   2. 上游返回不符合契约的题目（证明按「AI 当前不可用」口径报错，而不是崩栈）
 *   3. 缺配置（证明配置校验仍在，且不会误伤 --help）
 * 子进程的 MDS_AI_* 由本文件显式注入，不会读项目 .env 的真实 Key，也不会发出真实网络请求。
 */
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage } from "node:http";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = resolve(import.meta.dirname, "../../scripts/get-cloze.mjs");
const WORDS = ["apple", "orange", "knowledge", "practice"];

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

/** 必须异步 spawn：spawnSync 会阻塞事件循环，同进程的 stub 服务无法应答子进程 */
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


/** 子进程可能先打印 Node 警告，这里只取第一段 JSON */
function parseJsonOutput(text: string): unknown {
	const start = text.indexOf("{");
	if (start < 0) throw new Error(`输出里没有 JSON：${text.slice(0, 200)}`);
	return JSON.parse(text.slice(start));
}

const VALID_ITEMS = {
	items: [
		{
			id: 1,
			sentences: ["I like to eat ##1 after lunch.", "She bought an ##2."],
			blanks: [
				{ index: 1, answer: "apple" },
				{ index: 2, answer: "orange" },
			],
			usedWords: ["apple", "orange"],
		},
	],
};

function chatResponse(content: unknown, status = 200) {
	return {
		status,
		body: JSON.stringify({ choices: [{ message: { content } }] }),
	};
}

describe("scripts/get-cloze.mjs", () => {
	it("能从 AI stub 出题并打印题目与诊断（守住配置链路回归）", async () => {
		const stub = await startStub(() =>
			chatResponse(JSON.stringify(VALID_ITEMS)),
		);
		try {
			const run = await runScript(WORDS, {
				MDS_AI_BASE_URL: stub.baseUrl,
				MDS_AI_API_KEY: "test-key",
				MDS_AI_MODEL: "test-model",
			});

			expect(run.stderr).not.toContain("before initialization");
			expect(run.status).toBe(0);
			expect(run.stdout).not.toContain("test-key");

			const payload = parseJsonOutput(run.stdout) as {
				items: { sentences: string[] }[];
				summary: { itemCount: number; blankCount: number; answerWords: string[] };
				diagnostics: { model: string; returnedCount: number; elapsedMs: number };
			};
			expect(payload.items).toHaveLength(1);
			expect(payload.summary).toMatchObject({
				itemCount: 1,
				blankCount: 2,
				answerWords: ["apple", "orange"],
			});
			expect(payload.diagnostics.model).toBe("test-model");
			expect(payload.diagnostics.returnedCount).toBe(1);
			expect(typeof payload.diagnostics.elapsedMs).toBe("number");
		} finally {
			await stub.close();
		}
	});

	it("题目不符合契约时报 invalid-response 与具体原因", async () => {
		const stub = await startStub(() =>
			chatResponse(
				JSON.stringify({
					items: [
						{
							sentences: ["I like ##1.", "Second ##2."],
							blanks: [
								{ index: 1, answer: "made-up-word" },
								{ index: 2, answer: "orange" },
							],
							usedWords: ["made-up-word", "orange"],
						},
					],
				}),
			),
		);
		try {
			const run = await runScript(WORDS, {
				MDS_AI_BASE_URL: stub.baseUrl,
				MDS_AI_API_KEY: "test-key",
				MDS_AI_MODEL: "test-model",
			});

			expect(run.status).toBe(1);
			expect(run.stderr).not.toContain("before initialization");
			const payload = parseJsonOutput(run.stderr) as { code?: string; message: string };
			expect(payload.code).toBe("invalid-response");
			expect(payload.message).toContain("不符合要求");
		} finally {
			await stub.close();
		}
	});

	it("上游 500 报 http 错误码", async () => {
		const stub = await startStub(() =>
			chatResponse("boom", 500),
		);
		try {
			const run = await runScript(["apple"], {
				MDS_AI_BASE_URL: stub.baseUrl,
				MDS_AI_API_KEY: "test-key",
				MDS_AI_MODEL: "test-model",
			});
			expect(run.status).toBe(1);
			const payload = parseJsonOutput(run.stderr) as { code?: string };
			expect(payload.code).toBe("http");
		} finally {
			await stub.close();
		}
	});

	it("缺配置时给出可执行提示；--help 不受影响", async () => {
		const missing = await runScript(WORDS, {
			MDS_AI_BASE_URL: "",
			MDS_AI_API_KEY: "",
		});
		expect(missing.status).toBe(1);
		expect(missing.stderr).toContain("MDS_AI_BASE_URL");

		const help = await runScript(["--help"], {
			MDS_AI_BASE_URL: "",
			MDS_AI_API_KEY: "",
		});
		expect(help.status).toBe(0);
		expect(help.stdout).toContain("pnpm get:cloze");
	});
});
