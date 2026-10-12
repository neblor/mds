/**
 * GET  /api/banks — 本地已导入的词库列表（摘要）
 * POST /api/banks — 新建自建词表 { name, words?: string | string[] }
 *
 * 「从网上抓」不在这里：内置词库是随包发布的静态文件（/banks/<id>.json），
 * 前端直接 fetch 静态资源后走 /api/bank-import 入库——服务端因此不需要知道
 * public 目录在 dev / .output / 打包后的具体位置。
 */
import { randomUUID } from "node:crypto";
import { HTTPError } from "h3";
import { bankSummary } from "~/lib/bank-store";
import { bankStore } from "~/lib/runtime-stores";
import { parseEntries, parseImportedText } from "~/lib/bank-parse";
import type { WordBank } from "~/lib/bank-types";
import { readJsonBody, type RouteEvent } from "~/lib/server-body";

export function GET() {
	return { banks: bankStore.list() };
}

function entriesFromInput(raw: unknown) {
	if (typeof raw === "string") return parseImportedText(raw).entries;
	return parseEntries(raw ?? []).entries;
}

export async function POST(event: RouteEvent) {
	const body = await readJsonBody(event);
	const holder = (body ?? {}) as { name?: unknown; words?: unknown };
	const name =
		typeof holder.name === "string" ? holder.name.trim().slice(0, 60) : "";
	if (!name) {
		throw new HTTPError({
			status: 400,
			statusText: "Bad Request",
			message: "词表名称不能为空",
		});
	}
	const now = Date.now();
	const bank: WordBank = {
		id: `custom-${randomUUID().slice(0, 8)}`,
		name,
		source: "custom",
		version: 1,
		entries: entriesFromInput(holder.words),
		createdAt: now,
		updatedAt: now,
	};
	bankStore.write(bank);
	return { bank: bankSummary(bank) };
}
