import { describe, expect, it } from "vitest";
import {
	CLOZE_MAX_ANSWERS,
	ClozeParseError,
	parseClozeItems,
	textContainsWord,
	type ClozeItem,
} from "./cloze-parse";

const CANDIDATES = [
	"apple",
	"banana",
	"give up",
	"happy",
	"orange",
	"umbrella",
	"knowledge",
	"practice",
];

/** 一道合法题：2 句、2 空 */
function item(overrides: Record<string, unknown> = {}) {
	return {
		id: 1,
		sentences: ["I like to eat ##1 after lunch.", "She bought an ##2."],
		blanks: [
			{ index: 1, answer: "apple" },
			{ index: 2, answer: "orange" },
		],
		usedWords: ["apple", "orange"],
		...overrides,
	};
}

function parse(raw: unknown, candidates: string[] = CANDIDATES): ClozeItem[] {
	return parseClozeItems(raw, candidates);
}

function failure(raw: unknown, candidates: string[] = CANDIDATES): string {
	try {
		parse(raw, candidates);
	} catch (error) {
		expect(error).toBeInstanceOf(ClozeParseError);
		return (error as ClozeParseError).reason;
	}
	throw new Error("期望解析失败，但解析成功了");
}

describe("parseClozeItems 正常解析", () => {
	it("解析多道题并把答案归一为候选词原始写法", () => {
		const items = parse({
			items: [
				item({ id: 7, blanks: [
					{ index: 1, answer: "Apple" },
					{ index: 2, answer: "umbrella" },
				], usedWords: ["apple", "umbrella"] }),
				{
					id: 2,
					sentences: [
						"Reading gives us ##1 about the world.",
						"You need ##2 to play the piano well.",
					],
					blanks: [
						{ index: 1, answer: "knowledge" },
						{ index: 2, answer: "practice" },
					],
					usedWords: ["knowledge", "practice"],
				},
			],
		});
		expect(items).toHaveLength(2);
		expect(items[0]).toEqual({
			id: 7,
			sentences: ["I like to eat ##1 after lunch.", "She bought an ##2."],
			blanks: [
				{ index: 1, answer: "apple" },
				{ index: 2, answer: "umbrella" },
			],
			usedWords: ["apple", "umbrella"],
		});
		expect(items[1].id).toBe(2);
		expect(items[1].blanks[0].answer).toBe("knowledge");
	});

	it("兼容裸数组与 questions 字段", () => {
		expect(parse([item()])).toHaveLength(1);
		expect(parse({ questions: [item()] })).toHaveLength(1);
	});

	it("缺省 id 时按顺序补 1..n", () => {
		const items = parse({
			items: [item({ id: undefined }), item({ id: undefined })],
		});
		expect(items.map((entry) => entry.id)).toEqual([1, 2]);
	});

	it("允许词组答案与 4 个空", () => {
		const items = parse({
			items: [
				{
					id: 3,
					sentences: [
						"Never ##1 when it is hard.",
						"Do not be ##2 if you ##3.",
						"It is good ##4 for you.",
					],
					blanks: [
						{ index: 1, answer: "give up" },
						{ index: 2, answer: "happy" },
						{ index: 3, answer: "give up" },
						{ index: 4, answer: "practice" },
					],
					usedWords: ["give up", "happy", "practice"],
				},
			],
		});
		expect(items[0].blanks.map((blank) => blank.answer)).toEqual([
			"give up",
			"happy",
			"give up",
			"practice",
		]);
		expect(items[0].usedWords).toEqual(["give up", "happy", "practice"]);
	});

	it("blanks 乱序返回时按空编号归一（渲染与选词都靠下标）", () => {
		const items = parse({
			items: [
				item({
					blanks: [
						{ index: 2, answer: "orange" },
						{ index: 1, answer: "apple" },
					],
					usedWords: ["orange", "apple"],
				}),
			],
		});
		expect(items[0].blanks).toEqual([
			{ index: 1, answer: "apple" },
			{ index: 2, answer: "orange" },
		]);
	});

	it("同一个词在两个空里都用不算错（答案去重后仍合规）", () => {
		const items = parse({
			items: [
				{
					sentences: ["Use ##1 now.", "Use ##2 again."],
					blanks: [
						{ index: 1, answer: "apple" },
						{ index: 2, answer: "apple" },
					],
					usedWords: ["apple"],
				},
			],
		});
		expect(items[0].usedWords).toEqual(["apple"]);
	});
});

describe("parseClozeItems 拒绝非法出题", () => {
	it("没有题目", () => {
		expect(failure({ items: [] })).toContain("没有返回任何题目");
		expect(failure({ foo: 1 })).toContain("没有返回任何题目");
		expect(failure(null)).toContain("没有返回任何题目");
	});

	it("候选池为空", () => {
		expect(failure({ items: [item()] }, [])).toContain("候选词为空");
		expect(failure({ items: [item()] }, ["  "])).toContain("候选词为空");
	});

	it("题目数超上限", () => {
		const many = Array.from({ length: 7 }, () => item());
		expect(failure({ items: many })).toContain("超过上限");
	});

	it("句子数不在 2–3 之间", () => {
		expect(
			failure({ items: [item({ sentences: ["Only ##1 sentence."] })] }),
		).toContain("句子数为 1");
		expect(
			failure({
				items: [
					item({
						sentences: ["A ##1.", "B ##2.", "C.", "D."],
					}),
				],
			}),
		).toContain("句子数为 4");
	});

	it("空数不在 2–4 之间", () => {
		expect(
			failure({
				items: [
					item({
						sentences: ["Only one ##1 here.", "Second sentence."],
						blanks: [{ index: 1, answer: "apple" }],
						usedWords: ["apple"],
					}),
				],
			}),
		).toContain("有 1 个空");
		expect(
			failure({
				items: [
					item({
						sentences: ["a ##1 b ##2 c ##3 d ##4 e ##5", "second"],
						blanks: [1, 2, 3, 4, 5].map((index) => ({
							index,
							answer: "apple",
						})),
						usedWords: ["apple"],
					}),
				],
			}),
		).toContain("有 5 个空");
	});

	it("占位符编号重复或越界", () => {
		expect(
			failure({
				items: [
					item({
						sentences: ["Repeat ##1 and ##1.", "Second ##2."],
						blanks: [
							{ index: 1, answer: "apple" },
							{ index: 2, answer: "orange" },
						],
					}),
				],
			}),
		).toContain("各一次");
		expect(
			failure({
				items: [
					item({
						sentences: ["Out of range ##1 and ##9.", "Second ##2."],
					}),
				],
			}),
		).toContain("各一次");
	});

	it("blanks 数量与占位符不一致 / 空编号重复", () => {
		expect(
			failure({
				items: [
					item({
						blanks: [{ index: 1, answer: "apple" }],
						usedWords: ["apple"],
					}),
				],
			}),
		).toContain("与占位符（2）不一致");
		expect(
			failure({
				items: [
					item({
						blanks: [
							{ index: 1, answer: "apple" },
							{ index: 1, answer: "orange" },
						],
					}),
				],
			}),
		).toContain("空编号有重复");
	});

	it("答案不在候选池里", () => {
		expect(
			failure({
				items: [
					item({
						blanks: [
							{ index: 1, answer: "made-up-word" },
							{ index: 2, answer: "orange" },
						],
						usedWords: ["made-up-word", "orange"],
					}),
				],
			}),
		).toContain("不在候选词里");
	});

	it("usedWords 与实际答案不一致", () => {
		expect(
			failure({ items: [item({ usedWords: ["apple"] })] }),
		).toContain("usedWords 与实际答案不一致");
		expect(
			failure({ items: [item({ usedWords: ["apple", "apple"] })] }),
		).toContain("usedWords 与实际答案不一致");
		expect(failure({ items: [item({ usedWords: undefined })] })).toContain(
			"usedWords 与实际答案不一致",
		);
	});

	it("全场答案词去重后超过 16 个", () => {
		const candidates = Array.from({ length: 20 }, (_, i) => `word${i}`);
		const sentences = ["Fill ##1 and ##2 here.", "Fill ##3 and ##4 here."];
		const items = Array.from({ length: 4 }, (_, group) => ({
			sentences,
			blanks: [0, 1, 2, 3].map((offset) => ({
				index: offset + 1,
				answer: candidates[group * 4 + offset],
			})),
			usedWords: [0, 1, 2, 3].map(
				(offset) => candidates[group * 4 + offset],
			),
		}));
		expect(parse({ items }, candidates)[0].blanks).toHaveLength(4);
		items.push({
			sentences,
			blanks: [0, 1, 2, 3].map((offset) => ({
				index: offset + 1,
				answer: candidates[16 + offset],
			})),
			usedWords: [0, 1, 2, 3].map((offset) => candidates[16 + offset]),
		});
		expect(failure({ items }, candidates)).toContain(
			`超过上限 ${CLOZE_MAX_ANSWERS} 个`,
		);
	});

	it("短文里出现未挖空的候选词（含大小写与词边界）", () => {
		expect(
			failure({
				items: [
					item({
						sentences: ["I am happy today and eat ##1.", "She bought an ##2."],
					}),
				],
			}),
		).toContain("没被挖空的候选词「happy」");
		expect(
			failure({
				items: [
					item({
						sentences: ["I am HAPPY today and eat ##1.", "She bought an ##2."],
					}),
				],
			}),
		).toContain("「happy」");
		expect(
			failure({
				items: [
					item({
						sentences: ["Never give up and eat ##1.", "She bought an ##2."],
					}),
				],
			}),
		).toContain("「give up」");
	});

	it("允许答案词本身在句子里出现（它就是被挖的那个空）", () => {
		const items = parse({
			items: [
				item({
					sentences: ["An apple is sweet.", "I eat ##1 and ##2."],
				}),
			],
		});
		expect(items[0].blanks[0].answer).toBe("apple");
	});

	it("非对象题目 / 缺 sentences / 缺 blanks", () => {
		expect(failure({ items: [42] })).toContain("不是对象");
		expect(failure({ items: [item({ sentences: undefined })] })).toContain(
			"缺少 sentences 数组",
		);
		expect(failure({ items: [item({ blanks: undefined })] })).toContain(
			"缺少 blanks 数组",
		);
	});
});

describe("textContainsWord", () => {
	it("按词边界匹配，不做子串误判", () => {
		expect(textContainsWord("I like apples.", "apple")).toBe(false);
		expect(textContainsWord("I like an apple.", "apple")).toBe(true);
		expect(textContainsWord("Apple pie.", "apple")).toBe(true);
		expect(textContainsWord("give up now", "give up")).toBe(true);
		expect(textContainsWord("giveup now", "give up")).toBe(false);
		expect(textContainsWord("", "apple")).toBe(false);
	});
});
