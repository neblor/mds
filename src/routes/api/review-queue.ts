/**
 * GET /api/review-queue?bankId=xxx&size=20
 *
 * 取一批词（「本次取几个」= size，服务端夹到 5–30）+ 本批进度。
 * 队列不落盘，每次进来重算；卡片状态与每日汇总落盘。
 * `target` 是 2026-10-24 之前的旧参数名，保留兼容。
 */
import { HTTPError } from "h3";
import { buildQueueForBank } from "~/lib/review-service";
import { bankStore, reviewStore } from "~/lib/runtime-stores";
import { getQuery, type RouteEvent } from "~/lib/server-body";

export function GET(event: RouteEvent) {
	const bankId = getQuery(event, "bankId");
	// getQuery 缺省返回空字符串（不是 null）；用 || 才能真正兼容旧 target。
	const size = getQuery(event, "size") || getQuery(event, "target");
	const result = buildQueueForBank({
		bankStore,
		reviewStore,
		bankId,
		size,
		now: new Date(),
	});
	if (!result) {
		throw new HTTPError({
			status: 404,
			statusText: "Not Found",
			message: "词库不存在",
		});
	}
	return result;
}
