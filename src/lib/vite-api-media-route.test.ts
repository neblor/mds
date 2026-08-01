import { describe, expect, it } from "vitest";
import { normalizeApiAudioFetchDest } from "../../scripts/vite-api-media-route.mjs";

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
