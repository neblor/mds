/**
 * GET /api/bank-remote?url=... — 拉取远端清单里的词库文件（交给 /api/bank-import 落库）
 *
 * 与清单同一套 SSRF 防护与体积上限；只透传 JSON，不信任内容
 * （词库结构由 bank-import 校验）。日志不记录 URL（可能含私有 token）。
 */
import { HTTPError } from "h3";
import { MAX_BANK_FILE_BYTES } from "~/lib/bank-catalog";
import { RemoteFetchError, fetchRemoteJson } from "~/lib/remote-fetch";
import { runtimeDiagnosticLogger } from "~/lib/runtime-logger";
import { getQuery, type RouteEvent } from "~/lib/server-body";

export async function GET(event: RouteEvent) {
	const url = getQuery(event, "url").trim();
	if (!url) {
		throw new HTTPError({
			status: 400,
			statusText: "Bad Request",
			message: "url 不能为空",
		});
	}
	try {
		const payload = await fetchRemoteJson({ url, maxBytes: MAX_BANK_FILE_BYTES });
		// 远端文件里的 source 字段不可信：统一标成 remote（只读资源词表，需复制才能改）
		const bank =
			payload && typeof payload === "object"
				? { ...(payload as Record<string, unknown>), source: "remote" }
				: payload;
		return { bank };
	} catch (error) {
		if (error instanceof RemoteFetchError) {
			runtimeDiagnosticLogger.write({
				event: "bank-remote-failed",
				level: "warning",
				details: { code: error.code, message: error.message },
			});
			return { error: error.code, message: error.message };
		}
		runtimeDiagnosticLogger.write({
			event: "bank-remote-failed",
			level: "error",
			details: { message: error instanceof Error ? error.message : String(error) },
		});
		return { error: "network", message: "下载词库失败，请重试" };
	}
}
