/**
 * server-body.ts 单元测试：请求体解析、单词提取、缓存文件响应校验
 * 重点：任何非法输入都走 400/404 或空结果，不抛未处理异常
 */
import { describe, expect, it } from "vitest";
import {
	readJsonBody,
	getParam,
	extractWords,
	serveCacheFile,
	type RouteEvent,
} from "./server-body";

const ev = (body: string): RouteEvent => ({
	request: new Request("http://x/api/definitions", {
		method: "POST",
		body,
	}),
	params: {},
});

describe("readJsonBody", () => {
	it("正常 JSON", async () => {
		expect(await readJsonBody(ev('{"words":["a"]}'))).toEqual({ words: ["a"] });
	});

	it("空 body 返回 {}", async () => {
		expect(await readJsonBody(ev(""))).toEqual({});
	});

	it("坏 JSON 返回 {} 不抛错", async () => {
		expect(await readJsonBody(ev("not json {{{"))).toEqual({});
	});

	it("非 JSON 内容（HTML）返回 {}", async () => {
		expect(await readJsonBody(ev("<html>error</html>"))).toEqual({});
	});
});

describe("getParam", () => {
	it("存在返回字符串，缺失返回空串", () => {
		const e: RouteEvent = {
			request: null as unknown as Request,
			params: { name: "a.mp3" },
		};
		expect(getParam(e, "name")).toBe("a.mp3");
		expect(getParam(e, "missing")).toBe("");
		expect(
			getParam({ request: null as unknown as Request, params: {} }, "x"),
		).toBe("");
	});
});

describe("extractWords", () => {
	it("提取 + 去重 + trim", () => {
		expect(extractWords({ words: [" a ", "b", "a", "  ", "b"] })).toEqual([
			"a",
			"b",
		]);
	});

	it("非数组/空/非法结构返回 []", () => {
		expect(extractWords({})).toEqual([]);
		expect(extractWords(null)).toEqual([]);
		expect(extractWords({ words: "abc" })).toEqual([]);
		expect(extractWords({ words: [123, true, null, undefined] })).toEqual([]);
	});
});

describe("serveCacheFile", () => {
	it("非法文件名 → HTTP 400", () => {
		try {
			serveCacheFile("../../etc/passwd");
			expect.unreachable("应抛 400");
		} catch (e) {
			expect((e as { status?: number }).status).toBe(400);
		}
	});

	it("文件名超长 → HTTP 400", () => {
		try {
			serveCacheFile(`${"a".repeat(90)}.mp3`);
			expect.unreachable("应抛 400");
		} catch (e) {
			expect((e as { status?: number }).status).toBe(400);
		}
	});

	it("非 mp3 扩展名 → HTTP 400", () => {
		try {
			serveCacheFile("evil.mp4");
			expect.unreachable("应抛 400");
		} catch (e) {
			expect((e as { status?: number }).status).toBe(400);
		}
	});

	it("文件不存在 → HTTP 404", () => {
		try {
			serveCacheFile("no_such_file_123456.mp3");
			expect.unreachable("应抛 404");
		} catch (e) {
			expect((e as { status?: number }).status).toBe(404);
		}
	});
});
