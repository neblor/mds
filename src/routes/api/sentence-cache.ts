/**
 * POST /api/sentence-cache — 失效若干词的短句缓存（「更新短句」按钮）
 * { words: string[] } → { removed: number }
 *
 * 只删缓存里这些词的条目，其余词与 model/contentLevel 保留；下次准备时这些词会重新
 * 向 AI 生句。队列之外没有缓存条目时返回 removed=0，不算错误。
 */
import { HTTPError } from "h3";
import { runtimeCache } from "~/lib/cache-storage";
import { extractWords, readJsonBody, type RouteEvent } from "~/lib/server-body";

/** 一次最多清 200 个词（与队列上限 200 对齐，避免被当成批量删除接口） */
const MAX_WORDS = 200;

export async function POST(event: RouteEvent) {
	const body = await readJsonBody(event);
	const words = extractWords(body).slice(0, MAX_WORDS);
	if (words.length === 0) {
		throw new HTTPError({
			status: 400,
			statusText: "Bad Request",
			message: "words 不能为空",
		});
	}
	return { removed: runtimeCache.removeSentences(words) };
}
