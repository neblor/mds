/**
 * POST /api/bank-remove — 删除词表 { bankId }
 * 同时清除该词表的复习进度与日志（删词表 = 连带数据一起删，避免遗留孤儿文件）。
 */
import { HTTPError } from "h3";
import { bankStore } from "~/lib/runtime-stores";
import { reviewStore } from "~/lib/runtime-stores";
import { readJsonBody, type RouteEvent } from "~/lib/server-body";

export async function POST(event: RouteEvent) {
	const body = await readJsonBody(event);
	const holder = (body ?? {}) as { bankId?: unknown };
	const bankId = typeof holder.bankId === "string" ? holder.bankId : "";
	const removed = bankStore.remove(bankId);
	if (!removed) {
		throw new HTTPError({
			status: 404,
			statusText: "Not Found",
			message: "词库不存在",
		});
	}
	reviewStore.removeBankState(bankId);
	return { ok: true, bankId };
}
