import { afterEach, describe, expect, it } from "vitest";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createRuntimeDiagnosticLogger } from "./runtime-logger";

const root = "/tmp/mds-runtime-logger-test/mds-data/word-cache";

afterEach(() => rmSync("/tmp/mds-runtime-logger-test", { recursive: true, force: true }));

describe("runtime diagnostic logger", () => {
	it("Client 写入 mds-data/logs，并清除 endpoint 查询参数和 key 字段", () => {
		const logger = createRuntimeDiagnosticLogger({ mode: "client", cacheRoot: root });
		logger.write({
			event: "request-failed",
			level: "error",
			details: {
				endpoint: "https://user:pass@example.test/v1?token=secret",
				apiKey: "secret",
			},
		});
		const file = join("/tmp/mds-runtime-logger-test/mds-data/logs", "runtime.log");
		const content = readFileSync(file, "utf8");
		expect(content).toContain('"event":"request-failed"');
		expect(content).toContain("https://example.test/v1");
		expect(content).toContain("[redacted]");
		expect(content).not.toContain("secret");
		expect(content).not.toContain("user:pass");
	});

	it("Web 模式不创建日志", () => {
		const logger = createRuntimeDiagnosticLogger({ mode: "web", cacheRoot: root });
		logger.write({ event: "x", level: "error", details: {} });
		expect(logger.filePath).toBeUndefined();
	});

	it("日志超过限制后保留一份轮换文件", () => {
		const logger = createRuntimeDiagnosticLogger({
			mode: "client",
			cacheRoot: root,
			maxBytes: 1,
		});
		logger.write({ event: "first", level: "error", details: {} });
		logger.write({ event: "second", level: "warning", details: {} });
		const logDir = "/tmp/mds-runtime-logger-test/mds-data/logs";
		expect(readFileSync(join(logDir, "runtime.log"), "utf8")).toContain(
			'"event":"second"',
		);
		expect(readFileSync(join(logDir, "runtime.log.1"), "utf8")).toContain(
			'"event":"first"',
		);
	});

	it("旧日志 ai-definitions.log 自动搬到 runtime.log", () => {
		const logDir = join("/tmp/mds-runtime-logger-test/mds-data/logs");
		mkdirSync(logDir, { recursive: true });
		writeFileSync(join(logDir, "ai-definitions.log"), '{"event":"legacy"}\n');
		writeFileSync(join(logDir, "ai-definitions.log.1"), '{"event":"legacy-old"}\n');
		const logger = createRuntimeDiagnosticLogger({ mode: "client", cacheRoot: root });
		logger.write({ event: "fresh", level: "error", details: {} });
		expect(readFileSync(join(logDir, "runtime.log"), "utf8")).toContain(
			'"event":"legacy"',
		);
		expect(readFileSync(join(logDir, "runtime.log.1"), "utf8")).toContain(
			'"event":"legacy-old"',
		);
		expect(existsSync(join(logDir, "ai-definitions.log"))).toBe(false);
	});
});
