import { describe, expect, it, vi } from "vitest";
import {
	RemoteFetchError,
	fetchRemoteJson,
	isBlockedAddress,
	isBlockedHostname,
} from "./remote-fetch";

const PUBLIC_HOST = "example.test";

/** 默认 DNS 解析：示例主机解析到公网地址 */
const resolvePublic = async () => ["93.184.216.34"];

function jsonResponse(data: unknown, init: ResponseInit = {}) {
	return new Response(JSON.stringify(data), {
		status: init.status ?? 200,
		headers: { "content-type": "application/json", ...(init.headers ?? {}) },
	});
}

async function failureOf(run: () => Promise<unknown>): Promise<RemoteFetchError> {
	try {
		await run();
	} catch (error) {
		expect(error).toBeInstanceOf(RemoteFetchError);
		return error as RemoteFetchError;
	}
	throw new Error("期望抛错，但没有");
}

describe("isBlockedAddress", () => {
	it("拒绝本机/内网/链路本地/保留段", () => {
		for (const address of [
			"127.0.0.1",
			"0.0.0.0",
			"10.1.2.3",
			"172.16.0.1",
			"172.31.255.255",
			"192.168.1.1",
			"169.254.1.1",
			"100.64.0.1",
			"198.18.0.1",
			"224.0.0.1",
			"::1",
			"::",
			"fc00::1",
			"fd12:3456::1",
			"fe80::1",
			"ff02::1",
			"::ffff:127.0.0.1",
			"not-an-ip",
		]) {
			expect(isBlockedAddress(address), address).toBe(true);
		}
	});

	it("放行公网地址", () => {
		for (const address of [
			"93.184.216.34",
			"8.8.8.8",
			"172.32.0.1",
			"2606:2800:220:1:248:1893:25c8:1946",
		]) {
			expect(isBlockedAddress(address), address).toBe(false);
		}
	});
});

describe("isBlockedHostname", () => {
	it("拒绝 localhost 与常见内网后缀", () => {
		for (const host of [
			"localhost",
			"LOCALHOST",
			"api.localhost",
			"printer.local",
			"db.internal",
			"",
		]) {
			expect(isBlockedHostname(host), host).toBe(true);
		}
		expect(isBlockedHostname("example.com")).toBe(false);
		expect(isBlockedHostname("localhost.example.com")).toBe(false);
	});
});

describe("fetchRemoteJson 地址校验", () => {
	it("非 http(s) 或非法 URL 直接拒绝", async () => {
		for (const url of ["ftp://x/y", "file:///etc/passwd", "not a url"]) {
			const error = await failureOf(() =>
				fetchRemoteJson({ url, maxBytes: 1024, resolveHost: resolvePublic }),
			);
			expect(error.code).toBe("invalid-url");
		}
		const withAuth = await failureOf(() =>
			fetchRemoteJson({
				url: "https://user:pass@example.test/m.json",
				maxBytes: 1024,
				resolveHost: resolvePublic,
			}),
		);
		expect(withAuth.code).toBe("invalid-url");
	});

	it("拒绝解析到内网的主机（DNS 层面）", async () => {
		const error = await failureOf(() =>
			fetchRemoteJson({
				url: `https://${PUBLIC_HOST}/m.json`,
				maxBytes: 1024,
				resolveHost: async () => ["127.0.0.1"],
			}),
		);
		expect(error.code).toBe("blocked-host");
	});

	it("拒绝 localhost 与解析失败", async () => {
		expect(
			(
				await failureOf(() =>
					fetchRemoteJson({
						url: "http://localhost:3000/m.json",
						maxBytes: 1024,
						resolveHost: resolvePublic,
					}),
				)
			).code,
		).toBe("blocked-host");
		expect(
			(
				await failureOf(() =>
					fetchRemoteJson({
						url: `https://${PUBLIC_HOST}/m.json`,
						maxBytes: 1024,
						resolveHost: async () => {
							throw new Error("ENOTFOUND");
						},
					}),
				)
			).code,
		).toBe("blocked-host");
	});
});

describe("fetchRemoteJson 抓取行为", () => {
	it("返回解析后的 JSON，并带上 accept 头", async () => {
		const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
		const data = await fetchRemoteJson({
			url: `https://${PUBLIC_HOST}/m.json`,
			maxBytes: 1024,
			resolveHost: resolvePublic,
			fetchImpl: fetchMock as unknown as typeof fetch,
		});
		expect(data).toEqual({ ok: true });
		const init = fetchMock.mock.calls[0][1] as RequestInit;
		expect(init.redirect).toBe("manual");
		expect((init.headers as Record<string, string>).accept).toBe("application/json");
	});

	it("手动跟随跳转，且每一跳都重新校验地址", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(null, {
					status: 302,
					headers: { location: `https://${PUBLIC_HOST}/real.json` },
				}),
			)
			.mockResolvedValueOnce(jsonResponse({ bank: 1 }));
		const data = await fetchRemoteJson({
			url: `https://${PUBLIC_HOST}/m.json`,
			maxBytes: 1024,
			resolveHost: resolvePublic,
			fetchImpl: fetchMock as unknown as typeof fetch,
		});
		expect(data).toEqual({ bank: 1 });
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("跳转目标是内网时拒绝", async () => {
		const fetchMock = vi.fn().mockResolvedValueOnce(
			new Response(null, {
				status: 302,
				headers: { location: "http://169.254.169.254/latest/meta-data" },
			}),
		);
		const error = await failureOf(() =>
			fetchRemoteJson({
				url: `https://${PUBLIC_HOST}/m.json`,
				maxBytes: 1024,
				resolveHost: resolvePublic,
				fetchImpl: fetchMock as unknown as typeof fetch,
			}),
		);
		expect(error.code).toBe("blocked-host");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("跳转次数过多时报错", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(null, {
				status: 301,
				headers: { location: `https://${PUBLIC_HOST}/loop.json` },
			}),
		);
		const error = await failureOf(() =>
			fetchRemoteJson({
				url: `https://${PUBLIC_HOST}/m.json`,
				maxBytes: 1024,
				maxRedirects: 2,
				resolveHost: resolvePublic,
				fetchImpl: fetchMock as unknown as typeof fetch,
			}),
		);
		expect(error.code).toBe("http");
		expect(error.message).toContain("跳转");
	});

	it("HTTP 错误与网络错误分别映射", async () => {
		expect(
			(
				await failureOf(() =>
					fetchRemoteJson({
						url: `https://${PUBLIC_HOST}/m.json`,
						maxBytes: 1024,
						resolveHost: resolvePublic,
						fetchImpl: vi
							.fn()
							.mockResolvedValue(new Response("nope", { status: 500 })) as unknown as typeof fetch,
					}),
				)
			).code,
		).toBe("http");
		expect(
			(
				await failureOf(() =>
					fetchRemoteJson({
						url: `https://${PUBLIC_HOST}/m.json`,
						maxBytes: 1024,
						resolveHost: resolvePublic,
						fetchImpl: vi
							.fn()
							.mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch,
					}),
				)
			).code,
		).toBe("network");
	});

	it("超时映射为 timeout", async () => {
		const error = await failureOf(() =>
			fetchRemoteJson({
				url: `https://${PUBLIC_HOST}/m.json`,
				maxBytes: 1024,
				resolveHost: resolvePublic,
				fetchImpl: vi
					.fn()
					.mockRejectedValue(
						new DOMException("timeout", "TimeoutError"),
					) as unknown as typeof fetch,
			}),
		);
		expect(error.code).toBe("timeout");
	});

	it("超过体积上限或非 JSON 时拒绝", async () => {
		const large = new Response("x".repeat(5000), { status: 200 });
		expect(
			(
				await failureOf(() =>
					fetchRemoteJson({
						url: `https://${PUBLIC_HOST}/m.json`,
						maxBytes: 1024,
						resolveHost: resolvePublic,
						fetchImpl: vi
							.fn()
							.mockResolvedValue(large) as unknown as typeof fetch,
					}),
				)
			).code,
		).toBe("too-large");
		expect(
			(
				await failureOf(() =>
					fetchRemoteJson({
						url: `https://${PUBLIC_HOST}/m.json`,
						maxBytes: 1024,
						resolveHost: resolvePublic,
						fetchImpl: vi
							.fn()
							.mockResolvedValue(
								new Response("<html></html>", { status: 200 }),
							) as unknown as typeof fetch,
					}),
				)
			).code,
		).toBe("invalid-body");
	});

	it("content-length 超限时在读取前就拒绝", async () => {
		const response = new Response(JSON.stringify({ ok: true }), {
			status: 200,
			headers: { "content-length": "99999999" },
		});
		const error = await failureOf(() =>
			fetchRemoteJson({
				url: `https://${PUBLIC_HOST}/m.json`,
				maxBytes: 1024,
				resolveHost: resolvePublic,
				fetchImpl: vi.fn().mockResolvedValue(response) as unknown as typeof fetch,
			}),
		);
		expect(error.code).toBe("too-large");
	});
});
