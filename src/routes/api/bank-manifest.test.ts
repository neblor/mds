import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as GET_MANIFEST } from "./bank-manifest";
import { GET as GET_REMOTE } from "./bank-remote";

/** 用公网 IP 字面量当主机：不触发真实 DNS 查询，也不会被 SSRF 防护拦下 */
const PUBLIC_BASE = "http://93.184.216.34/banks/manifest.json";

function eventFor(url?: string) {
	const query = url === undefined ? "" : `?url=${encodeURIComponent(url)}`;
	return {
		request: new Request(`http://localhost/api/bank-manifest${query}`),
		params: {},
	};
}

function jsonResponse(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "content-type": "application/json" },
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("GET /api/bank-manifest", () => {
	it("缺 url 拒绝", async () => {
		await expect(GET_MANIFEST(eventFor())).rejects.toMatchObject({ status: 400 });
	});

	it("非法协议与内网地址按类别返回错误（不发起请求）", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		expect(await GET_MANIFEST(eventFor("ftp://example.com/m.json"))).toMatchObject({
			error: "invalid-url",
		});
		expect(await GET_MANIFEST(eventFor("http://localhost:3000/m.json"))).toMatchObject({
			error: "blocked-host",
		});
		expect(await GET_MANIFEST(eventFor("http://127.0.0.1/m.json"))).toMatchObject({
			error: "blocked-host",
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("成功拉取清单：条目 url 解析为绝对地址", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				jsonResponse({
					version: 1,
					banks: [{ id: "cet4", name: "CET-4 核心词", count: 10, version: 2, url: "cet4.json" }],
				}),
			),
		);
		const result = await GET_MANIFEST(eventFor(PUBLIC_BASE));
		expect(result).toMatchObject({
			banks: [
				{
					id: "cet4",
					name: "CET-4 核心词",
					count: 10,
					version: 2,
					url: "http://93.184.216.34/banks/cet4.json",
				},
			],
		});
	});

	it("远端返回非 JSON 时报错", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response("<html></html>", { status: 200 })),
		);
		expect(await GET_MANIFEST(eventFor(PUBLIC_BASE))).toMatchObject({
			error: "invalid-body",
		});
	});
});

describe("GET /api/bank-remote", () => {
	it("成功下载：source 被强制标成 remote（远端文件不可信）", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				jsonResponse({
					id: "cet4",
					name: "CET-4 核心词",
					source: "builtin",
					entries: [{ word: "apple" }],
				}),
			),
		);
		const result = await GET_REMOTE(eventFor(PUBLIC_BASE));
		expect(result).toMatchObject({ bank: { source: "remote", id: "cet4" } });
	});

	it("缺 url 拒绝；内网地址拒绝", async () => {
		await expect(GET_REMOTE(eventFor())).rejects.toMatchObject({ status: 400 });
		vi.stubGlobal("fetch", vi.fn());
		expect(await GET_REMOTE(eventFor("http://169.254.169.254/x.json"))).toMatchObject({
			error: "blocked-host",
		});
	});
});
