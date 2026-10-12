/**
 * GET /api/bank-manifest?url=... — 拉取并解析自定义词库清单（见 plans/wordbank-srs-cloze.md D3-2）
 *
 * 只做参数校验与 HTTP 适配：地址白名单/SSRF 防护与体积限制在 remote-fetch，
 * 清单形状校验在 bank-catalog（纯函数）。失败返回 { error, message }，由界面提示。
 * 日志不记录 URL 本身（可能含私有 token），只记错误类别。
 */
import { HTTPError } from "h3";
import { MAX_MANIFEST_BYTES, parseBankManifest } from "~/lib/bank-catalog";
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
		const raw = await fetchRemoteJson({ url, maxBytes: MAX_MANIFEST_BYTES });
		return { banks: parseBankManifest(raw, url) };
	} catch (error) {
		if (error instanceof RemoteFetchError) {
			runtimeDiagnosticLogger.write({
				event: "bank-manifest-failed",
				level: "warning",
				details: { code: error.code, message: error.message },
			});
			return { error: error.code, message: error.message };
		}
		runtimeDiagnosticLogger.write({
			event: "bank-manifest-failed",
			level: "error",
			details: { message: error instanceof Error ? error.message : String(error) },
		});
		return { error: "network", message: "拉取清单失败，请重试" };
	}
}
