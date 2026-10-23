import { describe, expect, it, vi } from "vitest";
import { getPhonetics } from "./phonetic-service";

function response(content: unknown, finishReason = "stop") {
	return new Response(
		JSON.stringify({
			choices: [
				{
					finish_reason: finishReason,
					message: {
						content:
							typeof content === "string" ? content : JSON.stringify(content),
					},
				},
			],
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
}

function memoryStorage() {
	let file: unknown;
	return {
		storage: {
			readPhonetics: () => file,
			writePhonetics: (value: unknown) => {
				file = value;
			},
		},
		read: () => file,
	};
}

const base = {
	baseUrl: "https://ai.example/v1",
	apiKey: "secret",
	model: "test-model",
};

describe("getPhonetics", () => {
	it("首次请求后写缓存；第二次命中不再请求", async () => {
		const memory = memoryStorage();
		const fetchMock = vi.fn(async () =>
			response({
				phonetics: { apple: [["ˈ", "æ", "p", "ə", "l"]] },
			}),
		);
		const first = await getPhonetics({
			...base,
			words: ["apple"],
			storage: memory.storage,
			fetchImpl: fetchMock as unknown as typeof fetch,
		});
		expect(first.phonetics.apple?.[0]).toEqual([
			"ˈ",
			"æ",
			"p",
			"ə",
			"l",
		]);
		expect(first.cachedCount).toBe(0);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(memory.read()).toMatchObject({
			model: "test-model",
			promptVersion: 1,
		});

		const second = await getPhonetics({
			...base,
			words: ["apple"],
			storage: memory.storage,
			fetchImpl: fetchMock as unknown as typeof fetch,
		});
		expect(second.cachedCount).toBe(1);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("缺失词不写负缓存：第二次仍只请求缺失词", async () => {
		const memory = memoryStorage();
		const fetchMock = vi.fn(async () =>
			response({ phonetics: { apple: [["ˈ", "æ", "p", "ə", "l"]] } }),
		);
		const first = await getPhonetics({
			...base,
			words: ["apple", "zzz"],
			storage: memory.storage,
			fetchImpl: fetchMock as unknown as typeof fetch,
		});
		expect(first.missing).toEqual(["zzz"]);
		const cached = memory.read() as { phonetics: Record<string, unknown> };
		expect(cached.phonetics).not.toHaveProperty("zzz");

		await getPhonetics({
			...base,
			words: ["apple", "zzz"],
			storage: memory.storage,
			fetchImpl: fetchMock as unknown as typeof fetch,
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
		const body = JSON.parse(
			String(
				(fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body,
			),
		) as { messages: { content: string }[] };
		expect(body.messages[1]?.content).toBe(JSON.stringify(["zzz"]));
	});

	it("model 变化视为未命中；坏缓存不抛错", async () => {
		const memory = memoryStorage();
		const fetchMock = vi.fn(async () =>
			response({ phonetics: { apple: [["ˈ", "æ", "p", "ə", "l"]] } }),
		);
		await getPhonetics({
			...base,
			words: ["apple"],
			storage: memory.storage,
			fetchImpl: fetchMock as unknown as typeof fetch,
		});
		memory.storage.writePhonetics({
			model: "old-model",
			promptVersion: 1,
			phonetics: { apple: [["x"]] },
		});
		const result = await getPhonetics({
			...base,
			words: ["apple"],
			storage: memory.storage,
			fetchImpl: fetchMock as unknown as typeof fetch,
		});
		expect(result.cachedCount).toBe(0);
		expect(fetchMock).toHaveBeenCalledTimes(2);

		memory.storage.writePhonetics({ nonsense: true });
		const broken = await getPhonetics({
			...base,
			words: ["apple"],
			storage: memory.storage,
			fetchImpl: fetchMock as unknown as typeof fetch,
		});
		expect(broken.phonetics.apple?.length).toBeGreaterThan(0);
	});

	it("AI 无有效音标时保留缓存并给出 warning，不写坏缓存", async () => {
		const memory = memoryStorage();
		memory.storage.writePhonetics({
			model: "test-model",
			promptVersion: 1,
			phonetics: { apple: [["ˈ", "æ", "p", "ə", "l"]] },
		});
		const fetchMock = vi.fn(async () => response({ phonetics: {} }));
		const result = await getPhonetics({
			...base,
			words: ["apple", "zzz"],
			storage: memory.storage,
			fetchImpl: fetchMock as unknown as typeof fetch,
		});
		expect(result.phonetics.apple?.length).toBeGreaterThan(0);
		expect(result.missing).toEqual(["zzz"]);
		expect(result.warning).toContain("未返回任何有效音标");
	});
});
