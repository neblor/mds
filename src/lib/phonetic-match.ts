/**
 * 音标判定与 token 级 diff（纯逻辑，可单测）
 *
 * 判定口径（崔总 2026-10-23 确认）：
 * - 主重音 `ˈ` 参与；次重音 `ˌ` 忽略；
 * - 判定前两端都做最大音节首重音归位，所以 `w ˈɔː` 与 `ˈ w ɔː` 等价；
 * - 多读音任意一个匹配即正确；
 * - `i` / `iː` / `ɪ` 不互相宽容。
 */
import { normalizeStressPlacement } from "./phonetic-parse";

/** 判定/展示归一化：重音归位 + 去掉次重音；非法返回 null */
export function normalizeForGrading(tokens: string[]): string[] | null {
	const normalized = normalizeStressPlacement(tokens);
	if (!normalized) return null;
	return normalized.filter((token) => token !== "ˌ");
}

function equalTokens(a: string[], b: string[]): boolean {
	if (a.length !== b.length) return false;
	for (let index = 0; index < a.length; index += 1) {
		if (a[index] !== b[index]) return false;
	}
	return true;
}

/** 返回命中的变体下标；-1 表示未命中 */
export function matchVariant(user: string[], variants: string[][]): number {
	const normalizedUser = normalizeForGrading(user);
	if (!normalizedUser) return -1;
	for (let index = 0; index < variants.length; index += 1) {
		const normalizedVariant = normalizeForGrading(variants[index]);
		if (normalizedVariant && equalTokens(normalizedUser, normalizedVariant)) {
			return index;
		}
	}
	return -1;
}

/** token 级编辑距离（Levenshtein），用于多读音时选最接近的变体做 diff */
export function tokenDistance(expected: string[], actual: string[]): number {
	const rows = expected.length + 1;
	const cols = actual.length + 1;
	let previous = Array.from({ length: cols }, (_, index) => index);
	for (let row = 1; row < rows; row += 1) {
		const current = [row, ...Array<number>(cols - 1).fill(0)];
		for (let col = 1; col < cols; col += 1) {
			const cost = expected[row - 1] === actual[col - 1] ? 0 : 1;
			current[col] = Math.min(
				previous[col] + 1,
				current[col - 1] + 1,
				previous[col - 1] + cost,
			);
		}
		previous = current;
	}
	return previous[cols - 1] ?? 0;
}

/** 多读音时选与用户答案最接近的变体下标；非法/无变体返回 -1 */
export function bestVariantIndex(
	user: string[],
	variants: string[][],
): number {
	const normalizedUser = normalizeForGrading(user);
	if (!normalizedUser) return -1;
	let best = -1;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (let index = 0; index < variants.length; index += 1) {
		const normalizedVariant = normalizeForGrading(variants[index]);
		if (!normalizedVariant) continue;
		const distance = tokenDistance(normalizedUser, normalizedVariant);
		if (distance < bestDistance) {
			best = index;
			bestDistance = distance;
		}
	}
	return best;
}

export type PhoneticDiffStatus = "ok" | "wrong" | "missing" | "extra";

export interface PhoneticDiffPart {
	token: string;
	status: PhoneticDiffStatus;
}

/**
 * token 级 diff：用 LCS + 替换合并，输出 ok/wrong/missing/extra。
 * 输入应是已经 normalizeForGrading 的序列；`wrong` 的 token 是用户写的音素，
 * 标准音素在结果页的「标准音标」行上方对照。
 */
export function diffPhonetic(
	expected: string[],
	actual: string[],
): PhoneticDiffPart[] {
	const m = expected.length;
	const n = actual.length;
	// lcs[i][j] = expected[i..] 与 actual[j..] 的 LCS 长度
	const lcs: number[][] = Array.from({ length: m + 1 }, () =>
		Array<number>(n + 1).fill(0),
	);
	for (let i = m - 1; i >= 0; i -= 1) {
		for (let j = n - 1; j >= 0; j -= 1) {
			lcs[i][j] =
				expected[i] === actual[j]
					? (lcs[i + 1]?.[j + 1] ?? 0) + 1
					: Math.max(lcs[i + 1]?.[j] ?? 0, lcs[i]?.[j + 1] ?? 0);
		}
	}

	const parts: PhoneticDiffPart[] = [];
	let i = 0;
	let j = 0;
	while (i < m || j < n) {
		if (i < m && j < n && expected[i] === actual[j]) {
			parts.push({ token: expected[i], status: "ok" });
			i += 1;
			j += 1;
			continue;
		}
		// 替换：跳过两者不比只跳过一个更差
		const skipBoth = lcs[i + 1]?.[j + 1] ?? 0;
		const skipExpected = lcs[i + 1]?.[j] ?? 0;
		const skipActual = lcs[i]?.[j + 1] ?? 0;
		if (i < m && j < n && 1 + skipBoth >= Math.max(skipExpected, skipActual)) {
			parts.push({ token: actual[j], status: "wrong" });
			i += 1;
			j += 1;
			continue;
		}
		if (i < m && (j >= n || skipExpected >= skipActual)) {
			parts.push({ token: expected[i], status: "missing" });
			i += 1;
			continue;
		}
		parts.push({ token: actual[j], status: "extra" });
		j += 1;
	}
	return parts;
}
