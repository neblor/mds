/**
 * 组句出题解析的口径测试：**只拦格式，不拦质量**。
 * 「多写少写几句」「同词重复」「候选词没被挖空就出现在句子里」都必须放行 ——
 * 这些不是跑不了，只是题面质量，交给提示词去要求。
 */
import { describe, expect, it } from "vitest";
import {
	CLOZE_MAX_BLANKS,
	CLOZE_MAX_ITEMS,
	CLOZE_MAX_SENTENCE_CHARS,
	CLOZE_MAX_SENTENCES,
	ClozeParseError,
	parseClozeItems,
	type ClozeItem,
} from "./cloze-parse";

const CANDIDATES = [
	"the",
	"I",
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
				item({
					id: 7,
					blanks: [
						{ index: 1, answer: "Apple" },
						{ index: 2, answer: "umbrella" },
					],
					usedWords: ["apple", "umbrella"],
				}),
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

	it("允许词组答案与任意多个空", () => {
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
				},
			],
		});
		expect(items[0].blanks.map((blank) => blank.answer)).toEqual([
			"give up",
			"happy",
			"give up",
			"practice",
		]);
		// usedWords 由答案现算（去重），模型给不给、给得对不对都不影响解析
		expect(items[0].usedWords).toEqual(["give up", "happy", "practice"]);
	});

	it("blanks 顺序按正文首次出现排列（不是按编号大小）", () => {
		const items = parse({
			items: [
				item({
					sentences: ["First comes ##2.", "Then comes ##1."],
					blanks: [
						{ index: 1, answer: "apple" },
						{ index: 2, answer: "orange" },
					],
				}),
			],
		});
		expect(items[0].blanks).toEqual([
			{ index: 2, answer: "orange" },
			{ index: 1, answer: "apple" },
		]);
	});

	it("同一个词填多个空、一句里出现两三个 the：正常放行", () => {
		const items = parse({
			items: [
				{
					sentences: [
						"##1 put ##2 apple on ##3 table.",
						"##4 likes ##5 banana.",
					],
					blanks: [
						{ index: 1, answer: "I" },
						{ index: 2, answer: "the" },
						{ index: 3, answer: "the" },
						{ index: 4, answer: "the" },
						{ index: 5, answer: "the" },
					],
					usedWords: ["I", "the", "the"],
				},
			],
		});
		expect(items[0].blanks.map((blank) => blank.answer)).toEqual([
			"I",
			"the",
			"the",
			"the",
			"the",
		]);
		expect(items[0].usedWords).toEqual(["I", "the"]);
	});

	it("同一个编号在正文里出现多次：多个槽共用一个答案，放行", () => {
		const items = parse({
			items: [
				{
					sentences: ["I eat ##1 and ##1 every day."],
					blanks: [{ index: 1, answer: "apple" }],
				},
			],
		});
		expect(items[0].blanks).toEqual([{ index: 1, answer: "apple" }]);
	});

	it("编号不从 1 连续（##2 / ##5）也能跑，放行", () => {
		const items = parse({
			items: [
				{
					sentences: ["She ##2 the ##5.", "Done."],
					blanks: [
						{ index: 2, answer: "apple" },
						{ index: 5, answer: "orange" },
					],
				},
			],
		});
		expect(items[0].blanks.map((blank) => blank.index)).toEqual([2, 5]);
	});

	it("句数、空数、题数「多了少了」都放行（防护上限内）", () => {
		const oneSentence = parse({
			items: [
				{
					sentences: ["Only one sentence with ##1."],
					blanks: [{ index: 1, answer: "apple" }],
				},
			],
		});
		expect(oneSentence[0].sentences).toHaveLength(1);

		const fourSentences = parse({
			items: [
				{
					sentences: ["A ##1.", "B ##2.", "C.", "D. ##3"],
					blanks: [
						{ index: 1, answer: "apple" },
						{ index: 2, answer: "orange" },
						{ index: 3, answer: "banana" },
					],
				},
			],
		});
		expect(fourSentences[0].sentences).toHaveLength(4);

		const manySentences = parse({
			items: [
				{
					sentences: ["A ##1.", "B.", "C.", "D.", "E.", "F.", "G."],
					blanks: [{ index: 1, answer: "apple" }],
				},
			],
		});
		expect(manySentences[0].sentences).toHaveLength(7);

		const manyItems = parse({
			items: Array.from({ length: CLOZE_MAX_ITEMS }, () => item()),
		});
		expect(manyItems).toHaveLength(CLOZE_MAX_ITEMS);

		const sevenBlanks = parse({
			items: [
				{
					sentences: ["##1 ##2 ##3 ##4 ##5 ##6 ##7"],
					blanks: [1, 2, 3, 4, 5, 6, 7].map((index) => ({
						index,
						answer: "apple",
					})),
				},
			],
		});
		expect(sevenBlanks[0].blanks).toHaveLength(7);
	});

	it("usedWords 缺失 / 多写 / 重复 / 写错都只忽略，不影响解析", () => {
		expect(
			parse({ items: [item({ usedWords: undefined })] })[0].usedWords,
		).toEqual(["apple", "orange"]);
		expect(
			parse({ items: [item({ usedWords: ["apple", "apple", "orange"] })] })[0]
				.usedWords,
		).toEqual(["apple", "orange"]);
		expect(
			parse({ items: [item({ usedWords: ["banana"] })] })[0].usedWords,
		).toEqual(["apple", "orange"]);
	});

	it("候选池里的词没被挖空、直接出现在句子中：放行（I / the 这类词躲不开）", () => {
		const items = parse(
			{
				items: [
					item({
						sentences: [
							"I am happy today and eat ##1.",
							"She bought an ##2.",
						],
					}),
				],
			},
			CANDIDATES,
		);
		expect(items[0].blanks.map((blank) => blank.answer)).toEqual([
			"apple",
			"orange",
		]);
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
});

describe("parseClozeItems 拒绝跑不起来的格式", () => {
	it("没有题目", () => {
		expect(failure({ items: [] })).toContain("没有返回任何题目");
		expect(failure({ foo: 1 })).toContain("没有返回任何题目");
		expect(failure(null)).toContain("没有返回任何题目");
	});

	it("候选池为空", () => {
		expect(failure({ items: [item()] }, [])).toContain("候选词为空");
		expect(failure({ items: [item()] }, ["  "])).toContain("候选词为空");
	});

	it("题数、句数、空数超过防护上限", () => {
		const manyItems = Array.from({ length: CLOZE_MAX_ITEMS + 1 }, () => item());
		expect(failure({ items: manyItems })).toContain(
			`超过防护上限 ${CLOZE_MAX_ITEMS} 道`,
		);

		const manySentences = Array.from(
			{ length: CLOZE_MAX_SENTENCES + 1 },
			() => "Sentence with ##1.",
		);
		expect(failure({ items: [item({ sentences: manySentences })] })).toContain(
			`超过防护上限 ${CLOZE_MAX_SENTENCES} 句`,
		);

		const manyBlanks = Array.from(
			{ length: CLOZE_MAX_BLANKS + 1 },
			(_, i) => `##${i + 1}`,
		).join(" ");
		expect(
			failure({
				items: [
					item({
						sentences: [manyBlanks],
						blanks: Array.from({ length: CLOZE_MAX_BLANKS + 1 }, (_, i) => ({
							index: i + 1,
							answer: "apple",
						})),
					}),
				],
			}),
		).toContain(`超过防护上限 ${CLOZE_MAX_BLANKS} 个`);
	});

	it("没有非空句子 / 没有 ##n 占位符", () => {
		expect(failure({ items: [item({ sentences: ["  ", ""] })] })).toContain(
			"没有非空句子",
		);
		expect(
			failure({ items: [item({ sentences: ["No blank here.", "Nor here."] })] }),
		).toContain("没有 ##n 空占位符");
	});

	it("有句子超过字符上限", () => {
		const long = `${"a".repeat(CLOZE_MAX_SENTENCE_CHARS + 1)} ##1`;
		expect(failure({ items: [item({ sentences: [long] })] })).toContain(
			`超过 ${CLOZE_MAX_SENTENCE_CHARS} 字符`,
		);
	});

	it("正文里的 ##n 没有答案，或答案编号在正文里没有空", () => {
		expect(
			failure({
				items: [
					item({
						blanks: [{ index: 1, answer: "apple" }],
					}),
				],
			}),
		).toContain("的 ##2 没有对应答案");
		expect(
			failure({
				items: [
					item({
						blanks: [
							{ index: 1, answer: "apple" },
							{ index: 2, answer: "orange" },
							{ index: 3, answer: "banana" },
						],
					}),
				],
			}),
		).toContain("的答案编号 3 在短文里没有对应空");
	});

	it("同一个空编号给了多个答案", () => {
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
		).toContain("同一个空编号给了多个答案");
	});

	it("空编号不是正整数 / 没有答案", () => {
		expect(
			failure({
				items: [item({ blanks: [{ index: 0, answer: "apple" }] })],
			}),
		).toContain("不是正整数");
		expect(
			failure({
				items: [
					item({
						blanks: [
							{ index: 1, answer: "" },
							{ index: 2, answer: "orange" },
						],
					}),
				],
			}),
		).toContain("第 1 个空没有答案");
	});

	it("答案不在候选池里（学生选不出来，必须拦）", () => {
		expect(
			failure({
				items: [
					item({
						blanks: [
							{ index: 1, answer: "made-up-word" },
							{ index: 2, answer: "orange" },
						],
					}),
				],
			}),
		).toContain("不在候选词里");
	});

	it("非对象题目 / 缺 sentences / 缺 blanks / 空元素不是对象", () => {
		expect(failure({ items: [42] })).toContain("不是对象");
		expect(failure({ items: [item({ sentences: undefined })] })).toContain(
			"缺少 sentences 数组",
		);
		expect(failure({ items: [item({ blanks: undefined })] })).toContain(
			"缺少 blanks 数组",
		);
		expect(
			failure({
				items: [
					item({
						blanks: [null, { index: 2, answer: "orange" }],
					}),
				],
			}),
		).toContain("第 1 个空不是对象");
	});
});
