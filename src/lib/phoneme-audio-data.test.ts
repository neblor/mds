import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { IPA_STRESS, IPA_SYMBOLS } from "./phonetic-symbols";

const audioDir = fileURLToPath(
	new URL("../../public/ipa/audio/v1/", import.meta.url),
);
const manifest = JSON.parse(
	readFileSync(join(audioDir, "manifest.json"), "utf8"),
) as {
	version: number;
	basePath: string;
	license: string;
	tokens: Record<
		string,
		{
			file: string;
			kind: "vowel" | "consonant" | "diphthong";
			durationMs: number;
			sourceIds: string[];
			components?: string[];
		}
	>;
	sources: Record<
		string,
		{
			title: string;
			author: string;
			license: string;
			page: string;
			download?: string;
		}
	>;
};

const expectedTokens = IPA_SYMBOLS.filter(
	(token) => !IPA_STRESS.includes(token as (typeof IPA_STRESS)[number]),
);

function isMp3(buffer: Buffer): boolean {
	const id3 = buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33;
	const frame = buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
	return id3 || frame;
}

describe("音素音频资产（public/ipa/audio/v1）", () => {
	it("manifest schema 与 token 覆盖完整", () => {
		expect(manifest.version).toBe(1);
		expect(manifest.basePath).toBe("/ipa/audio/v1/");
		expect(manifest.license).toContain("CC BY-SA 4.0");
		expect(Object.keys(manifest.tokens).sort()).toEqual(
			[...expectedTokens].sort(),
		);
		expect(Object.keys(manifest.tokens)).toHaveLength(45);
		expect(manifest.tokens["ˈ"]).toBeUndefined();
		expect(manifest.tokens["ˌ"]).toBeUndefined();
		expect(Object.keys(manifest.sources)).toHaveLength(37);
	});

	it("每个音素有可播放的 MP3、合法时长与来源", () => {
		const files = new Set<string>();
		for (const [token, entry] of Object.entries(manifest.tokens)) {
			expect(entry.file).toMatch(/^[a-z][a-z-]*\.mp3$/);
			expect(files.has(entry.file)).toBe(false);
			files.add(entry.file);
			const path = join(audioDir, entry.file);
			const bytes = statSync(path).size;
			expect(bytes).toBeGreaterThan(1000);
			expect(bytes).toBeLessThan(100 * 1024);
			expect(isMp3(readFileSync(path))).toBe(true);
			expect(entry.durationMs).toBeGreaterThan(100);
			expect(entry.durationMs).toBeLessThan(3000);
			expect(["vowel", "consonant", "diphthong"]).toContain(entry.kind);
			expect(entry.sourceIds.length).toBeGreaterThan(0);
			for (const id of entry.sourceIds) {
				expect(manifest.sources[id]).toBeDefined();
			}
			// token 的 key 与 manifest 对齐（防呆：构建脚本写错 key）
			expect(IPA_SYMBOLS).toContain(token);
		}
		expect(files.size).toBe(45);
	});

	it("双元音是两条源音的拼接，且长短元音时长有区分", () => {
		const diphthongs = ["eɪ", "aɪ", "ɔɪ", "əʊ", "aʊ", "ɪə", "eə", "ʊə"];
		for (const token of diphthongs) {
			const entry = manifest.tokens[token];
			expect(entry.kind).toBe("diphthong");
			expect(entry.components).toHaveLength(2);
			expect(entry.components?.every((part) => part === "a" || manifest.tokens[part])).toBe(true);
		}
		expect(manifest.tokens["iː"].durationMs).toBeGreaterThan(
			manifest.tokens["i"].durationMs,
		);
		expect(manifest.tokens["uː"].durationMs).toBeGreaterThan(
			manifest.tokens["ʊ"].durationMs,
		);
		expect(manifest.tokens["ɑː"].durationMs).toBeGreaterThan(
			manifest.tokens["ʌ"].durationMs,
		);
	});

	it("来源/许可元数据完整，且逐文件写入 LICENSE.md", () => {
		const license = readFileSync(join(audioDir, "LICENSE.md"), "utf8");
		expect(license).toContain("CC BY-SA 4.0");
		expect(license).toContain("Public domain");
		expect(license).toContain("CC0");
		expect(license.match(/^\| [^|]+\.mp3 \|/gm) ?? []).toHaveLength(45);

		for (const entry of Object.values(manifest.sources)) {
			expect(entry.title).toBeTruthy();
			expect(entry.author).toBeTruthy();
			expect(entry.license).toBeTruthy();
			expect(entry.page).toMatch(
				/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/,
			);
		}
		expect(manifest.sources["close-front"].author).toBe("Denelson83");
		expect(manifest.sources["dzh"].license).toBe("Public domain");
		expect(manifest.sources["r"].license).toBe("CC0");
		for (const entry of Object.values(manifest.tokens)) {
			expect(license).toContain(entry.file);
		}
	});

	it("总体积可控（< 1 MB）", () => {
		const total = Object.values(manifest.tokens).reduce(
			(sum, entry) => sum + statSync(join(audioDir, entry.file)).size,
			0,
		);
		expect(total).toBeLessThan(1024 * 1024);
	});
});
