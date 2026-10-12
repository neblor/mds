/**
 * GET /api/review-queue?bankId=xxx&target=20
 * 今日队列 + 今日进度。队列不落盘，每次进来重算；卡片状态与每日汇总落盘。
 */
import { HTTPError } from "h3";
import { buildQueueForBank } from "~/lib/review-service";
import { bankStore, reviewStore } from "~/lib/runtime-stores";
import { getQuery, type RouteEvent } from "~/lib/server-body";

export function GET(event: RouteEvent) {
	const bankId = getQuery(event, "bankId");
	const target = getQuery(event, "target");
	const result = buildQueueForBank({
		bankStore,
		reviewStore,
		bankId,
		target,
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
