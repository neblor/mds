/** Client 运行时诊断日志；Web 模式保持无副作用。 */
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	renameSync,
	rmSync,
	statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { cacheDir, runtimeMode, type RuntimeMode } from "./word-cache";

export interface RuntimeDiagnosticEntry {
	event: string;
	level: "warning" | "error";
	details: Record<string, unknown>;
}

export interface RuntimeDiagnosticLogger {
	readonly filePath?: string;
	write(entry: RuntimeDiagnosticEntry): void;
}

function sanitizeEndpoint(value: string): string {
	try {
		const url = new URL(value);
		url.username = "";
		url.password = "";
		url.search = "";
		url.hash = "";
		return url.toString();
	} catch {
		return value;
	}
}

function sanitizeDetails(details: Record<string, unknown>) {
	const sanitized = new Map<string, unknown>();
	for (const [key, value] of Object.entries(details)) {
		if (key.toLowerCase().includes("key")) {
			sanitized.set(key, "[redacted]");
		} else if (key === "endpoint" && typeof value === "string") {
			sanitized.set(key, sanitizeEndpoint(value));
		} else {
			sanitized.set(key, value);
		}
	}
	// Object.fromEntries 会把 __proto__ 当普通字段保留；直接给对象赋值会把它吞掉。
	return Object.fromEntries(sanitized);
}

/** 日志文件名：里面早已不止 AI 释义（还有 TTS 等），2026-11-15 由 `ai-definitions.log` 改名。 */
const LOG_FILE = "runtime.log";
const LEGACY_LOG_FILE = "ai-definitions.log";

/**
 * 旧日志按「当前 / 轮换」分别搬迁，不覆盖任何已有 runtime 文件。
 * 目标已存在时保留旧文件，避免把较新的日志顶掉；单个文件失败不妨碍另一个迁移。
 */
function migrateLegacyLog(logDir: string): void {
	const current = join(logDir, LOG_FILE);
	const legacy = join(logDir, LEGACY_LOG_FILE);
	for (const suffix of ["", ".1"]) {
		const source = `${legacy}${suffix}`;
		const target = `${current}${suffix}`;
		try {
			if (existsSync(source) && !existsSync(target)) renameSync(source, target);
		} catch {
			// 诊断日志迁移失败不得影响默写；保留源文件供下次或人工处理。
		}
	}
}

export function createRuntimeDiagnosticLogger(options: {
	mode: RuntimeMode;
	cacheRoot: string;
	maxBytes?: number;
}): RuntimeDiagnosticLogger {
	if (options.mode !== "client") {
		return { write: () => {} };
	}
	const logDir = join(dirname(options.cacheRoot), "logs");
	const filePath = join(logDir, LOG_FILE);
	const rotatedPath = `${filePath}.1`;
	const maxBytes = options.maxBytes ?? 1024 * 1024;
	return {
		filePath,
		write(entry) {
			try {
				mkdirSync(logDir, { recursive: true });
				migrateLegacyLog(logDir);
				if (existsSync(filePath) && statSync(filePath).size >= maxBytes) {
					rmSync(rotatedPath, { force: true });
					renameSync(filePath, rotatedPath);
				}
				appendFileSync(
					filePath,
					`${JSON.stringify({
						timestamp: new Date().toISOString(),
						level: entry.level,
						event: entry.event,
						details: sanitizeDetails(entry.details),
					})}\n`,
					"utf8",
				);
			} catch {
				// 诊断日志本身失败不得影响默写流程。
			}
		},
	};
}

export const runtimeDiagnosticLogger = createRuntimeDiagnosticLogger({
	mode: runtimeMode,
	cacheRoot: cacheDir,
});
