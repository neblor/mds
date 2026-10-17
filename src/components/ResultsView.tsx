import { For, Show, createMemo } from "solid-js";
import { Check, X, Sparkles, Star, Volume2 } from "lucide-solid";
import {
	JUDGEMENT_NOTES,
	correctCount,
	isAllCorrectRows,
	highlightWordSegments,
	rowJudgement,
	type ResultField,
	type ResultFieldKind,
	type ResultRow,
} from "~/lib/results";
import type { ContentMode } from "~/lib/state";

interface Props {
	rows: ResultRow[];
	mode: "writing" | "cyber";
	contentMode: ContentMode;
	/** AI 批改来源说明（失败/中止降级提示，仅中文词模式有） */
	gradeNote?: string | null;
	/** 其它结算提示（如组句的语音降级） */
	note?: string | null;
	playingAudioName: string | null;
	onPlayAudio: (audioName: string) => void;
	onClose: () => void;
	/** 复习计划反馈（词表模式结算写回后才有） */
	reviewNote?: string | null;
	/** 覆盖标题（历史回看带时间与模式）；默认「默写结果」 */
	title?: string;
	/** 覆盖底部提示文案；默认回词库引导 */
	footerHint?: string;
	/** 追加到根节点的样式（历史弹窗内需 flex-1 min-h-0 配合 max-h 裁剪滚动） */
	class?: string;
}

function labelOf(kind: ResultFieldKind): string {
	if (kind === "definition") return "释义";
	if (kind === "chinese") return "中文词";
	if (kind === "sentence") return "整句";
	return "单词";
}

/* ---------- 全对庆祝：两波星星上浮 + 中心礼花 ---------- */
interface StarSpec {
	left: number;
	size: number;
	delay: number;
	dur: number;
	drift: number;
	spin: number;
	scale: number;
	twinkle: number;
}

const WAVE_A: StarSpec[] = [
	{ left: 8, size: 26, delay: 0, dur: 1.9, drift: -34, spin: -30, scale: 1.0, twinkle: 0 },
	{ left: 18, size: 20, delay: 0.14, dur: 1.75, drift: 22, spin: 26, scale: 0.9, twinkle: 0.25 },
	{ left: 28, size: 32, delay: 0.28, dur: 2.0, drift: -18, spin: 38, scale: 1.1, twinkle: 0.4 },
	{ left: 38, size: 22, delay: 0.42, dur: 1.8, drift: 30, spin: -24, scale: 0.95, twinkle: 0.1 },
	{ left: 48, size: 28, delay: 0.56, dur: 1.95, drift: -26, spin: 20, scale: 1.05, twinkle: 0.3 },
	{ left: 58, size: 20, delay: 0.7, dur: 1.7, drift: 24, spin: -36, scale: 0.9, twinkle: 0.55 },
	{ left: 68, size: 30, delay: 0.84, dur: 1.9, drift: -20, spin: 30, scale: 1.08, twinkle: 0.2 },
	{ left: 78, size: 22, delay: 0.98, dur: 1.8, drift: 26, spin: -28, scale: 0.92, twinkle: 0.45 },
	{ left: 88, size: 26, delay: 1.12, dur: 1.85, drift: -30, spin: 24, scale: 1.02, twinkle: 0.15 },
];

const WAVE_B: StarSpec[] = [
	{ left: 13, size: 16, delay: 1.0, dur: 2.1, drift: 18, spin: -20, scale: 0.85, twinkle: 0.3 },
	{ left: 33, size: 14, delay: 1.16, dur: 2.0, drift: -16, spin: 22, scale: 0.8, twinkle: 0.5 },
	{ left: 52, size: 18, delay: 1.32, dur: 2.15, drift: 20, spin: -26, scale: 0.9, twinkle: 0.25 },
	{ left: 72, size: 15, delay: 1.48, dur: 2.05, drift: -22, spin: 28, scale: 0.82, twinkle: 0.55 },
];

function StarBurst(props: { spec: StarSpec }) {
	const s = props.spec;
	return (
		<span
			class="celebrate-star absolute text-gold"
			style={{
				left: `${s.left}%`,
				top: "32%",
				"--drift-x": `${s.drift}px`,
				"--rise-scale": String(s.scale),
				"--rise-spin": `${s.spin}deg`,
				"--rise-dur": `${s.dur}s`,
				"animation-delay": `${s.delay}s`,
			}}
		>
			<span
				class="star-twinkle inline-block"
				style={{ "animation-delay": `${s.twinkle}s` }}
			>
				<Star
					class="text-gold"
					style={{
						width: `${s.size}px`,
						height: `${s.size}px`,
					}}
					fill="currentColor"
					strokeWidth={1}
				/>
			</span>
		</span>
	);
}

function Celebration() {
	return (
		<div class="pointer-events-none absolute inset-0 z-10 overflow-hidden">
			{/* 顶部柔光（约 3.4s 后收缩淡出；margin 居中避免与动画 transform 叠加） */}
			<div class="celebrate-glow absolute left-1/2 top-[16%] ml-[-9rem] h-72 w-72 rounded-full bg-gold/25 blur-3xl" />
			<For each={WAVE_A}>{(spec) => <StarBurst spec={spec} />}</For>
			<For each={WAVE_B}>{(spec) => <StarBurst spec={spec} />}</For>
			{/* 中心主礼花 */}
			<div class="absolute left-1/2 top-[24%] -translate-x-1/2">
				<span class="sparkle-pop inline-block">
					<Sparkles class="h-12 w-12 text-gold" strokeWidth={1.5} />
				</span>
			</div>
		</div>
	);
}

/* ---------- 参考字段行（只对照不批改） ---------- */
function ReferenceFieldLines(props: { field: ResultField }) {
	const f = props.field;
	// 整句很长：换行显示（最多 3 行，悬停可看全文），不做单行截断
	const wrap = f.kind === "sentence" ? "break-words line-clamp-3" : "truncate";
	return (
		<div class="flex flex-col">
			<Show when={f.expected}>
				<span class={`text-[13px] text-ink-faint ${wrap}`} title={f.expected}>
					{labelOf(f.kind)}：{f.expected}
				</span>
			</Show>
			<Show when={f.userValue !== undefined}>
				<span
					class={`text-[13px] text-ink-soft ${wrap}`}
					title={f.userValue}
				>
					我的{labelOf(f.kind)}：{f.userValue || "（未填写）"}
				</span>
			</Show>
			{/* 整句 AI 批改只作参考：graded=false，因此不影响得分 */}
			<Show when={f.correct !== undefined}>
				<span
					class={`flex items-center gap-1 text-[12px] ${f.correct ? "text-ok" : "text-err"}`}
				>
					{f.correct ? <Check class="h-3.5 w-3.5" /> : <X class="h-3.5 w-3.5" />}
					整句{f.correct ? "基本正确" : "有明显出入"}
					<Show when={f.note}>
						<span class="text-ink-faint">· {f.note}</span>
					</Show>
				</span>
			</Show>
		</div>
	);
}

/* ---------- 单行 ---------- */
function ResultRowItem(props: {
	row: ResultRow;
	mode: "writing" | "cyber";
	playingAudioName: string | null;
	onPlayAudio: (audioName: string) => void;
}) {
	const judgement = createMemo(() => rowJudgement(props.row));
	const gradedFields = createMemo(() => props.row.fields.filter((f) => f.graded));
	const references = createMemo(() => props.row.fields.filter((f) => !f.graded));
	const bg = () => {
		const j = judgement();
		if (j === true) return "bg-ok-bg";
		if (j === false) return "bg-err-bg";
		return "bg-surface shadow-sm";
	};

	return (
		<div class={`flex items-center gap-3 rounded-lg px-4 py-3 ${bg()}`}>
			<Show when={props.mode === "cyber" && judgement() !== undefined}>
				{judgement() ? (
					<Check class="h-4 w-4 shrink-0 text-ok" />
				) : (
					<X class="h-4 w-4 shrink-0 text-err" />
				)}
			</Show>
			<div class="flex min-w-0 flex-1 flex-col">
				<div class="flex items-center gap-2">
					<span class="text-base font-semibold text-ink">
						{props.row.word}
					</span>
					<button
						type="button"
						class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-faint transition hover:bg-brand/10 hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-35"
						disabled={!props.row.audioName}
						onClick={() => props.onPlayAudio(props.row.audioName)}
						aria-label={`播放 ${props.row.word} 的发音`}
						title={`播放 ${props.row.word} 的发音`}
						aria-pressed={props.playingAudioName === props.row.audioName}
					>
						<Volume2
							class={`h-4 w-4 ${
								props.playingAudioName === props.row.audioName
									? "animate-pulse text-brand"
									: ""
							}`}
						/>
					</button>
				</div>
				{/* 降级说明（短句场次里没有合格短句的词） */}
				<Show when={props.row.note}>
					<span class="text-[12px] text-ink-faint">{props.row.note}</span>
				</Show>
				{/* 组句轮的句子上下文（答案已填入，便于对照自己填错了什么） */}
				<Show when={props.row.context}>
					<span class="truncate text-[13px] text-ink-faint">
						句子：{props.row.context}
					</span>
				</Show>
				{/* 参考字段（书写模式自检 / 无标准答案的对照） */}
				<For each={references()}>
					{(f) => <ReferenceFieldLines field={f} />}
				</For>
				{/* 判定性第二步字段的标准行（题干是英文单词，标准中文词/释义供对照） */}
				<For each={gradedFields().filter((f) => f.kind !== "word" && f.expected)}>
					{(f) => (
						<span class="truncate text-[13px] text-ink-faint">
							{labelOf(f.kind)}：{f.expected}
						</span>
					)}
				</For>
			</div>
			{/* 右侧：全部判定字段的用户作答（赛博模式） */}
			<Show when={props.mode === "cyber" && gradedFields().length > 0}>
				<div class="flex max-w-[40%] flex-col items-end gap-0.5">
					<For each={gradedFields()}>
						{(f) => (
							<span
								class={`w-full truncate text-right text-[15px] ${
									f.correct ? "text-ok" : "text-err"
								}`}
							>
								{f.userValue || "（未填写）"}
							</span>
						)}
					</For>
				</div>
			</Show>
		</div>
	);
}

/* ---------- 短句行：目标词 + 标准整句（高亮目标词）+ 用户整句 + 整句判定 ---------- */
function SentenceResultRow(props: {
	row: ResultRow;
	mode: "writing" | "cyber";
	playingAudioName: string | null;
	onPlayAudio: (audioName: string) => void;
}) {
	const sentenceField = createMemo(() =>
		props.row.fields.find((f) => f.kind === "sentence"),
	);
	/** 判定口径是「整句归一化后全等」（小写 + 去标点 + 压空白），不做 AI 批改 */
	const verdict = () => (props.mode === "cyber" ? sentenceField()?.correct : undefined);
	const standard = () => sentenceField()?.expected ?? props.row.context ?? "";
	const userSentence = () => sentenceField()?.userValue ?? "";
	const playing = () =>
		props.playingAudioName !== null &&
		props.playingAudioName === props.row.audioName;
	const bg = () => {
		if (props.mode !== "cyber") return "bg-surface shadow-sm";
		return verdict() ? "bg-ok-bg" : "bg-err-bg";
	};

	return (
		<div class={`flex flex-col gap-1.5 rounded-lg px-4 py-3 ${bg()}`}>
			{/* 第一行：本句要默的词 + 整句发音（对错靠左侧 ✓/✗ 与底色表达） */}
			<div class="flex items-center gap-2">
				<Show when={verdict() !== undefined}>
					{verdict() ? (
						<Check class="h-4 w-4 shrink-0 text-ok" />
					) : (
						<X class="h-4 w-4 shrink-0 text-err" />
					)}
				</Show>
				<span class="text-base font-semibold text-ink">{props.row.word}</span>
				<span class="text-[12px] text-ink-faint">本句要默的词</span>
				<button
					type="button"
					class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-faint transition hover:bg-brand/10 hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-35"
					disabled={!props.row.audioName}
					onClick={() => props.onPlayAudio(props.row.audioName)}
					aria-label={`播放 ${props.row.word} 所在整句`}
					title={`播放整句（${props.row.word}）`}
					aria-pressed={playing()}
				>
					<Volume2
						class={`h-4 w-4 ${playing() ? "animate-pulse text-brand" : ""}`}
					/>
				</button>
			</div>

			{/* 标准整句：目标词高亮 */}
			<p class="break-words text-[15px] leading-relaxed text-ink" title={standard()}>
				<span class="mr-1 text-[13px] text-ink-faint">标准：</span>
				<For each={highlightWordSegments(standard(), props.row.word)}>
					{(part) => (
						<Show when={part.hit} fallback={<span>{part.text}</span>}>
							<span class="rounded bg-brand/20 px-0.5 font-semibold text-brand">
								{part.text}
							</span>
						</Show>
					)}
				</For>
			</p>

			{/* 用户整句：原样显示（大小写也对得上，方便自己核对） */}
			<Show when={props.mode === "cyber"}>
				<p
					class="break-words text-[15px] leading-relaxed text-ink-soft line-clamp-3"
					title={userSentence()}
				>
					<span class="mr-1 text-[13px] text-ink-faint">我写：</span>
					{userSentence() || "（未填写）"}
				</p>
			</Show>

			{/* 降级说明（该词没有合格短句） */}
			<Show when={props.row.note}>
				<span class="text-[12px] text-ink-faint">{props.row.note}</span>
			</Show>
		</div>
	);
}

export default function ResultsView(props: Props) {
	const correct = createMemo(() => correctCount(props.rows));
	const celebrate = createMemo(
		() => props.mode === "cyber" && isAllCorrectRows(props.rows),
	);

	return (
		<div class={`flex h-full min-h-0 flex-col gap-4 p-7 ${props.class ?? ""}`}>
			{/* 头部：标题 + 得分 + 关闭（结果页只有一个关闭动作，回车也可关闭） */}
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-4">
					<h2 class="font-heading text-2xl text-ink">
						{props.title ?? "默写结果"}
					</h2>
					<Show when={props.mode === "cyber"}>
						<span class="rounded-full bg-soft px-4 py-2 font-data text-xl text-ink">
							{correct()} / {props.rows.length}
						</span>
					</Show>
				</div>
				<button type="button"
					class="flex items-center gap-1 rounded-full bg-surface px-4 py-2 text-sm text-ink-soft shadow-sm transition hover:text-ink"
					onClick={props.onClose}
					aria-label="关闭"
				>
					关闭
					<X class="h-[18px] w-[18px]" />
				</button>
			</div>

			{/* 全对庆祝 */}
			<Show when={celebrate()}>
				<Celebration />
			</Show>

			{/* 对照列表 */}
			<div class="flex flex-col gap-2.5 overflow-y-auto pr-1">
				<For each={props.rows}>
					{(r) => (
						<Show
							when={r.fields.some((f) => f.kind === "sentence")}
							fallback={
								<ResultRowItem
									row={r}
									mode={props.mode}
									playingAudioName={props.playingAudioName}
									onPlayAudio={props.onPlayAudio}
								/>
							}
						>
							<SentenceResultRow
								row={r}
								mode={props.mode}
								playingAudioName={props.playingAudioName}
								onPlayAudio={props.onPlayAudio}
							/>
						</Show>
					)}
				</For>
			</div>

			{/* 复习计划反馈（词表模式）与判定说明（按内容模式） */}
			<div class="flex flex-col items-end gap-0.5">
				<Show when={props.reviewNote}>
					<p class="text-right text-xs text-brand">{props.reviewNote}</p>
				</Show>
				<Show when={props.mode === "cyber"}>
					<p class="text-right text-xs text-ink-faint">
						{JUDGEMENT_NOTES[props.contentMode]}
					</p>
					<Show when={props.gradeNote}>
						<p class="text-right text-xs text-ink-faint/80">
							{props.gradeNote}
						</p>
					</Show>
				</Show>
				<Show when={props.note}>
					<p class="text-right text-xs text-ink-faint/80">{props.note}</p>
				</Show>
			</div>

			{/* 底部提示：回车可关闭，回到词库数据全保留 */}
			<p class="mt-auto text-center text-xs text-ink-faint">
				{props.footerHint ??
				"关闭后回到词库，单词保留；要重默直接点开始，要清空点清空"}
			</p>
		</div>
	);
}
