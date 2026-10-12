/**
 * POST /api/bank-update — 编辑词表 { bankId, name?, add?, remove? }
 *
 * - 只有自建词表可改名（资源词表只读：要改先「复制为自建词表」，走 /api/bank-import）
 * - add 支持字符串（按行/逗号解析）或字符串数组；remove 为要删的词
 * - 增删都自动去重（大小写不敏感），返回真实新增/重复/删除数
 */
import { HTTPError } from "h3";
import { bankSummary } from "~/lib/bank-store";
import { bankStore } from "~/lib/runtime-stores";
import {
	mergeEntries,
	parseEntries,
	parseImportedText,
	removeWords,
} from "~/lib/bank-parse";
import { isEditableSource } from "~/lib/bank-types";
import { readJsonBody, type RouteEvent } from "~/lib/server-body";

export async function POST(event: RouteEvent) {
	const body = await readJsonBody(event);
	const holder = (body ?? {}) as {
		bankId?: unknown;
		name?: unknown;
		add?: unknown;
		remove?: unknown;
	};
	const bankId = typeof holder.bankId === "string" ? holder.bankId : "";
	const bank = bankStore.read(bankId);
	if (!bank) {
		throw new HTTPError({
			status: 404,
			statusText: "Not Found",
			message: "词库不存在",
		});
	}

	const name =
		typeof holder.name === "string" ? holder.name.trim().slice(0, 60) : "";
	if (name && !isEditableSource(bank.source)) {
		throw new HTTPError({
			status: 400,
			statusText: "Bad Request",
			message: "资源词表不可编辑，请先复制为自建词表",
		});
	}

	const incoming = Array.isArray(holder.add)
		? parseEntries(holder.add).entries
		: typeof holder.add === "string"
			? parseImportedText(holder.add).entries
			: [];
	const dropped = Array.isArray(holder.remove)
		? holder.remove.filter((word): word is string => typeof word === "string")
		: [];

	const merged = mergeEntries(bank.entries, incoming);
	const cleaned = removeWords(merged.entries, dropped);
	const next = {
		...bank,
		name: name || bank.name,
		entries: cleaned.entries,
		updatedAt: Date.now(),
	};
	bankStore.write(next);
	return {
		bank: bankSummary(next),
		added: merged.added,
		duplicated: merged.duplicated,
		removed: cleaned.removed,
		overflow: merged.overflow,
	};
}
