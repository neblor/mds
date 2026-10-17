/**
 * Edge 朗读 TTS 客户端（项目内实现，替代已停更且会挂死的 edge-tts-universal）
 *
 * 为什么自己实现：
 * - 2026-10-10 起微软只接受 v2 `Sec-MS-GEC` 令牌（见 edge-tts-token.ts），npm 上的
 *   edge-tts-universal 仍是 v1，且发行版把端点/版本串写死在 bundle 里，无法从外部覆盖；
 * - 该库在握手失败时 `await websocket.on("open")` 永不 settle（error 事件只入队列），
 *   于是 /api/tts 既不返回也不报错，界面永久停在「正在生成语音」。本实现所有失败路径
 *   都必须收敛：握手拒绝、socket 错误、提前关闭、连接/回合超时、中止，一个都不能漏。
 *
 * 协议（实测可用）：连上后先发 speech.config，再发 SSML；服务端回二进制音频帧
 * （2 字节大端头长 + 文本头 + mp3 数据）与若干文本帧，`Path:turn.end` 表示本轮结束。
 *
 * 端点策略：主用 api.msedgeservices.com（Edge 当前使用的端点，参数名
 * Ocp-Apim-Subscription-Key），连接阶段失败则回退到旧的
 * speech.platform.bing.com（参数名 TrustedClientToken）。两者都认 v2 令牌，
 * 双端点是为了在微软迁移期间多一层可用性，诊断信息里会标明实际命中的端点。
 */
import { WebSocket } from "ws";
import {
	CHROMIUM_MAJOR_VERSION,
	SEC_MS_GEC_VERSION,
	TRUSTED_CLIENT_TOKEN,
	clockSkewFromServerDate,
	generateSecMsGecV2,
} from "./edge-tts-token";

/** SSML 文本上限（协议侧 4096 字节，留出转义余量） */
const MAX_TEXT_BYTES = 4000;
/** 默认连接（握手）超时；超过即换下一个端点，不能让界面干等 */
const DEFAULT_CONNECT_TIMEOUT_MS = 8_000;
/** 默认回合超时：握手成功到 turn.end 之间没有产出即判失败 */
const DEFAULT_TURN_TIMEOUT_MS = 20_000;

export const EDGE_TTS_ENDPOINTS = [
	{
		host: "api.msedgeservices.com",
		url: "wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1",
		keyParam: "Ocp-Apim-Subscription-Key",
	},
	{
		host: "speech.platform.bing.com",
		url: "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1",
		keyParam: "TrustedClientToken",
	},
] as const;

export type EdgeTtsErrorCode =
	| "connect"
	| "connect-timeout"
	| "handshake"
	| "timeout"
	| "no-audio"
	| "closed"
	| "aborted";

/**
 * 端点级失败：连不上、连接超时、握手被拒——这些都是「某个端点的事」，
 * 值得换端点再试。回合内的失败（timeout / no-audio / closed）不属于端点差异，
 * 换一遍只会让用户在「正在生成语音」上多等一个回合。
 */
const ENDPOINT_LEVEL_FAILURES: readonly EdgeTtsErrorCode[] = [
	"connect",
	"connect-timeout",
	"handshake",
];

export class EdgeTtsError extends Error {
	readonly code: EdgeTtsErrorCode;
	/** 握手被拒时的 HTTP 状态码（403 常见于令牌或时钟问题） */
	readonly statusCode?: number;
	/** 握手响应里的 Date 头，用于时钟偏移修正 */
	readonly serverDate?: string;
	/** 各端点失败原因摘要，便于诊断脚本输出 */
	readonly attempts: string[];

	constructor(
		code: EdgeTtsErrorCode,
		message: string,
		options: { statusCode?: number; serverDate?: string; attempts?: string[] } = {},
	) {
		super(message);
		this.name = "EdgeTtsError";
		this.code = code;
		this.statusCode = options.statusCode;
		this.serverDate = options.serverDate;
		this.attempts = options.attempts ?? [];
	}
}

/** 归一化的 socket：把 `ws` 的事件风格收进项目自己的接口，测试可整替身注入 */
export interface EdgeTtsSocket {
	send(data: string): void;
	terminate(): void;
	onOpen(listener: () => void): void;
	onMessage(listener: (data: Buffer, isBinary: boolean) => void): void;
	onError(listener: (error: Error) => void): void;
	onClose(listener: (code: number) => void): void;
	onHandshakeRejected(
		listener: (statusCode: number, serverDate: string | null) => void,
	): void;
}

export type EdgeTtsSocketFactory = (
	url: string,
	headers: Record<string, string>,
) => EdgeTtsSocket;

export interface EdgeTtsDeps {
	/** socket 工厂（测试注入替身；默认用 ws） */
	createSocket?: EdgeTtsSocketFactory;
	now?: () => number;
	/** 当前时钟偏移（秒），会参与令牌时间片计算 */
	clockSkewSeconds?: () => number;
	/** 用时端 Date 头修正出的新偏移；默认写回模块级状态供后续请求复用 */
	onClockSkew?: (skewSeconds: number) => void;
	connectTimeoutMs?: number;
	turnTimeoutMs?: number;
}

export interface EdgeTtsResult {
	audio: Uint8Array;
	/** 实际命中的端点 host */
	endpoint: string;
	/** 是否走了回退端点（诊断用） */
	fallback: boolean;
	elapsedMs: number;
}

export interface EdgeTtsClient {
	synthesize(request: {
		text: string;
		voice: string;
		signal?: AbortSignal;
	}): Promise<EdgeTtsResult>;
}

/** 模块级时钟偏移：一次修正后，同批次后续词不再重复踩同一个坑 */
let clockSkewSeconds = 0;

export function getEdgeTtsClockSkew(): number {
	return clockSkewSeconds;
}

/** 仅供诊断/测试：重置时钟偏移 */
export function resetEdgeTtsClockSkew(): void {
	clockSkewSeconds = 0;
}

function randomHex(bytes: number): string {
	const buffer = Buffer.alloc(bytes);
	for (let i = 0; i < bytes; i += 4) {
		buffer.writeUInt32BE(Math.floor(Math.random() * 0x100000000) >>> 0, i);
	}
	return buffer.toString("hex").toUpperCase();
}

function connectionId(): string {
	return randomHex(16).toLowerCase();
}

function escapeXml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

/** 音色名形如 en-US-AvaNeural，取其地区码做 SSML 的 xml:lang */
export function voiceLocale(voice: string): string {
	const parts = voice.split("-");
	return parts.length >= 2 ? `${parts[0]}-${parts[1]}` : "en-US";
}

/** Edge 实际发送的 SSML：不带 rate/pitch 偏移即 +0%，与整场默写的固定节奏一致 */
export function buildSsml(text: string, voice: string): string {
	const locale = voiceLocale(voice);
	return (
		"<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis'" +
		` xml:lang='${escapeXml(locale)}'><voice name='${escapeXml(voice)}'>` +
		`<prosody pitch='+0Hz' rate='+0%' volume='+0%'>${escapeXml(text)}</prosody>` +
		"</voice></speak>"
	);
}

function timestamp(): string {
	return new Date().toISOString().replace(/[-:.]/g, "").slice(0, -1);
}

/** 文本帧 = 若干 `Key: value` 头 + 空行 + 正文；正文里可能含冒号，不能整段当键值解 */
export function parseTextFrame(frame: string): {
	headers: Record<string, string>;
	body: string;
} {
	const lines = frame.split(/\r?\n/);
	const headers: Record<string, string> = {};
	let index = 0;
	for (; index < lines.length; index++) {
		const line = (lines[index] ?? "").trim();
		if (!line) break;
		const separator = line.indexOf(":");
		if (separator === -1) continue;
		headers[line.slice(0, separator).trim()] = line
			.slice(separator + 1)
			.trim();
	}
	return { headers, body: lines.slice(index + 1).join("\n") };
}

/** 二进制帧 = 2 字节大端头长 + 文本头 + 音频数据 */
export function parseBinaryFrame(frame: Buffer): {
	headers: Record<string, string>;
	audio: Buffer;
} {
	if (frame.length < 2) return { headers: {}, audio: Buffer.alloc(0) };
	const headerLength = frame.readUInt16BE(0);
	const headerEnd = 2 + headerLength;
	if (headerEnd > frame.length) return { headers: {}, audio: Buffer.alloc(0) };
	const { headers } = parseTextFrame(frame.subarray(2, headerEnd).toString("utf8"));
	return { headers, audio: frame.subarray(headerEnd) };
}

/** ws 的消息数据可能是 Buffer / Buffer[] / ArrayBuffer，统一成 Buffer */
function toBuffer(data: Buffer | Buffer[] | ArrayBuffer): Buffer {
	if (Array.isArray(data)) return Buffer.concat(data);
	return Buffer.isBuffer(data) ? data : Buffer.from(data);
}

/** 默认 socket 工厂：ws + Edge 浏览器同款请求头 */
export function createWebSocketFactory(): EdgeTtsSocketFactory {
	return (url, headers) => {
		const socket = new WebSocket(url, { headers });
		return {
			send: (data) => socket.send(data),
			terminate: () => socket.terminate(),
			onOpen: (listener) => socket.on("open", listener),
			onMessage: (listener) =>
				socket.on("message", (data, isBinary) => {
					listener(toBuffer(data), isBinary);
				}),
			onError: (listener) => socket.on("error", listener),
			onClose: (listener) => socket.on("close", (code) => listener(code)),
			onHandshakeRejected: (listener) =>
				socket.on("unexpected-response", (_request, response) => {
					const rawDate = response.headers.date;
					listener(
						response.statusCode ?? 0,
						typeof rawDate === "string" ? rawDate : null,
					);
				}),
		};
	};
}

/** 单次端点尝试：连上、发帧、收音频，直到 turn.end 或失败（任何失败都要抛错） */
function synthesizeAtEndpoint(
	endpoint: (typeof EDGE_TTS_ENDPOINTS)[number],
	request: { text: string; voice: string; signal?: AbortSignal },
	options: {
		skewSeconds: number;
		now: () => number;
		createSocket: EdgeTtsSocketFactory;
		connectTimeoutMs: number;
		turnTimeoutMs: number;
	},
): Promise<Uint8Array> {
	const connectId = connectionId();
	const params = new URLSearchParams({
		ConnectionId: connectId,
		[endpoint.keyParam]: TRUSTED_CLIENT_TOKEN,
		"Sec-MS-GEC": generateSecMsGecV2(options.now(), options.skewSeconds),
		"Sec-MS-GEC-Version": SEC_MS_GEC_VERSION,
	});
	const headers: Record<string, string> = {
		// UA 与令牌里的 Chromium 版本同一来源，避免以后只改一处导致版本串不一致
		"User-Agent":
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" +
			` (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
		"Accept-Encoding": "gzip, deflate, br, zstd",
		"Accept-Language": "en-US,en;q=0.9",
		Pragma: "no-cache",
		"Cache-Control": "no-cache",
		Origin: "chrome-extension://jdiccldimpdaibmpdkjnbfold",
		Cookie: `muid=${randomHex(16)};`,
	};

	return new Promise<Uint8Array>((resolve, reject) => {
		let socket: EdgeTtsSocket;
		try {
			socket = options.createSocket(
				`${endpoint.url}?${params.toString()}`,
				headers,
			);
		} catch (error) {
			reject(
				new EdgeTtsError(
					"connect",
					`无法建立连接：${error instanceof Error ? error.message : String(error)}`,
				),
			);
			return;
		}

		const chunks: Buffer[] = [];
		let settled = false;
		let sawAudio = false;
		let connectTimer: ReturnType<typeof setTimeout> | null = null;
		let turnTimer: ReturnType<typeof setTimeout> | null = null;

		const cleanup = () => {
			if (connectTimer) clearTimeout(connectTimer);
			if (turnTimer) clearTimeout(turnTimer);
			connectTimer = null;
			turnTimer = null;
			request.signal?.removeEventListener("abort", onAbort);
			try {
				socket.terminate();
			} catch {
				// 关闭失败不影响结果（socket 可能已被对端关掉）
			}
		};
		const fail = (error: EdgeTtsError) => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(error);
		};
		const succeed = () => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(Buffer.concat(chunks));
		};
		function onAbort() {
			fail(new EdgeTtsError("aborted", "语音合成已中止"));
		}

		if (request.signal?.aborted) {
			fail(new EdgeTtsError("aborted", "语音合成已中止"));
			return;
		}
		request.signal?.addEventListener("abort", onAbort, { once: true });

		connectTimer = setTimeout(() => {
			fail(
				new EdgeTtsError(
					"connect-timeout",
					`连接 ${endpoint.host} 超时（${options.connectTimeoutMs} ms）`,
				),
			);
		}, options.connectTimeoutMs);

		socket.onHandshakeRejected((statusCode, serverDate) => {
			fail(
				new EdgeTtsError(
					"handshake",
					`${endpoint.host} 拒绝握手（HTTP ${statusCode}）`,
					{ statusCode, serverDate: serverDate ?? undefined },
				),
			);
		});
		socket.onError((error) => {
			fail(new EdgeTtsError("connect", `${endpoint.host} 连接失败：${error.message}`));
		});
		socket.onClose(() => {
			fail(
				new EdgeTtsError(
					sawAudio ? "closed" : "no-audio",
					sawAudio
						? `${endpoint.host} 提前关闭连接，音频不完整`
						: `${endpoint.host} 未返回音频`,
				),
			);
		});
		socket.onMessage((data, isBinary) => {
			if (settled) return;
			if (isBinary) {
				const { headers: frameHeaders, audio } = parseBinaryFrame(data);
				if (frameHeaders.Path === "audio" && audio.length > 0) {
					sawAudio = true;
					chunks.push(audio);
				}
				return;
			}
			const { headers: frameHeaders } = parseTextFrame(data.toString("utf8"));
			// 元数据帧（audio.metadata）与 turn.start/response 直接忽略，只认 turn.end
			if (frameHeaders.Path === "turn.end") succeed();
		});
		socket.onOpen(() => {
			if (settled) return;
			if (connectTimer) clearTimeout(connectTimer);
			connectTimer = null;
			if (options.turnTimeoutMs > 0) {
				turnTimer = setTimeout(() => {
					fail(
						new EdgeTtsError(
							"timeout",
							`${endpoint.host} 回合超时（${options.turnTimeoutMs} ms）`,
						),
					);
				}, options.turnTimeoutMs);
			}
			const now = timestamp();
			socket.send(
				`X-Timestamp:${now}\r\n` +
					"Content-Type:application/json; charset=utf-8\r\n" +
					"Path:speech.config\r\n\r\n" +
					JSON.stringify({
						context: {
							synthesis: {
								audio: {
									metadataoptions: {
										sentenceBoundaryEnabled: "false",
										wordBoundaryEnabled: "false",
									},
									outputFormat: "audio-24khz-48kbitrate-mono-mp3",
								},
							},
						},
					}),
			);
			socket.send(
				`X-RequestId:${connectId}\r\n` +
					"Content-Type:application/ssml+xml\r\n" +
					`X-Timestamp:${now}\r\n` +
					"Path:ssml\r\n\r\n" +
					buildSsml(request.text, request.voice),
			);
		});
	});
}

export function createEdgeTtsClient(deps: EdgeTtsDeps = {}): EdgeTtsClient {
	const now = deps.now ?? (() => Date.now() / 1000);
	const readSkew = deps.clockSkewSeconds ?? getEdgeTtsClockSkew;
	const writeSkew =
		deps.onClockSkew ??
		((skew: number) => {
			clockSkewSeconds = skew;
		});
	const createSocket = deps.createSocket ?? createWebSocketFactory();
	const connectTimeoutMs = deps.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
	const turnTimeoutMs = deps.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;

	return {
		async synthesize(request) {
			const startedAt = Date.now();
			if (Buffer.byteLength(request.text, "utf8") > MAX_TEXT_BYTES)
				throw new EdgeTtsError(
					"connect",
					`文本过长（>${MAX_TEXT_BYTES} 字节），当前只支持单词与短句`,
				);
			if (request.signal?.aborted)
				throw new EdgeTtsError("aborted", "语音合成已中止");

			const attempts: string[] = [];
			let skewSeconds = readSkew();
			let skewRetried = false;

			for (const [index, endpoint] of EDGE_TTS_ENDPOINTS.entries()) {
				for (let attempt = 0; attempt < 2; attempt++) {
					try {
						const audio = await synthesizeAtEndpoint(
							endpoint,
							request,
							{
								skewSeconds,
								now,
								createSocket,
								connectTimeoutMs,
								turnTimeoutMs,
							},
						);
						return {
							audio,
							endpoint: endpoint.host,
							fallback: index > 0,
							elapsedMs: Date.now() - startedAt,
						};
					} catch (error) {
						const failure =
							error instanceof EdgeTtsError
								? error
								: new EdgeTtsError(
										"connect",
										error instanceof Error ? error.message : String(error),
									);
						// 主动中止不再重试，也不换端点
						if (failure.code === "aborted" || request.signal?.aborted) {
							throw failure;
						}
						attempts.push(`${endpoint.host}: ${failure.message}`);
						// 403 且服务端给了 Date：按服务端时间修正时钟后重试同一端点一次
						if (
							attempt === 0 &&
							failure.code === "handshake" &&
							failure.statusCode === 403 &&
							!skewRetried &&
							failure.serverDate
						) {
							const next = clockSkewFromServerDate(
								failure.serverDate,
								now(),
							);
							if (next !== null && next !== 0) {
								skewSeconds = next;
								skewRetried = true;
								writeSkew(next);
								continue;
							}
						}
						// 只有端点级失败才值得换端点（见 ENDPOINT_LEVEL_FAILURES）
						if (!ENDPOINT_LEVEL_FAILURES.includes(failure.code)) {
							throw failure;
						}
						break;
					}
				}
			}

			throw new EdgeTtsError(
				"connect",
				`Edge 语音合成失败：${attempts.join("；")}`,
				{ attempts },
			);
		},
	};
}

/** 生产单例：路由与诊断脚本共用 */
export const edgeTts = createEdgeTtsClient();
