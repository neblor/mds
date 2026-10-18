/**
 * GET /api/bank-stats?bankId=xxx&days=180
 *
 * 学习档案：进度 / 使用频率 / 正确率 / 到期预测 / 重点词。
 * 只读；兼容模式（没有 SQL 统计能力）返回 503，界面显示「不影响默写」。
 */
import { HTTPError } from "h3";
import { buildBankStats } from "~/lib/bank-stats-service";
import { bankStore, reviewStore } from "~/lib/runtime-stores";
import { getQuery, type RouteEvent } from "~/lib/server-body";

const DEFAULT_DAYS = 180;
const MIN_DAYS = 30;
const MAX_DAYS = 365;

function clampDays(raw: string | undefined): number {
	const value = raw?.trim() ? Number(raw) : Number.NaN;
	if (!Number.isFinite(value)) return DEFAULT_DAYS;
	return Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.round(value)));
}

export function GET(event: RouteEvent) {
	const bankId = getQuery(event, "bankId");
	if (!bankStore.read(bankId)) {
		throw new HTTPError({
			status: 404,
			statusText: "Not Found",
			message: "词库不存在",
		});
	}
	if (!reviewStore.stats) {
		throw new HTTPError({
			status: 503,
			statusText: "Service Unavailable",
			message: "学习数据正在使用兼容模式，统计暂不可用；默写与复习不受影响",
		});
	}
	try {
		const stats = buildBankStats({
			bankStore,
			reviewStore,
			bankId,
			now: new Date(),
			days: clampDays(getQuery(event, "days")),
		});
		if (!stats) {
			throw new HTTPError({
				status: 404,
				statusText: "Not Found",
				message: "词库不存在",
			});
		}
		return stats;
	} catch (error) {
		if (error instanceof HTTPError) throw error;
		throw new HTTPError({
			status: 500,
			statusText: "Internal Server Error",
			message:
				error instanceof Error ? error.message : "无法读取学习档案",
		});
	}
}
