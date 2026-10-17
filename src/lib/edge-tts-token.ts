/**
 * Edge 朗读服务的 Sec-MS-GEC 访问令牌（v2）
 *
 * 背景（2026-10-10 起微软侧变更）：
 * - 旧版令牌是「时间片 + 客户端令牌」的单段 SHA-256（下文称 v1），现在
 *   speech.platform.bing.com 对 v1 一律 403；Edge 自身已改用
 *   api.msedgeservices.com + `<16 位>-<64 位>` 双段令牌（v2）。
 * - v2 = CS64 摘要 - SHA-256 摘要，两者都覆盖同一段「盐」文本：
 *   固定的 57 字节版权前缀 + `时间片(100ns) + TRUSTED_CLIENT_TOKEN`。
 *
 * 本文件的实现是上游 rany2/edge-tts 修复 PR（#492）的逐位移植，并用该 PR 的
 * Python 参考实现在固定时间戳上逐字节对拍过（见 edge-tts-token.test.ts）。
 * 之所以自己实现而不是用现成库：npm 上的 edge-tts-universal 仍是 v1，
 * 且它在握手失败时会让 Promise 永不 settle（表现为界面永久卡住）。
 */
import { createHash } from "node:crypto";

/** 公开的客户端密钥（Edge 扩展内置值，等同 Ocp-Apim-Subscription-Key） */
export const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";

/** 对端会校验的 Chromium 版本号；v2 令牌要求版本串以 `2-` 开头 */
export const CHROMIUM_FULL_VERSION = "143.0.3650.75";
export const CHROMIUM_MAJOR_VERSION =
	CHROMIUM_FULL_VERSION.split(".", 1)[0] ?? "143";
export const SEC_MS_GEC_VERSION = `2-${CHROMIUM_FULL_VERSION}`;

/**
 * 固定盐前缀：Edge 把这段版权声明拼在时间片之前参与摘要。
 * 逐字节硬编码（而不是写字符串再取 ASCII），避免编辑器/编码差异改掉字节。
 */
const GEC_PREFIX = Buffer.from([
	0x43, 0x6f, 0x70, 0x79, 0x72, 0x69, 0x67, 0x68, 0x74, 0x20, 0x28, 0x43,
	0x29, 0x20, 0x4d, 0x69, 0x63, 0x72, 0x6f, 0x73, 0x6f, 0x66, 0x74, 0x20,
	0x43, 0x6f, 0x72, 0x70, 0x6f, 0x72, 0x61, 0x74, 0x69, 0x6f, 0x6e, 0x2e,
	0x20, 0x41, 0x6c, 0x6c, 0x20, 0x72, 0x69, 0x67, 0x68, 0x74, 0x73, 0x20,
	0x72, 0x65, 0x73, 0x65, 0x72, 0x76, 0x65, 0x64, 0x2e,
]);

const WIN_EPOCH_OFFSET = 11644473600; // 1601-01-01 → 1970-01-01（秒）
const TICKS_PER_SECOND = 1e9 / 100; // 100ns 计时单位

/** CS64 系数表（低 32 位、旋转偏移），顺序不可调换 */
const CS64_COEFFICIENTS: readonly (readonly [number, number])[] = [
	[0xe82e91b1, 0xb32700d0],
	[0x44de24c6, 0x88dff51d],
	[0x3beb65bc, 0x29514038],
	[0xc89c5933, 0xb328cbdf],
	[0x8d1ec211, 0xd405b4d5],
	[0x314ef5d5, 0x26e55f3c],
	[0xe92491b1, 0x607801c6],
	[0xf0a5b9d5, 0x82b2c1fb],
	[0x06064cf3, 0xfa51a3da],
	[0xda79fa60, 0x207cc464],
	[0xbed20560, 0x3c3c74f3],
	[0x89f9c9f8, 0xd2d14b61],
	[0x35fa38c6, 0xbb04a2c1],
	[0xcb49e3c6, 0xc5626167],
];
const CS64_FACTOR = 0x82893933;
const CS64_ADJUSTMENT0 = 0xf2f90b1a;
const CS64_ADJUSTMENT1 = 0x0b1a0000;

const mul32 = (a: number, b: number): number => Math.imul(a, b) >>> 0;
const rol16 = (value: number): number =>
	(((value << 16) | (value >>> 16)) >>> 0) as number;

/**
 * `0x00` 前缀后的数据按小端 32 位切词，末尾补零到偶数个词。
 * 前导 0x00 是微软实现里的固定填充，不能省。
 */
function toWordsLe4Even(data: Buffer): number[] {
	const padded = Buffer.concat([Buffer.from([0]), data]);
	const padLength = (4 - (padded.length % 4)) % 4;
	const aligned = padLength ? Buffer.concat([padded, Buffer.alloc(padLength)]) : padded;
	const words: number[] = [];
	for (let offset = 0; offset < aligned.length; offset += 4) {
		words.push(aligned.readUInt32LE(offset));
	}
	if (words.length % 2 === 1) words.push(0);
	return words;
}

/** CS64 摘要：两条链交错累积，输出与 SHA-256 摘要前 8 字节派生的两个密钥绑定 */
function cs64Digest(salt: Buffer, digest: Buffer): Buffer {
	const keyA = (digest.readUInt32LE(0) | 1) >>> 0;
	const keyB = (digest.readUInt32LE(4) | 1) >>> 0;
	const factors = [mul32(keyA, CS64_FACTOR), mul32(keyB, CS64_FACTOR)];

	const terms = CS64_COEFFICIENTS.map(([coefficient], index) =>
		mul32(coefficient, factors[index % 2] as number),
	);
	const offsets = CS64_COEFFICIENTS.map(([, offset]) => offset);

	toWordsLe4Even(salt).forEach((word, index) => {
		const even = index % 2 === 0;
		let term = mul32(word, even ? keyA : keyB);
		let offset = mul32(rol16(word), even ? 0xef0569fb : 0xc31713db);
		if (index === 0) {
			term = (term + mul32(CS64_ADJUSTMENT0, factors[0] as number)) >>> 0;
			offset = (offset + CS64_ADJUSTMENT1) >>> 0;
		}
		terms.push(term);
		offsets.push(offset);
	});

	let swapAcc = 0;
	let swapLast = 0;
	let state = 0;
	let acc = 0;
	for (let i = 0; i < terms.length; i += 2) {
		const x = terms[i] as number;
		const y = terms[i + 1] as number;

		let t = rol16(((offsets[i] as number) + x) >>> 0);
		let q = mul32(t, 0x76f50f34);
		swapAcc = (swapAcc + ((mul32(rol16(q), 0xc3efea97) + q) >>> 0)) >>> 0;
		t = rol16(((offsets[i + 1] as number) + y) >>> 0);
		q = mul32(t, 0x1881ce3c);
		swapLast = (mul32(rol16(q), 0x35bd1ec9) + q) >>> 0;
		swapAcc = (swapAcc + swapLast) >>> 0;

		state = (mul32(state, keyA) + x) >>> 0;
		state = mul32(rol16(state), 0xcf98b111);
		state = mul32(rol16(state), 0x87085b9f);
		state = mul32(rol16(state), 0x12ceb96d);
		state = mul32(rol16(state), 0x257e1d83);
		acc = (acc + state) >>> 0;

		t = (mul32(state, keyB) + y) >>> 0;
		t = mul32(rol16(t), 0xa27416f5);
		t = mul32(rol16(t), 0xd38396ff);
		state = mul32(rol16(mul32(rol16(t), 0x7c932b89)), 0xbfa49f69);
		acc = (acc + state) >>> 0;
	}

	const out = Buffer.alloc(8);
	out.writeUInt32LE((swapLast ^ state) >>> 0, 0);
	out.writeUInt32LE((swapAcc ^ acc) >>> 0, 4);
	return out;
}

/**
 * 时间片：Unix 秒 → Windows 文件时间，向下取整到 5 分钟，再换算成 100ns。
 * 服务端只认当前时间窗，两边时钟差超过约 2.5 分钟就会 403。
 */
export function gecTicks(unixSeconds: number, clockSkewSeconds = 0): string {
	let ticks = unixSeconds + clockSkewSeconds + WIN_EPOCH_OFFSET;
	ticks -= ticks % 300;
	ticks *= TICKS_PER_SECOND;
	return ticks.toFixed(0);
}

/** 生成 v2 令牌：`<CS64 16 位>-<SHA-256 64 位>`（全大写十六进制） */
export function generateSecMsGecV2(
	unixSeconds: number = Date.now() / 1000,
	clockSkewSeconds = 0,
): string {
	const salt = Buffer.from(
		`${gecTicks(unixSeconds, clockSkewSeconds)}${TRUSTED_CLIENT_TOKEN}`,
		"ascii",
	);
	const digest = createHash("sha256")
		.update(Buffer.concat([GEC_PREFIX, salt]))
		.digest();
	const cs64 = cs64Digest(salt, digest).toString("hex").toUpperCase();
	return `${cs64}-${digest.toString("hex").toUpperCase()}`;
}

/*
 * 时钟偏移修正（拿到服务端 Date 头时调用）：
 * 偏移按「服务端时间 − 本地时间」算，两个方向都要修——本地偏快时时间片会跑到未来窗口，
 * 同样会 403；只有窗口内的秒级抖动（<5s）才忽略，避免引入噪声。
 * 返回 null 表示没法从 Date 头得出偏移（缺头或格式不对），调用方保持原值。
 */
export function clockSkewFromServerDate(
	serverDateHeader: string | null | undefined,
	localSeconds: number = Date.now() / 1000,
): number | null {
	if (!serverDateHeader) return null;
	const serverSeconds = Date.parse(serverDateHeader) / 1000;
	if (!Number.isFinite(serverSeconds)) return null;
	const skew = Math.round((serverSeconds - localSeconds) * 1000) / 1000;
	// 5 分钟窗口下，±2.5 分钟以外才值得修正；窗口内抖动只会引入噪声
	if (Math.abs(skew) < 5) return 0;
	return skew;
}
