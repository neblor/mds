import { describe, expect, it } from "vitest";
import {
	isJsonImportRequest,
	normalizeApiAudioFetchDest,
	normalizeJsonImportFetchDest,
} from "../../scripts/vite-api-media-route.mjs";

describe("Vite dev /api/audio routing", () => {
	it("把浏览器 audio 目的请求交回 Nitro 动态路由", () => {
		const request = {
			url: "/api/audio?name=verify.mp3",
			headers: { "sec-fetch-dest": "audio" },
		};
		expect(normalizeApiAudioFetchDest(request)).toBe(true);
		expect(request.headers["sec-fetch-dest"]).toBe("empty");
	});

	it("不改写其他静态媒体或普通 API fetch", () => {
		const staticAudio = {
			url: "/sounds/click.mp3",
			headers: { "sec-fetch-dest": "audio" },
		};
		const apiFetch = {
			url: "/api/audio?name=verify.mp3",
			headers: { "sec-fetch-dest": "empty" },
		};
		expect(normalizeApiAudioFetchDest(staticAudio)).toBe(false);
		expect(normalizeApiAudioFetchDest(apiFetch)).toBe(false);
		expect(staticAudio.headers["sec-fetch-dest"]).toBe("audio");
		expect(apiFetch.headers["sec-fetch-dest"]).toBe("empty");
	});
});

describe("Vite dev JSON 模块路由（nitro 资产白名单缺 json 的补偿）", () => {
	const PNPM_JSON =
		"/node_modules/.pnpm/@solidjs+start@2.0.0-rc.6_@solidjs+router@1.0.0/node_modules/@solidjs/start/package.json";

	it("识别 ?import 的 JSON 模块请求（含时间戳查询参数组合）", () => {
		expect(isJsonImportRequest(`${PNPM_JSON}?import`)).toBe(true);
		expect(isJsonImportRequest(`${PNPM_JSON}?t=1787981762422&import`)).toBe(true);
		expect(isJsonImportRequest(`${PNPM_JSON}?import&t=1787981762422`)).toBe(true);
		expect(isJsonImportRequest("/src/entry-client.tsx?import")).toBe(false);
		expect(isJsonImportRequest("/api/words.json")).toBe(false);
		expect(isJsonImportRequest(undefined)).toBe(false);
	});

	it("把无 dest/empty dest 的 JSON 模块请求改写为 script，让 Nitro 放行给 Vite", () => {
		const noDest = { url: `${PNPM_JSON}?import`, headers: {} as Record<string, string> };
		const emptyDest = {
			url: `${PNPM_JSON}?import`,
			headers: { "sec-fetch-dest": "empty" },
		};
		expect(normalizeJsonImportFetchDest(noDest)).toBe(true);
		expect(noDest.headers["sec-fetch-dest"]).toBe("script");
		expect(normalizeJsonImportFetchDest(emptyDest)).toBe(true);
		expect(emptyDest.headers["sec-fetch-dest"]).toBe("script");
	});

	it("已是 script 或非 JSON 模块请求不动", () => {
		const scripted = {
			url: `${PNPM_JSON}?import`,
			headers: { "sec-fetch-dest": "script" },
		};
		const plainJson = {
			url: "/api/data.json",
			headers: { "sec-fetch-dest": "empty" },
		};
		expect(normalizeJsonImportFetchDest(scripted)).toBe(false);
		expect(scripted.headers["sec-fetch-dest"]).toBe("script");
		expect(normalizeJsonImportFetchDest(plainJson)).toBe(false);
		expect(plainJson.headers["sec-fetch-dest"]).toBe("empty");
	});
});
