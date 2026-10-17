/**
 * 官方 PET 词表解析的口径测试：用的是 PDF 里真实出现过的行形态
 * （词性组合、地区注记、可选片段、斜杠变体、占位符、例句与页眉页脚）。
 */
import { describe, expect, it } from "vitest";
import {
	joinWrappedLines,
	parsePetTopicWordList,
	parsePetVocabularyList,
	parsePetWordSetsText,
	reflowEntryLines,
} from "./pet-wordlist";

/** 拼一段「像 pdftotext 输出」的文本 */
function text(...lines: string[]): string {
	return lines.join("\n");
}

describe("parsePetVocabularyList 基本解析", () => {
	it("取词头，剥掉词性与地区注记", () => {
		expect(
			parsePetVocabularyList(
				text(
					"autumn (n) (Br Eng) (Am Eng: fall)",
					"all (adj, adv, det & pron)",
					"ages (n pl)",
					"according to (prep phr)",
					"be (av & v)",
				),
			),
		).toEqual(["autumn", "all", "ages", "according to", "be"]);
	});

	it("跳过例句、字母分区标题、页眉页脚与版权行", () => {
		expect(
			parsePetVocabularyList(
				text(
					"A",
					"ability (n)",
					"• be able to",
					"• The film is about a small boy. (prep)",
					"© CUPA 2025",
					"Page 4 of 53",
					"B1 Preliminary and Preliminary",
					"david@cambridge.org",
					"zebra (n)",
				),
			),
		).toEqual(["ability", "zebra"]);
	});

	it("多词短语原样保留（词组也是可默写的词条）", () => {
		expect(
			parsePetVocabularyList(
				text(
					"swimming costume (n)",
					"boarding pass (n)",
					"disc jockey (DJ) (n)",
					"ad (advertisement) (n)",
				),
			),
		).toEqual(["swimming costume", "boarding pass", "disc jockey", "ad"]);
	});

	it("去掉 sb / sth 占位与首尾标点，保留缩写内的点", () => {
		expect(
			parsePetVocabularyList(
				text(
					"deal with (sth/sb) (phr v)",
					"congratulations! (exclam)",
					"a.m. (adv)",
					"p.m. (adv)",
				),
			),
		).toEqual(["deal with", "congratulations", "a.m.", "p.m."]);
	});
});

describe("parsePetVocabularyList 变体展开", () => {
	it("可选片段两种写法都收（限 1–4 个字母的小写片段）", () => {
		expect(
			parsePetVocabularyList(
				text(
					"blond(e) (adj)",
					"yog(h)urt (n)",
					"gram(me) (n)",
					"forward(s) (adv)",
					"wool(len) (adj)",
				),
			),
		).toEqual([
			"blond",
			"blonde",
			"yogurt",
			"yoghurt",
			"gram",
			"gramme",
			"forward",
			"forwards",
			"wool",
			"woollen",
		]);
	});

	it("超过 4 个字母的括号片段当注记丢掉（disco(theque) 只收 disco）", () => {
		expect(
			parsePetVocabularyList(
				text("disco(theque) (n)", "folder (computer) (n)"),
			),
		).toEqual(["disco", "folder"]);
	});

	it("斜杠两段都收（含词组）", () => {
		expect(
			parsePetVocabularyList(
				text(
					"a/an (det)",
					"centre/center (n)",
					"tooth/teeth (n)",
					"lots / a lot (n)",
					"all right/alright (adj)",
				),
			),
		).toEqual([
			"a",
			"an",
			"centre",
			"center",
			"tooth",
			"teeth",
			"lots",
			"a lot",
			"all right",
			"alright",
		]);
	});

	it("三段及以上的斜杠是整句替换，只取第一段；两段都收", () => {
		expect(
			parsePetVocabularyList(
				text(
					"made of/from/out of (v)",
					"step over/in/on/out of (sth) (v)",
					"step forward/back(wards)/out (v)",
					// 两段都收的代价：upon 也被带进来（它是真实单词，不是噪声）
					"focus (sth) on/upon sth/sb (v)",
				),
			),
		).toEqual(["made of", "step over", "step forward", "focus on", "upon"]);
	});
});

describe("parsePetVocabularyList 去重与过滤", () => {
	it("大小写不敏感去重，保留首次写法", () => {
		expect(
			parsePetVocabularyList(text("apple (n)", "Apple (n)", "APPLE (n)")),
		).toEqual(["apple"]);
	});

	it("过滤掉不像词的候选（无字母、超长、词数过多、异常字符）", () => {
		const longWord = `${"a".repeat(41)} (n)`;
		expect(
			parsePetVocabularyList(
				text(
					"at / @ (n)",
					longWord,
					"one two three four five (n)",
					"£5 (n)",
					"ok (adj)",
				),
			),
		).toEqual(["at", "ok"]);
	});

	it("空文本与纯噪声不报错，返回空表", () => {
		expect(parsePetVocabularyList("")).toEqual([]);
		expect(parsePetVocabularyList(text("A", "• an example", "Page 9 of 53"))).toEqual(
			[],
		);
	});

	it("以（开头的行是上一条的续行，而不是新词条", () => {
		expect(
			parsePetVocabularyList(text("direction", "(n)", "director (n)")),
		).toEqual(["direction", "director"]);
	});
});

describe("joinWrappedLines", () => {
	it("把以（开头的续行并回上一行，并丢掉空行", () => {
		expect(joinWrappedLines(["go", "(with/together)", "", "(phr v)", "goal"])).toEqual([
			"go (with/together) (phr v)",
			"goal",
		]);
	});
});

describe("reflowEntryLines（同一视觉行挤了两条、词性掉到下一行）", () => {
	it("窄栏同行的两条各自成条", () => {
		expect(reflowEntryLines("dinner (n) dinosaur\n(n) diploma (n)")).toEqual([
			"dinner (n)",
			"dinosaur (n)",
			"diploma (n)",
		]);
	});

	it("词性掉到下一行时与上一条词头拼回", () => {
		expect(reflowEntryLines("direction\n(n) directly (adv)\ndirector (n)")).toEqual([
			"direction (n)",
			"directly (adv)",
			"director (n)",
		]);
	});

	it("括号组不规范（不是词性/注记）时不硬分条", () => {
		expect(reflowEntryLines("some (weird 123) thing")).toEqual([]);
	});
});

describe("parsePetTopicWordList（附录 2 主题表）", () => {
	it("跳掉小标题与页眉页脚，保留无词性的词条", () => {
		expect(
			parsePetTopicWordList(
				text(
					"Clothes and Accessories",
					"backpack",
					"wear (out)",
					"© CUPA 2025",
					"Page 45 of 53",
					"for Schools Vocabulary",
					"List",
					"Food and Drink",
					"piece of cake",
					"roast (v & adj)",
				),
			),
		).toEqual(["backpack", "wear", "wear out", "piece of cake", "roast"]);
	});

	it("换行拆开的条目与斜杠变体都能收回来", () => {
		expect(
			parsePetTopicWordList(
				text(
					"jewellery /",
					"jewelry",
					"wet suit, wetsuit",
					"go",
					"(with/together)",
					"(phr v)",
				),
			),
		).toEqual(["jewellery", "jewelry", "wet suit", "wetsuit", "go"]);
	});
});

describe("parsePetWordSetsText（附录 1 词套里印出来的条目）", () => {
	it("取季节、大洲与举例的国家/国籍，丢 etc.", () => {
		const words = parsePetWordSetsText(
			text(
				"Appendix 1",
				"Word sets",
				"Cardinal numbers",
				"one, two, three, etc.",
				"Seasons of the year",
				"spring, summer, autumn, winter",
				"Countries, languages and nationalities",
				"Names of countries, nationalities and languages, for example, Brazil/Brazilian, Canada/Canadian,",
				"China/Chinese, France/French, etc.",
				"Continents",
				"Africa, Antarctica, Asia, Australia, Europe, North America, South America",
			),
		);
		expect(words).toEqual([
			"spring",
			"summer",
			"autumn",
			"winter",
			"Brazil",
			"Brazilian",
			"Canada",
			"Canadian",
			"China",
			"Chinese",
			"France",
			"French",
			"Africa",
			"Antarctica",
			"Asia",
			"Australia",
			"Europe",
			"North America",
			"South America",
		]);
	});
});
