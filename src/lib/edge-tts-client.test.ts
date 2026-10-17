/**
 * Edge TTS 客户端单测：用可注入的假 socket 覆盖
 * 成功、握手拒绝、时钟修正重试、端点回退、超时、中止、提前关闭、无音频等路径。
 * 这些路径正是旧库把界面挂死的来源（握手失败时 Promise 永不 settle）。
 */
import { describe, expect, it, vi } from "vitest";
import {
	EDGE_TTS_ENDPOINTS,
	EdgeTtsError,
	buildSsml,
	createEdgeTtsClient,
	parseBinaryFrame,
	parseTextFrame,
	voiceLocale,
	type EdgeTtsSocket,
} from "./edge-tts-client";
import { SEC_MS_GEC_VERSION } from "./edge-tts-token";

class FakeSocket implements EdgeTtsSocket {
	sent: string[] = [];
	terminated = false;
	private handlers: {
		open?: () => void;
		message?: (data: Buffer, isBinary: boolean) => void;
		error?: (error: Error) => void;
		close?: (code: number) => void;
		rejected?: (statusCode: number, serverDate: string | null) => void;
	} = {};

	constructor(
		readonly url: string,
		readonly headers: Record<string, string>,
	) {}

	send(data: string): void {
		this.sent.push(data);
	}
	terminate(): void {
		this.terminated = true;
	}
	onOpen(listener: () => void): void {
		this.handlers.open = listener;
	}
	onMessage(listener: (data: Buffer, isBinary: boolean) => void): void {
		this.handlers.message = listener;
	}
	onError(listener: (error: Error) => void): void {
		this.handlers.error = listener;
	}
	onClose(listener: (code: number) => void): void {
		this.handlers.close = listener;
	}
	onHandshakeRejected(
		listener: (statusCode: number, serverDate: string | null) => void,
	): void {
		this.handlers.rejected = listener;
	}

	emitOpen(): void {
		this.handlers.open?.();
	}
	emitBinary(audio: Buffer, path = "audio"): void {
		const header = Buffer.from(`Path:${path}\r\nContent-Type:audio/mpeg\r\n\r\n`);
		const prefix = Buffer.alloc(2);
		prefix.writeUInt16BE(header.length, 0);
		this.handlers.message?.(Buffer.concat([prefix, header, audio]), true);
	}
	emitText(path: string, body = ""): void {
		this.handlers.message?.(
			Buffer.from(`Path:${path}\r\nContent-Type:application/json\r\n\r\n${body}`),
			false,
		);
	}
	emitAudioThenEnd(audio = Buffer.from([0xff, 0xf3, 1, 2, 3])): void {
		this.emitText("turn.start");
		this.emitBinary(audio);
		this.emitText("audio.metadata", '{"Metadata":[]}');
		this.emitText("turn.end");
	}
	emitError(message: string): void {
		this.handlers.error?.(new Error(message));
	}
	emitClose(code = 1006): void {
		this.handlers.close?.(code);
	}
	emitHandshakeRejected(statusCode: number, serverDate: string | null): void {
		this.handlers.rejected?.(statusCode, serverDate);
	}
}

/** 造一个记录所有 socket 的工厂；每个 socket 由用例自行驱动 */
function fakeFactory() {
	const sockets: FakeSocket[] = [];
	return {
		sockets,
		createSocket: (url: string, headers: Record<string, string>) => {
			const socket = new FakeSocket(url, headers);
			sockets.push(socket);
			return socket;
		},
	};
}

const baseRequest = { text: "apple", voice: "en-US-AvaNeural" };

/**
 * 启动一次合成，并立刻挂上 no-op catch：
 * 失败路径的用例本就靠断言取拒绝，但拒绝一旦先于断言发生，Vitest 会把它当成
 * 「未处理拒绝」连带报错；先挂一个定位器就能消除这类间歇失败。
 */
function start(
	client: ReturnType<typeof createEdgeTtsClient>,
	request: { text: string; voice: string; signal?: AbortSignal } = baseRequest,
) {
	const pending = client.synthesize(request);
	pending.catch(() => {});
	return pending;
}

describe("parseTextFrame", () => {
	it("拆出响应头与正文（正文里的冒号不影响解析）", () => {
		const frame = "Path:audio.metadata\r\nX-RequestId:abc\r\n\r\n{\"a\":1}";
		expect(parseTextFrame(frame)).toEqual({
			headers: { Path: "audio.metadata", "X-RequestId": "abc" },
			body: '{"a":1}',
		});
	});

	it("没有正文时 body 为空串", () => {
		expect(parseTextFrame("Path:turn.end\r\n\r\n").body).toBe("");
	});
});

describe("parseBinaryFrame", () => {
	it("按 2 字节大端头长切出音频", () => {
		const header = Buffer.from("Path:audio\r\n\r\n");
		const prefix = Buffer.alloc(2);
		prefix.writeUInt16BE(header.length, 0);
		const audio = Buffer.from([1, 2, 3, 4]);
		const parsed = parseBinaryFrame(Buffer.concat([prefix, header, audio]));
		expect(parsed.headers.Path).toBe("audio");
		expect([...parsed.audio]).toEqual([1, 2, 3, 4]);
	});

	it("头长越界或帧过短时返回空音频而不是抛错", () => {
		expect(parseBinaryFrame(Buffer.from([0x01])).audio.length).toBe(0);
		const prefix = Buffer.alloc(2);
		prefix.writeUInt16BE(999, 0);
		expect(parseBinaryFrame(prefix).audio.length).toBe(0);
	});
});

describe("buildSsml / voiceLocale", () => {
	it("从音色名取地区码", () => {
		expect(voiceLocale("en-US-AvaNeural")).toBe("en-US");
		expect(voiceLocale("nonsense")).toBe("en-US");
	});

	it("转义 XML 特殊字符，避免单词里的 & ' 破坏 SSML", () => {
		const ssml = buildSsml("rock & roll's <tag>", "en-US-AvaNeural");
		expect(ssml).toContain("rock &amp; roll&apos;s &lt;tag&gt;");
		expect(ssml).toContain("<voice name='en-US-AvaNeural'>");
	});
});

describe("createEdgeTtsClient.synthesize", () => {
	it("成功路径：拼装音频帧、返回端点与耗时", async () => {
		const { sockets, createSocket } = fakeFactory();
		const client = createEdgeTtsClient({ createSocket });
		const pending = start(client);
		expect(sockets).toHaveLength(1);
		const socket = sockets[0] as FakeSocket;
		expect(socket.url.startsWith(EDGE_TTS_ENDPOINTS[0].url)).toBe(true);
		socket.emitOpen();
		socket.emitAudioThenEnd(Buffer.from([0xff, 0xf3, 9, 9]));

		const result = await pending;
		expect(result.endpoint).toBe("api.msedgeservices.com");
		expect(result.fallback).toBe(false);
		expect([...result.audio]).toEqual([0xff, 0xf3, 9, 9]);
		expect(socket.terminated).toBe(true);
	});

	it("请求参数：新端点用 Ocp-Apim-Subscription-Key，带 v2 令牌与版本串", async () => {
		const { sockets, createSocket } = fakeFactory();
		const client = createEdgeTtsClient({ createSocket, now: () => 1760700000 });
		void start(client);
		const url = new URL((sockets[0] as FakeSocket).url);
		expect(url.searchParams.get("Ocp-Apim-Subscription-Key")).toBeTruthy();
		expect(url.searchParams.get("TrustedClientToken")).toBeNull();
		expect(url.searchParams.get("Sec-MS-GEC-Version")).toBe(SEC_MS_GEC_VERSION);
		expect(url.searchParams.get("Sec-MS-GEC")).toMatch(
			/^[0-9A-F]{16}-[0-9A-F]{64}$/,
		);
		expect(url.searchParams.get("ConnectionId")).toMatch(/^[0-9a-f]{32}$/);
		const headers = (sockets[0] as FakeSocket).headers;
		expect(headers.Origin).toContain("chrome-extension://");
		expect(headers.Cookie).toMatch(/^muid=[0-9A-F]{32};$/);
	});

	it("先发 speech.config 再发 ssml", async () => {
		const { sockets, createSocket } = fakeFactory();
		const client = createEdgeTtsClient({ createSocket });
		const pending = start(client, { ...baseRequest, text: "ice cream" });
		const socket = sockets[0] as FakeSocket;
		socket.emitOpen();
		expect(socket.sent).toHaveLength(2);
		expect(socket.sent[0]).toContain("Path:speech.config");
		expect(socket.sent[1]).toContain("Path:ssml");
		expect(socket.sent[1]).toContain("ice cream");
		socket.emitAudioThenEnd();
		await pending;
	});

	it("403 且带 Date：按服务端时间修正时钟后重试同一端点", async () => {
		const { sockets, createSocket } = fakeFactory();
		const onClockSkew = vi.fn();
		const client = createEdgeTtsClient({
			createSocket,
			now: () => 1760700000,
			onClockSkew,
		});
		const pending = start(client);
		(sockets[0] as FakeSocket).emitHandshakeRejected(
			403,
			new Date(1760700300_000).toUTCString(),
		);
		await vi.waitFor(() => expect(sockets).toHaveLength(2));
		// 第二次仍打主端点，但令牌用的时间片随修正后的时钟前移
		expect((sockets[1] as FakeSocket).url).toContain(
			EDGE_TTS_ENDPOINTS[0].url,
		);
		expect(onClockSkew).toHaveBeenCalledWith(300);
		(sockets[1] as FakeSocket).emitOpen();
		(sockets[1] as FakeSocket).emitAudioThenEnd();
		await expect(pending).resolves.toMatchObject({
			endpoint: "api.msedgeservices.com",
		});
	});

	it("403 但没有可用 Date：直接回退到旧端点，诊断里标明 fallback", async () => {
		const { sockets, createSocket } = fakeFactory();
		const client = createEdgeTtsClient({ createSocket });
		const pending = start(client);
		(sockets[0] as FakeSocket).emitHandshakeRejected(403, null);
		await vi.waitFor(() => expect(sockets).toHaveLength(2));
		const fallbackUrl = (sockets[1] as FakeSocket).url;
		expect(fallbackUrl).toContain(EDGE_TTS_ENDPOINTS[1].url);
		expect(new URL(fallbackUrl).searchParams.get("TrustedClientToken")).toBeTruthy();
		(sockets[1] as FakeSocket).emitOpen();
		(sockets[1] as FakeSocket).emitAudioThenEnd();
		await expect(pending).resolves.toMatchObject({
			endpoint: "speech.platform.bing.com",
			fallback: true,
		});
	});

	it("连接超时：回退到第二个端点，不会永久悬挂", async () => {
		const { sockets, createSocket } = fakeFactory();
		// 超时要够大，否则回退 socket 会在断言驱动它之前先自己超时（间歇失败来源）
		const client = createEdgeTtsClient({ createSocket, connectTimeoutMs: 250 });
		const pending = start(client);
		// 第一个 socket 永不开连接
		await vi.waitFor(() => expect(sockets).toHaveLength(2), { timeout: 2000 });
		expect((sockets[0] as FakeSocket).terminated).toBe(true);
		(sockets[1] as FakeSocket).emitOpen();
		(sockets[1] as FakeSocket).emitAudioThenEnd();
		await expect(pending).resolves.toMatchObject({ fallback: true });
	});

	it("回合超时：握手成功但服务端不出音频时按超时收敛（不换端点）", async () => {
		const { sockets, createSocket } = fakeFactory();
		const client = createEdgeTtsClient({
			createSocket,
			connectTimeoutMs: 1000,
			turnTimeoutMs: 30,
		});
		const pending = start(client);
		(sockets[0] as FakeSocket).emitOpen();
		await expect(pending).rejects.toMatchObject({ code: "timeout" });
		// 回合内失败不再換端点：换一遍只会让用户多等一个回合
		expect(sockets).toHaveLength(1);
	});

	it("收到过音频后提前关闭 → closed；没音频就关 → no-audio", async () => {
		const first = fakeFactory();
		const clientA = createEdgeTtsClient({ createSocket: first.createSocket });
		const pendingA = clientA.synthesize(baseRequest);
		(first.sockets[0] as FakeSocket).emitOpen();
		(first.sockets[0] as FakeSocket).emitBinary(Buffer.from([1, 2]));
		(first.sockets[0] as FakeSocket).emitClose();
		await expect(pendingA).rejects.toMatchObject({ code: "closed" });
		expect(first.sockets).toHaveLength(1);

		const second = fakeFactory();
		const clientB = createEdgeTtsClient({ createSocket: second.createSocket });
		const pendingB = clientB.synthesize(baseRequest);
		(second.sockets[0] as FakeSocket).emitOpen();
		(second.sockets[0] as FakeSocket).emitClose();
		await expect(pendingB).rejects.toMatchObject({ code: "no-audio" });
	});

	it("中止：立刻收敛、不再重试、不再换端点", async () => {
		const { sockets, createSocket } = fakeFactory();
		const client = createEdgeTtsClient({ createSocket });
		const controller = new AbortController();
		const pending = start(client, { ...baseRequest, signal: controller.signal });
		controller.abort();
		await expect(pending).rejects.toMatchObject({ code: "aborted" });
		expect(sockets).toHaveLength(1);
		expect((sockets[0] as FakeSocket).terminated).toBe(true);
	});

	it("已中止的 signal 在发起前就被拦下", async () => {
		const { sockets, createSocket } = fakeFactory();
		const client = createEdgeTtsClient({ createSocket });
		const controller = new AbortController();
		controller.abort();
		await expect(
			client.synthesize({ ...baseRequest, signal: controller.signal }),
		).rejects.toBeInstanceOf(EdgeTtsError);
		expect(sockets).toHaveLength(0);
	});

	it("两个端点都失败：抛错并带上各端点原因摘要", async () => {
		const { sockets, createSocket } = fakeFactory();
		const client = createEdgeTtsClient({ createSocket });
		const pending = start(client);
		(sockets[0] as FakeSocket).emitError("ECONNRESET");
		await vi.waitFor(() => expect(sockets).toHaveLength(2));
		(sockets[1] as FakeSocket).emitHandshakeRejected(500, null);
		await expect(pending).rejects.toMatchObject({
			code: "connect",
			attempts: [
				expect.stringContaining("api.msedgeservices.com"),
				expect.stringContaining("speech.platform.bing.com"),
			],
		});
	});

	it("文本超长直接拒绝，不发起连接", async () => {
		const { sockets, createSocket } = fakeFactory();
		const client = createEdgeTtsClient({ createSocket });
		await expect(
			client.synthesize({ ...baseRequest, text: "a".repeat(4001) }),
		).rejects.toMatchObject({ code: "connect" });
		expect(sockets).toHaveLength(0);
	});

	it("忽略非音频二进制帧与未知文本帧，只认 turn.end", async () => {
		const { sockets, createSocket } = fakeFactory();
		const client = createEdgeTtsClient({ createSocket });
		const pending = start(client);
		const socket = sockets[0] as FakeSocket;
		socket.emitOpen();
		socket.emitText("response");
		socket.emitBinary(Buffer.alloc(0), "audio");
		socket.emitBinary(Buffer.from([7, 7]), "unknown");
		socket.emitBinary(Buffer.from([5, 5]), "audio");
		socket.emitText("turn.end");
		await expect(pending).resolves.toMatchObject({
			audio: expect.anything(),
		});
		const result = await pending;
		expect([...result.audio]).toEqual([5, 5]);
	});
});
