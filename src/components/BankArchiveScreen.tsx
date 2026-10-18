/**
 * 学习档案（设计中 30 / 31 / 32 屏）
 *
 * 数据来自 GET /api/bank-stats（SQLite）；兼容模式会收到 503，页面给出
 * 「统计暂不可用，不影响默写」而不是空白/崩溃。
 *
 * 结构：Header → 4 KPI → 左列（进度/180 天热力/最近练习）+ 右列（预测/重点词）→ Footer。
 * 布局约定与主界面一致：外层 flex 列，主区 flex-1 min-h-0；窄窗整页滚动。
 */
import {
	For,
	Show,
	createEffect,
	createMemo,
	createSignal,
	onMount,
} from "solid-js";
import {
	ArrowLeft,
	BookOpen,
	History,
	Info,
	Target,
} from "lucide-solid";
import type { BankStatsView } from "~/lib/bank-api";
import { MIN_ACCURACY_SAMPLE } from "~/lib/bank-stats";
import { CONTENT_MODE_LABELS } from "~/lib/results";
import type { WordBanksApi } from "~/lib/use-wordbanks";

const DAY_MS = 24 * 60 * 60 * 1000;
const NUMBER = new Intl.NumberFormat("zh-CN");

interface Props {
	bankId: string;
	api: WordBanksApi;
	onBack: () => void;
	onOpenDetail: (bankId: string) => void;
	/** 空态「开始默写」：走主界面的赛博队列 */
	onStartSession?: () => void;
	/** 专练：关闭档案后由上层开始一场单词 + 赛博 */
	onPracticeWeak: (words: string[]) => void;
}

type Tab = "weak" | "most";

export default function BankArchiveScreen(props: Props) {
	const [stats, setStats] = createSignal<BankStatsView | null>(null);
	const [error, setError] = createSignal<string | null>(null);
	const [loading, setLoading] = createSignal(true);
	const [tab, setTab] = createSignal<Tab>("weak");
	let requestSeq = 0;
	let container: HTMLDivElement | undefined;

	async function load(id: string): Promise<void> {
		const seq = ++requestSeq;
		setLoading(true);
		setError(null);
		try {
			const data = await props.api.loadStats(id);
			if (seq !== requestSeq) return;
			setStats(data);
		} catch (err) {
			if (seq !== requestSeq) return;
			setStats(null);
			setError(err instanceof Error ? err.message : "无法读取学习档案");
		} finally {
			if (seq === requestSeq) setLoading(false);
		}
	}

	// 父级用 bankId 切换档案；effect 同时承担首次加载
	createEffect(() => {
		const id = props.bankId;
		if (id) void load(id);
	});
	onMount(() => {
		requestAnimationFrame(() => container?.focus());
	});

	const bankName = createMemo(() => {
		const id = props.bankId;
		return (
			props.api.banks().find((bank) => bank.id === id)?.name ??
			props.api.activeBank()?.name ??
			"学习档案"
		);
	});

	const total = () => stats()?.coverage.total ?? 0;
	const empty = () => {
		const s = stats();
		return (
			!!s &&
			s.coverage.started === 0 &&
			s.activity.sessions.total === 0 &&
			s.accuracy.all.total === 0
		);
	};
	const headerMeta = () => {
		const s = stats();
		const summary = props.api.banks().find((bank) => bank.id === props.bankId);
		const count = s?.bank.count ?? summary?.count ?? total();
		const sourceValue = s?.bank.source ?? summary?.source ?? "custom";
		const source = sourceValue === "custom" ? "自建词表" : "资源词表";
		const since = s?.meta.statsSince
			? `统计始于 ${formatDate(s.meta.statsSince)}`
			: "还没有记录";
		return `${source} · ${formatCount(count)} 词 · ${since}`;
	};

	const heatWeeks = createMemo(() => {
		const cells = stats()?.activity.heatmap ?? [];
		if (cells.length === 0) return [] as (BankStatsView["activity"]["heatmap"][number] | null)[][];
		const lead = parseDayKey(cells[0].date).getDay();
		const padded: (BankStatsView["activity"]["heatmap"][number] | null)[] = [
			...Array.from({ length: lead }, () => null),
			...cells,
		];
		const weeks: (BankStatsView["activity"]["heatmap"][number] | null)[][] = [];
		for (let i = 0; i < padded.length; i += 7) {
			weeks.push(padded.slice(i, i + 7));
		}
		return weeks;
	});

	const heatTotal = () =>
		(stats()?.activity.heatmap ?? []).reduce(
			(sum, day) => sum + day.attempts,
			0,
		);
	const last30 = () => (stats()?.activity.heatmap ?? []).slice(-30);
	const last30Attempts = () =>
		last30().reduce((sum, day) => sum + day.attempts, 0);
	const last30Active = () =>
		last30().filter((day) => day.attempts > 0).length;

	const modeLine = () => {
		const modes = stats()?.modes ?? [];
		const sum = modes.reduce((value, item) => value + item.reviews, 0);
		if (sum === 0) return null;
		return modes
			.filter((item) => item.reviews > 0)
			.map(
				(item) =>
					`${CONTENT_MODE_LABELS[item.mode]} ${Math.round(
						(item.reviews / sum) * 100,
					)}%`,
			)
			.join(" · ");
	};

	const footerLeft = () => {
		const s = stats();
		if (!s) return "正在整理学习档案…";
		if (empty()) {
			return "默完一场后，这里会出现进度、正确率与薄弱词";
		}
		if (!s.activity.sessionsAvailable) {
			return "场次类指标从本版开始 · 正确率与进度可回看历史日志";
		}
		if (s.estimate) {
			return `近 30 天新开始 ${formatCount(s.estimate.newStarted30)} 个词 · 剩余未学词约需 ${
				s.estimate.daysLeft ?? "—"
			} 天才会都开始（估算）`;
		}
		return "";
	};

	const close = () => props.onBack();

	return (
		<div
			ref={container}
			tabIndex={-1}
			role="dialog"
			aria-modal="true"
			aria-label="学习档案"
			class="absolute inset-0 z-30 flex h-full flex-col gap-4 overflow-y-auto bg-canvas p-7 outline-none"
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					event.preventDefault();
					close();
				}
			}}
		>
			{/* Header */}
			<div class="flex shrink-0 items-center justify-between gap-3">
				<div class="flex min-w-0 items-center gap-3">
					<button
						type="button"
						class="shrink-0 rounded-full p-1.5 text-ink-soft transition hover:bg-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
						onClick={close}
						aria-label="返回"
					>
						<ArrowLeft class="h-[22px] w-[22px]" />
					</button>
					<div class="flex min-w-0 flex-col gap-0.5">
						<h2 class="truncate font-heading text-2xl text-ink">
							{bankName()}
						</h2>
						<p class="truncate text-[13px] text-ink-faint">
							{headerMeta()}
						</p>
					</div>
				</div>
				<button
					type="button"
					class="flex shrink-0 items-center gap-1.5 rounded-xl border-[1.5px] border-soft bg-surface px-3 py-2 text-[13px] font-semibold text-ink-soft transition hover:border-brand/40 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
					onClick={() => props.onOpenDetail(props.bankId)}
				>
					<BookOpen class="h-4 w-4" />
					词表内容
				</button>
			</div>

			<Show
				when={!loading()}
				fallback={
					<div class="flex min-h-0 flex-1 flex-col gap-4" aria-busy="true">
						<div class="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4">
							<For each={[0, 1, 2, 3]}>
								{() => (
									<div class="h-[92px] animate-pulse rounded-2xl bg-soft/60" />
								)}
							</For>
						</div>
						<div class="min-h-[480px] flex-1 animate-pulse rounded-2xl bg-soft/60" />
					</div>
				}
			>
				<Show
					when={error()}
					fallback={
						<Show when={stats()} fallback={<ErrorCard message="无法读取学习档案" onBack={close} />}>
							{(s) => (
								<>
									<KpiRow stats={s()} />
									<Show
										when={empty()}
										fallback={
											<div class="flex flex-1 gap-3 max-lg:flex-col">
												<div class="flex min-w-0 flex-1 flex-col gap-3 lg:w-[660px] lg:flex-none">
													<ProgressCard stats={s()} modeLine={modeLine()} />
													<HeatmapCard
														stats={s()}
														weeks={heatWeeks()}
														total={heatTotal()}
														active={last30Active()}
														attempts={last30Attempts()}
													/>
													<RecentCard stats={s()} />
												</div>
												<div class="flex min-w-0 flex-1 flex-col gap-3 lg:w-[392px] lg:flex-none">
													<ForecastCard stats={s()} />
													<WeakWordsCard
														stats={s()}
														tab={tab()}
														onTab={setTab}
														onPractice={props.onPracticeWeak}
													/>
												</div>
											</div>
										}
									>
										<EmptyCard
											stats={s()}
											onStart={props.onStartSession}
											onOpenDetail={() => props.onOpenDetail(props.bankId)}
										/>
									</Show>
									<div class="flex shrink-0 items-center justify-between gap-3 text-[11px] text-ink-faint">
										<span class="min-w-0 truncate">{footerLeft()}</span>
										<span class="shrink-0">Esc 返回 · 数据只保存在本机</span>
									</div>
								</>
							)}
						</Show>
					}
				>
					{(message) => <ErrorCard message={message()} onBack={close} />}
				</Show>
			</Show>
		</div>
	);
}

/* ---------- KPI ---------- */

function KpiRow(props: { stats: BankStatsView }) {
	const s = props.stats;
	const mastery = s.coverage.total > 0
		? (s.coverage.mastered / s.coverage.total) * 100
		: 0;
	const accuracy = s.accuracy.last7;
	const dueToday = s.due.today + s.due.overdue;
	return (
		<div class="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4">
			<div class="flex min-h-[92px] flex-col justify-between rounded-2xl bg-surface p-3.5 shadow-sm">
				<div class="flex items-center justify-between gap-2">
					<span class="text-[12px] text-ink-soft">已掌握</span>
					<span class="font-data text-[12px] font-semibold text-brand tabular-nums">
						{mastery > 0 ? `${mastery.toFixed(1)}%` : s.coverage.total > 0 ? "0.0%" : "—"}
					</span>
				</div>
				<div class="flex items-baseline gap-1">
					<span class="font-data text-2xl font-semibold text-ink tabular-nums">
						{formatCount(s.coverage.mastered)}
					</span>
					<span class="text-[12px] text-ink-faint">
						/ {formatCount(s.coverage.total)}
					</span>
				</div>
				<div class="h-[6px] w-full overflow-hidden rounded-full bg-soft">
					<div
						class="h-full rounded-full bg-brand"
						style={{ width: `${Math.min(100, Math.max(0, mastery))}%` }}
					/>
				</div>
			</div>

			<div class="flex min-h-[92px] flex-col justify-between rounded-2xl bg-surface p-3.5 shadow-sm">
				<span class="text-[12px] text-ink-soft">近 7 天正确率</span>
				<div class="font-data text-2xl font-semibold text-ink tabular-nums">
					{formatAccuracy(accuracy.correct, accuracy.total)}
				</div>
				<div class="text-[11px] text-ink-faint">
					{accuracy.total > 0
						? `${formatCount(accuracy.total)} 题 · ${formatDuration(s.activity.practiceMs7)}`
						: "还没有作答记录"}
				</div>
			</div>

			<div class="flex min-h-[92px] flex-col justify-between rounded-2xl bg-surface p-3.5 shadow-sm">
				<span class="text-[12px] text-ink-soft">连续练习</span>
				<div class="font-data text-2xl font-semibold text-ink tabular-nums">
					{s.activity.sessionsAvailable ? `${s.activity.streak} 天` : "—"}
				</div>
				<div class="text-[11px] text-ink-faint">
					{s.activity.sessionsAvailable
						? `近 30 天活跃 ${s.activity.activeDays30} 天`
						: "场次统计从本版开始"}
				</div>
			</div>

			<div class="flex min-h-[92px] flex-col justify-between rounded-2xl bg-surface p-3.5 shadow-sm">
				<span class="text-[12px] text-ink-soft">今天到期</span>
				<div class="font-data text-2xl font-semibold text-ink tabular-nums">
					{formatCount(dueToday)}
				</div>
				<div class="text-[11px] text-ink-faint">
					积压{" "}
					<span class={s.due.overdue > 0 ? "font-semibold text-err" : undefined}>
						{s.due.overdue}
					</span>{" "}
					· 未来 7 天 {s.due.next7}
				</div>
			</div>
		</div>
	);
}

/* ---------- 左列 ---------- */

function ProgressCard(props: { stats: BankStatsView; modeLine: string | null }) {
	const s = props.stats;
	const total = s.coverage.total;
	const ratio = (value: number) =>
		total > 0 ? `${Math.min(100, (value / total) * 100)}%` : "0%";
	const segments = [
		{ value: s.coverage.mastered, color: "#4EA3A0" },
		{ value: s.coverage.reviewing, color: "#8DC4C1" },
		{ value: s.coverage.learning, color: "#EFC055" },
		{ value: s.coverage.unstarted, color: "#E9EDF1" },
	];
	return (
		<div class="flex flex-col gap-2.5 rounded-2xl bg-surface p-4 shadow-sm">
			<div class="flex items-center justify-between gap-3">
				<span class="text-[14px] font-semibold text-ink">学习进度</span>
				<span class="font-data text-[12px] text-ink-faint tabular-nums">
					已学 {formatCount(s.coverage.started)} / {formatCount(total)}
				</span>
			</div>
			<div class="flex h-2.5 w-full overflow-hidden rounded-full bg-soft">
				<For each={segments}>
					{(segment) => (
						<div
							class="h-full first:rounded-l-full last:rounded-r-full"
							style={{
								width: ratio(segment.value),
								"background-color": segment.color,
							}}
						/>
					)}
				</For>
			</div>
			<div class="flex flex-wrap items-center gap-x-4 gap-y-1.5">
				<LegendItem color="#4EA3A0" label="已掌握" value={s.coverage.mastered} />
				<LegendItem color="#8DC4C1" label="复习中" value={s.coverage.reviewing} />
				<LegendItem color="#EFC055" label="学习中" value={s.coverage.learning} />
				<LegendItem color="#C9D1D9" label="未学" value={s.coverage.unstarted} />
			</div>
			<Show when={props.modeLine}>
				{(line) => (
					<p class="text-[11px] text-ink-faint">近 30 天：{line()}</p>
				)}
			</Show>
		</div>
	);
}

function LegendItem(props: { color: string; label: string; value: number }) {
	return (
		<span class="flex items-center gap-1.5 text-[12px] text-ink-soft">
			<span
				class="h-[7px] w-[7px] rounded-full"
				style={{ "background-color": props.color }}
			/>
			{props.label} {formatCount(props.value)}
		</span>
	);
}

function HeatmapCard(props: {
	stats: BankStatsView;
	weeks: (BankStatsView["activity"]["heatmap"][number] | null)[][];
	total: number;
	active: number;
	attempts: number;
}) {
	const summary = () => {
		if (props.active <= 0) return "近 30 天还没有练习";
		const average = props.attempts / 30;
		const averageText =
			average > 0 && average < 1 ? "<1" : String(Math.round(average));
		return `近 30 天活跃 ${props.active} 天 · 平均 ${averageText} 题/天`;
	};
	return (
		// 高度由内容决定，**不允许被 flex 压缩**：网格区一旦被压扁就会出现内部滚动条
		// （overflow-x-auto 会把 overflow-y 计算成 auto）。行/列不再写死 min-h，
		// 空间不够时由整页滚动，而不是挤卡片。
		<div class="flex min-h-[296px] shrink-0 grow basis-0 flex-col justify-between gap-2.5 rounded-2xl bg-surface p-4 shadow-sm">
			<div class="flex items-center justify-between gap-3">
				<span class="text-[14px] font-semibold text-ink">练习热力</span>
				<span class="font-data text-[12px] text-ink-faint tabular-nums">
					近 {props.stats.meta.heatmapDays} 天 · {formatCount(props.total)} 题
				</span>
			</div>
			{/* 固定高度：7 行 18px 格 + 4px 间距 + 上下内边距 = 158px，留出横向滚动条空间
			    （纵向显式 hidden，避免被浏览器计算成 auto 后冒出滚动条） */}
			<div class="flex h-[176px] shrink-0 items-center overflow-x-auto overflow-y-hidden py-1">
				<div class="mx-auto flex w-max gap-1">
					<For each={props.weeks}>
						{(week) => (
							<div class="flex flex-col gap-1">
								<For each={week}>
									{(day) =>
										day ? (
											<div
												class={`h-[18px] w-[18px] rounded-[3px] ${
													day.date === todayKey() ? "ring-1 ring-brand" : ""
												}`}
												style={{ "background-color": heatColor(day.attempts) }}
												title={`${formatDateKey(day.date)} · 默 ${day.attempts} 题 · 对 ${day.correct}`}
											/>
										) : (
											<div class="h-[18px] w-[18px]" />
										)
									}
								</For>
							</div>
						)}
					</For>
				</div>
			</div>
			<p class="text-[11px] text-ink-faint">
				每格是一天 · 颜色越深，当天默写越多
			</p>
			<div class="flex items-center justify-between gap-3">
				<div class="flex items-center gap-1.5 text-[10px] text-ink-faint">
					<span>少</span>
					<For
						each={[
							"#E9EDF1",
							"rgba(78, 163, 160, 0.18)",
							"rgba(78, 163, 160, 0.38)",
							"rgba(78, 163, 160, 0.65)",
							"#4EA3A0",
						]}
					>
						{(color) => (
							<span
								class="h-[10px] w-[10px] rounded-[2px]"
								style={{ "background-color": color }}
							/>
						)}
					</For>
					<span>多</span>
				</div>
				<span class="truncate text-[11px] text-ink-faint">{summary()}</span>
			</div>
		</div>
	);
}

function RecentCard(props: { stats: BankStatsView }) {
	const recent = props.stats.recentSessions;
	return (
		<div class="flex shrink-0 flex-col gap-2 rounded-2xl bg-surface px-4 py-3 shadow-sm">
			<div class="flex items-center justify-between gap-3">
				<span class="text-[14px] font-semibold text-ink">最近练习</span>
				<span class="text-[11px] text-ink-faint">
					{props.stats.activity.sessionsAvailable ? "近 3 场" : "从本版开始"}
				</span>
			</div>
			<Show
				when={props.stats.activity.sessionsAvailable && recent.length > 0}
				fallback={
					<div class="flex min-h-[76px] flex-col items-center justify-center gap-1 text-center">
						<History class="h-[18px] w-[18px] text-ink-faint" />
						<p class="text-[12px] text-ink-soft">
							场次统计从本版开始记录
						</p>
						<p class="text-[11px] text-ink-faint">
							已有的正确率与学习进度不受影响
						</p>
					</div>
				}
			>
				<div class="flex flex-col gap-1.5">
					<For each={recent.slice(0, 3)}>
						{(session) => (
							<div class="flex items-center gap-2.5">
								<span class="w-[88px] shrink-0 font-data text-[12px] text-ink-soft tabular-nums">
									{formatWhen(session.at)}
								</span>
								<span class="shrink-0 rounded-full bg-[#EDF3F2] px-2 py-[3px] text-[11px] text-ink-soft">
									{session.genMode === "writing" ? "书写" : "赛博"} ·{" "}
									{CONTENT_MODE_LABELS[session.contentMode]}
								</span>
								<span class="flex-1" />
								<span class="font-data text-[13px] font-semibold text-ink tabular-nums">
									{session.genMode === "writing"
										? `— / ${session.wordCount}`
										: `${session.correct ?? 0} / ${session.judged}`}
								</span>
								<span class="w-10 text-right text-[11px] text-ink-faint">
									{formatShortDuration(session.activeMs)}
								</span>
							</div>
						)}
					</For>
				</div>
			</Show>
		</div>
	);
}

/* ---------- 右列 ---------- */

function ForecastCard(props: { stats: BankStatsView }) {
	const forecast = props.stats.due.forecast;
	const max = Math.max(1, ...forecast.map((item) => item.count));
	return (
		<div class="flex shrink-0 flex-col gap-2.5 rounded-2xl bg-surface p-4 shadow-sm">
			<div class="flex items-center justify-between gap-3">
				<span class="text-[14px] font-semibold text-ink">到期预测</span>
				<Show when={props.stats.due.overdue > 0}>
					<span class="rounded-full bg-err-bg px-2 py-[3px] text-[11px] font-semibold text-err">
						积压 {props.stats.due.overdue}
					</span>
				</Show>
			</div>
			<div class="flex items-center justify-between gap-3 text-[11px] text-ink-faint">
				<span>未来 14 天 · 只含已排期卡</span>
				<span class="font-data tabular-nums">峰值 {max}</span>
			</div>
			<div class="flex h-[108px] items-end gap-1">
				<For each={forecast}>
					{(day, index) => (
						<div
							class="min-w-0 flex-1 rounded-t-[3px]"
							style={{
								height:
									day.count > 0
										? `${Math.max(4, (day.count / max) * 100)}%`
										: "4px",
								"background-color":
									index() === 0
										? "#4EA3A0"
										: "rgba(78, 163, 160, 0.32)",
							}}
							title={`${formatDateKey(day.date)} · ${day.count} 个到期`}
						/>
					)}
				</For>
			</div>
			<div class="flex items-center justify-between text-[10px] text-ink-faint">
				<span>今天</span>
				<span>+7 天</span>
				<span>+14 天</span>
			</div>
		</div>
	);
}

function WeakWordsCard(props: {
	stats: BankStatsView;
	tab: Tab;
	onTab: (tab: Tab) => void;
	onPractice: (words: string[]) => void;
}) {
	const weak = () => props.stats.words.weak;
	const most = () => props.stats.words.mostPracticed;
	const rows = () => (props.tab === "weak" ? weak() : most());
	const canPractice = () => props.tab === "weak" && weak().length > 0;
	return (
		<div class="flex min-h-[300px] flex-1 flex-col gap-2.5 rounded-2xl bg-surface p-4 shadow-sm">
			<div class="flex items-center justify-between gap-3">
				<span class="text-[14px] font-semibold text-ink">重点词</span>
				<div class="flex items-center gap-1">
					<button
						type="button"
						class={`rounded-full px-2.5 py-1 text-[11px] transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
							props.tab === "weak"
								? "bg-brand/10 font-semibold text-brand"
								: "text-ink-faint hover:text-ink"
						}`}
						aria-pressed={props.tab === "weak"}
						onClick={() => props.onTab("weak")}
					>
						薄弱
					</button>
					<button
						type="button"
						class={`rounded-full px-2.5 py-1 text-[11px] transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
							props.tab === "most"
								? "bg-brand/10 font-semibold text-brand"
								: "text-ink-faint hover:text-ink"
						}`}
						aria-pressed={props.tab === "most"}
						onClick={() => props.onTab("most")}
					>
						常练
					</button>
				</div>
			</div>

			<Show
				when={rows().length > 0}
				fallback={
					<p class="py-8 text-center text-[12px] text-ink-faint">
						{props.tab === "weak"
							? "暂时没有需要特别关注的词"
							: "还没有练习记录"}
					</p>
				}
			>
				<div class="flex flex-col gap-1">
					<For each={rows()}>
						{(item) => (
							<div class="flex items-center justify-between gap-3 py-1">
								<span class="min-w-0 truncate font-data text-[14px] font-semibold text-ink">
									{item.word}
								</span>
								<span class="shrink-0 text-right text-[11px] text-ink-faint">
									{"reason" in item
										? `${item.reason} · ${dueLabel(item.dueAt)}`
										: `练 ${item.practiced} 次 · 对 ${item.correct}`}
								</span>
							</div>
						)}
					</For>
				</div>
			</Show>

			<p class="text-[10px] text-ink-faint">
				{props.tab === "weak"
					? "按近 30 天出错与累计重学排序"
					: "按练习次数排序"}
			</p>
			<div class="flex-1" />
			<Show when={canPractice()}>
				<button
					type="button"
					class="flex w-full items-center justify-center gap-1.5 rounded-xl bg-brand/10 px-3 py-2 text-[12px] font-semibold text-brand transition hover:bg-brand/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
					onClick={() => props.onPractice(weak().map((item) => item.word))}
				>
					<Target class="h-4 w-4" />
					专练这 {weak().length} 个（单词 · 赛博）
				</button>
				<p class="text-center text-[10px] text-ink-faint">
					仍按 FSRS 排期，会计入本词库
				</p>
			</Show>
		</div>
	);
}

/* ---------- 空态 / 错误 ---------- */

function EmptyCard(props: {
	stats: BankStatsView;
	onStart?: () => void;
	onOpenDetail: () => void;
}) {
	const hasWords = () => props.stats.coverage.total > 0;
	return (
		<div class="flex min-h-[480px] flex-1 flex-col items-center justify-center gap-3 rounded-2xl bg-surface p-8 text-center shadow-sm">
			<div class="flex h-16 w-16 items-center justify-center rounded-full bg-brand/10">
				<BookOpen class="h-7 w-7 text-brand" />
			</div>
			<h3 class="font-heading text-xl text-ink">这个词表还没开始记录</h3>
			<p class="max-w-[460px] text-[13px] leading-relaxed text-ink-faint">
				默完一场后，这里会出现掌握进度、正确率、练习热度和需要关注的词。
			</p>
			<div class="flex items-center gap-2.5">
				<Show when={hasWords()}>
					<button
						type="button"
						class="flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-[13px] font-semibold text-white transition hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
						onClick={() => props.onStart?.()}
					>
						开始默写
					</button>
				</Show>
				<button
					type="button"
					class="flex items-center gap-1.5 rounded-xl border-[1.5px] border-soft bg-surface px-4 py-2 text-[13px] font-semibold text-ink-soft transition hover:border-brand/40 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
					onClick={props.onOpenDetail}
				>
					<BookOpen class="h-4 w-4" />
					词表内容
				</button>
			</div>
			<p class="text-[11px] text-ink-faint">Esc 返回</p>
		</div>
	);
}

function ErrorCard(props: { message: string; onBack: () => void }) {
	return (
		<div class="flex min-h-[480px] flex-1 flex-col items-center justify-center gap-3 rounded-2xl bg-surface p-8 text-center shadow-sm">
			<div class="flex h-14 w-14 items-center justify-center rounded-full bg-brand/10">
				<Info class="h-6 w-6 text-brand" />
			</div>
			<h3 class="font-heading text-xl text-ink">学习档案暂时打不开</h3>
			<p class="max-w-[560px] text-[13px] leading-relaxed text-ink-soft">
				{props.message}
			</p>
			<button
				type="button"
				class="rounded-xl bg-brand px-4 py-2 text-[13px] font-semibold text-white transition hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
				onClick={props.onBack}
			>
				返回
			</button>
		</div>
	);
}

/* ---------- 格式化 ---------- */

function formatCount(value: number): string {
	return NUMBER.format(Math.max(0, Math.round(value)));
}

function formatAccuracy(correct: number, total: number): string {
	if (total < MIN_ACCURACY_SAMPLE) return "—";
	return `${Math.round((correct / total) * 100)}%`;
}

function formatDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms <= 0) return "0 分钟";
	const minutes = Math.max(1, Math.round(ms / 60_000));
	if (minutes < 60) return `${minutes} 分钟`;
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return rest > 0 ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
}

function formatShortDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms <= 0) return "—";
	return `${Math.max(1, Math.round(ms / 60_000))} 分`;
}

function parseDayKey(key: string): Date {
	const [year, month, day] = key.split("-").map(Number);
	return new Date(year, month - 1, day);
}

function todayKey(): string {
	return localKey(new Date());
}

function localKey(date: Date): string {
	const month = `${date.getMonth() + 1}`.padStart(2, "0");
	const day = `${date.getDate()}`.padStart(2, "0");
	return `${date.getFullYear()}-${month}-${day}`;
}

function formatDateKey(key: string): string {
	const date = parseDayKey(key);
	return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function formatDate(ts: number): string {
	const date = new Date(ts);
	return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function formatWhen(ts: number): string {
	const date = new Date(ts);
	const now = new Date();
	const time = `${`${date.getHours()}`.padStart(2, "0")}:${`${date.getMinutes()}`.padStart(2, "0")}`;
	if (localKey(date) === localKey(now)) return `今天 ${time}`;
	const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
	if (localKey(date) === localKey(yesterday)) return `昨天 ${time}`;
	return formatDate(ts);
}

function dueLabel(dueAt: string | null): string {
	if (!dueAt) return "—";
	const due = new Date(dueAt);
	if (Number.isNaN(due.getTime())) return "—";
	const now = new Date();
	const dueStart = new Date(due.getFullYear(), due.getMonth(), due.getDate());
	const nowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const diff = Math.round((dueStart.getTime() - nowStart.getTime()) / DAY_MS);
	if (diff < 0) return "已到期";
	if (diff === 0) return "今天";
	if (diff === 1) return "明天";
	return `${diff} 天后`;
}

function heatColor(attempts: number): string {
	if (attempts <= 0) return "#E9EDF1";
	if (attempts < 5) return "rgba(78, 163, 160, 0.18)";
	if (attempts < 10) return "rgba(78, 163, 160, 0.38)";
	if (attempts < 20) return "rgba(78, 163, 160, 0.65)";
	return "#4EA3A0";
}
