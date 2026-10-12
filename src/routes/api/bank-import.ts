/**
 * POST /api/bank-import — 导入/复制整库 { bank?, copyOf?, rename? }
 *
 * 三种来源：
 * - 内置资源词表：前端 fetch("/banks/<id>.json")（同源静态资源）
 * - 用户本地文件：前端读文件内容后 POST 过来（JSON 词库）
 * - 服务端复制：{ copyOf: bankId }（资源词表只读 → 「复制为自建词表」走这里，
 *   不用把几千词搬到浏览器再搬回去）
 * 形状一律过 parseBankFile：id 不合法或缺失时给一个新 id；脏文件不会写坏目录。
 */
import { randomUUID } from "node:crypto";
import { HTTPError } from "h3";
import { bankSummary } from "~/lib/bank-store";
import { bankStore } from "~/lib/runtime-stores";
import { parseBankFile } from "~/lib/bank-parse";
import { readJsonBody, type RouteEvent } from "~/lib/server-body";

export async function POST(event: RouteEvent) {
	const body = await readJsonBody(event);
	const holder = (body ?? {}) as {
		bank?: unknown;
		rename?: unknown;
		copyOf?: unknown;
	};
	const rename =
		typeof holder.rename === "string" ? holder.rename.trim().slice(0, 60) : "";

	if (typeof holder.copyOf === "string" && holder.copyOf.trim()) {
		const source = bankStore.read(holder.copyOf.trim());
		if (!source) {
			throw new HTTPError({
				status: 404,
				statusText: "Not Found",
				message: "源词库不存在",
			});
		}
		const now = Date.now();
		const copy = {
			...source,
			id: `custom-${randomUUID().slice(0, 8)}`,
			name: rename || `${source.name} 副本`,
			source: "custom" as const,
			createdAt: now,
			updatedAt: now,
			note: `复制自 ${source.name}`,
		};
		bankStore.write(copy);
		return { bank: bankSummary(copy) };
	}

	const fallbackId = `custom-${randomUUID().slice(0, 8)}`;
	const parsed = parseBankFile(holder.bank, fallbackId);
	if (!parsed) {
		throw new HTTPError({
			status: 400,
			statusText: "Bad Request",
			message: "词库文件格式不正确",
		});
	}
	if (parsed.entries.length === 0) {
		throw new HTTPError({
			status: 400,
			statusText: "Bad Request",
			message: "词库里没有可用的词条",
		});
	}
	const bank = {
		...parsed,
		name: rename || parsed.name,
		updatedAt: Date.now(),
	};
	bankStore.write(bank);
	return { bank: bankSummary(bank) };
}
