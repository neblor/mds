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
	return Object.fromEntries(
		Object.entries(details).map(([key, value]) => [
			key,
			key.toLowerCase().includes("key")
				? "[redacted]"
				: key === "endpoint"
					? sanitizeEndpoint(value)
					: value,
		]),
	);
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
	const filePath = join(logDir, "ai-definitions.log");
	const rotatedPath = `${filePath}.1`;
	const maxBytes = options.maxBytes ?? 1024 * 1024;
	return {
		filePath,
		write(entry) {
			try {
				mkdirSync(logDir, { recursive: true });
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
