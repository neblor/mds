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

	it("脱敏保留 __proto__ 等普通数据字段", () => {
		const logger = createRuntimeDiagnosticLogger({ mode: "client", cacheRoot: root });
		const details = JSON.parse('{"__proto__":{"polluted":true},"normal":"ok"}');
		logger.write({ event: "special-key", level: "warning", details });
		const content = readFileSync(
			join("/tmp/mds-runtime-logger-test/mds-data/logs", "runtime.log"),
			"utf8",
		);
		const entry = JSON.parse(content);
		expect(Object.hasOwn(entry.details, "__proto__")).toBe(true);
		expect(entry.details.normal).toBe("ok");
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
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

	it("runtime.log 已存在时仍补齐缺失的旧轮换文件", () => {
		const logDir = join("/tmp/mds-runtime-logger-test/mds-data/logs");
		mkdirSync(logDir, { recursive: true });
		writeFileSync(join(logDir, "runtime.log"), "current\n");
		writeFileSync(join(logDir, "ai-definitions.log.1"), "legacy-rotated\n");
		const logger = createRuntimeDiagnosticLogger({ mode: "client", cacheRoot: root });
		logger.write({ event: "fresh", level: "error", details: {} });
		expect(readFileSync(join(logDir, "runtime.log.1"), "utf8")).toBe(
			"legacy-rotated\n",
		);
		expect(existsSync(join(logDir, "ai-definitions.log.1"))).toBe(false);
	});

	it("目标文件已存在时不覆盖新日志，旧源文件保留待处理", () => {
		const logDir = join("/tmp/mds-runtime-logger-test/mds-data/logs");
		mkdirSync(logDir, { recursive: true });
		writeFileSync(join(logDir, "runtime.log"), "current\n");
		writeFileSync(join(logDir, "runtime.log.1"), "current-rotated\n");
		writeFileSync(join(logDir, "ai-definitions.log"), "legacy\n");
		writeFileSync(join(logDir, "ai-definitions.log.1"), "legacy-rotated\n");
		const logger = createRuntimeDiagnosticLogger({ mode: "client", cacheRoot: root });
		logger.write({ event: "fresh", level: "error", details: {} });
		expect(readFileSync(join(logDir, "runtime.log"), "utf8")).toContain("current");
		expect(readFileSync(join(logDir, "runtime.log"), "utf8")).not.toContain("legacy");
		expect(readFileSync(join(logDir, "runtime.log.1"), "utf8")).toBe(
			"current-rotated\n",
		);
		expect(existsSync(join(logDir, "ai-definitions.log"))).toBe(true);
		expect(existsSync(join(logDir, "ai-definitions.log.1"))).toBe(true);
	});
});
