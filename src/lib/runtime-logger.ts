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

function sanitizeEndpoint(value: unknown): unknown {
	if (typeof value !== "string") return value;
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
	const sanitized: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(details)) {
		if (key.toLowerCase().includes("key")) {
			sanitized[key] = "[redacted]";
		} else if (key === "endpoint") {
			sanitized[key] = sanitizeEndpoint(value);
		} else {
			sanitized[key] = value;
		}
	}
	return sanitized;
}

/** 日志文件名：里面早已不止 AI 释义（还有 TTS 等），2026-11-15 由 `ai-definitions.log` 改名。 */
const LOG_FILE = "runtime.log";
const LEGACY_LOG_FILE = "ai-definitions.log";

/** 旧日志无缝搬过来；迁移失败不影响写日志（新文件从头写）。 */
function migrateLegacyLog(logDir: string): void {
	const current = join(logDir, LOG_FILE);
	if (existsSync(current)) return;
	const legacy = join(logDir, LEGACY_LOG_FILE);
	try {
		if (existsSync(legacy)) renameSync(legacy, current);
		if (existsSync(`${legacy}.1`)) renameSync(`${legacy}.1`, `${current}.1`);
	} catch {
		// 尽力而为：失败就当没有历史日志。
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
