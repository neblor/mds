/**
 * 服务端远端抓取（只用于「自定义词库清单」这一类用户配置的地址）
 *
 * 防护口径（SSRF）：只允许 http(s)；主机名解析后落在本机/内网/链路本地/保留段一律拒绝；
 * 手动跟随跳转（每跳都重新校验）；限制超时与响应体积；只接受 JSON。
 *
 * 抽出独立模块 + 可注入 fetch/DNS，便于单测覆盖每一条拒绝分支。
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type RemoteFetchErrorCode =
	| "invalid-url"
	| "blocked-host"
	| "http"
	| "network"
	| "timeout"
	| "too-large"
	| "invalid-body";

export class RemoteFetchError extends Error {
	readonly code: RemoteFetchErrorCode;

	constructor(code: RemoteFetchErrorCode, message: string) {
		super(message);
		this.name = "RemoteFetchError";
		this.code = code;
	}
}

export interface RemoteFetchOptions {
	url: string;
	/** 响应体字节上限（超出即中止并报 too-large） */
	maxBytes: number;
	timeoutMs?: number;
	/** 最多跟随几次跳转（默认 3；每次跳转都重新校验目标） */
	maxRedirects?: number;
	fetchImpl?: typeof fetch;
	/** 主机名 → IP 列表（默认 node:dns/promises 的 lookup） */
	resolveHost?: (hostname: string) => Promise<string[]>;
}

const IPV4_BLOCKED_PATTERNS: RegExp[] = [
	/^0\./,
	/^10\./,
	/^127\./,
	/^169\.254\./,
	/^172\.(1[6-9]|2\d|3[01])\./,
	/^192\.168\./,
	/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT 100.64/10
	/^198\.1[89]\./,
	/^22[4-9]\./,
	/^2[3-5]\d\./,
];

/** 本机/内网/保留地址一律视为不可访问 */
export function isBlockedAddress(address: string): boolean {
	const value = address.trim().toLowerCase();
	if (!value) return true;
	const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
	if (mapped) return isBlockedAddress(mapped[1]);
	const version = isIP(value);
	if (version === 4) {
		return IPV4_BLOCKED_PATTERNS.some((pattern) => pattern.test(value));
	}
	if (version === 6) {
		if (value === "::1" || value === "::") return true;
		if (/^f[cd][0-9a-f]{2}:/.test(value)) return true; // fc00::/7 唯一本地地址
		if (/^fe[89ab][0-9a-f]:/.test(value)) return true; // fe80::/10 链路本地
		if (/^ff[0-9a-f]{2}:/.test(value)) return true; // ff00::/8 组播
		return false;
	}
	return true; // 不是合法 IP：调用方应已把它当主机名处理，这里保守拒绝
}

/** localhost / *.local / *.internal 这类名字直接拒绝（不依赖 DNS 结果） */
export function isBlockedHostname(hostname: string): boolean {
	const host = hostname.trim().toLowerCase().replace(/\.$/, "");
	if (!host) return true;
	if (host === "localhost" || host.endsWith(".localhost")) return true;
	if (host.endsWith(".local") || host.endsWith(".internal")) return true;
	return false;
}

function parseRemoteUrl(raw: string): URL {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new RemoteFetchError("invalid-url", "清单地址不是合法 URL");
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new RemoteFetchError("invalid-url", "清单地址必须是 http 或 https");
	}
	if (url.username || url.password) {
		throw new RemoteFetchError("invalid-url", "清单地址不能带用户名密码");
	}
	return url;
}

async function defaultResolveHost(hostname: string): Promise<string[]> {
	const records = await lookup(hostname, { all: true });
	return records.map((record) => record.address);
}

async function assertAllowedHost(
	url: URL,
	resolveHost: (hostname: string) => Promise<string[]>,
): Promise<void> {
	const hostname = url.hostname;
	if (isBlockedHostname(hostname)) {
		throw new RemoteFetchError("blocked-host", `不允许访问本机地址（${hostname}）`);
	}
	if (isIP(hostname) && isBlockedAddress(hostname)) {
		throw new RemoteFetchError("blocked-host", `不允许访问内网地址（${hostname}）`);
	}
	let addresses: string[];
	try {
		addresses = await resolveHost(hostname);
	} catch {
		throw new RemoteFetchError("blocked-host", `无法解析清单地址的主机（${hostname}）`);
	}
	if (addresses.length === 0 || addresses.some((address) => isBlockedAddress(address))) {
		throw new RemoteFetchError(
			"blocked-host",
			`清单地址解析到内网或保留地址（${hostname}）`,
		);
	}
}

/** 读响应体并限制体积：超过 maxBytes 立刻中止 */
async function readBounded(response: Response, maxBytes: number): Promise<string> {
	const declared = Number(response.headers.get("content-length") ?? "");
	if (Number.isFinite(declared) && declared > maxBytes) {
		throw new RemoteFetchError("too-large", "远端文件超过大小上限");
	}
	if (!response.body) return response.text();
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel().catch(() => {});
			throw new RemoteFetchError("too-large", "远端文件超过大小上限");
		}
		chunks.push(value);
	}
	const merged = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(merged);
}

/**
 * 抓取远端 JSON：校验地址 → 手动跟随跳转（每跳重新校验）→ 限时限量读取 → JSON.parse。
 * 任何失败都抛 RemoteFetchError（code 便于路由映射成用户可读提示）。
 */
export async function fetchRemoteJson(options: RemoteFetchOptions): Promise<unknown> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const resolveHost = options.resolveHost ?? defaultResolveHost;
	const timeoutMs = options.timeoutMs ?? 15_000;
	const maxRedirects = options.maxRedirects ?? 3;
	let current = parseRemoteUrl(options.url).toString();

	for (let hop = 0; hop <= maxRedirects; hop++) {
		const url = parseRemoteUrl(current);
		await assertAllowedHost(url, resolveHost);

		let response: Response;
		try {
			response = await fetchImpl(url.toString(), {
				redirect: "manual",
				headers: { accept: "application/json" },
				signal: AbortSignal.timeout(timeoutMs),
			});
		} catch (error) {
			const timeout =
				error instanceof DOMException && error.name === "TimeoutError";
			throw new RemoteFetchError(
				timeout ? "timeout" : "network",
				timeout
					? `远端请求超时（${Math.round(timeoutMs / 1000)} 秒）`
					: "无法连接远端地址，请检查网络",
			);
		}

		if (response.status >= 300 && response.status < 400) {
			const location = response.headers.get("location");
			if (!location) {
				throw new RemoteFetchError("http", `远端返回 ${response.status} 且没有跳转地址`);
			}
			current = new URL(location, url).toString();
			continue;
		}
		if (!response.ok) {
			throw new RemoteFetchError("http", `远端返回 ${response.status}`);
		}
		const text = await readBounded(response, options.maxBytes);
		try {
			return JSON.parse(text);
		} catch {
			throw new RemoteFetchError("invalid-body", "远端返回的不是合法 JSON");
		}
	}
	throw new RemoteFetchError("http", "远端跳转次数过多");
}
