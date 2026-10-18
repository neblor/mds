import { For, Show, createSignal } from "solid-js";
import {
	Star,
	Settings,
	PenLine,
	Keyboard,
	Trash2,
	X,
	ListPlus,
	Type,
	BookOpen,
	Languages,
	TextCursorInput,
	MessageSquareQuote,
	History,
	Undo2,
} from "lucide-solid";
import BatchImportDialog from "~/components/BatchImportDialog";
import BankPickerDialog from "~/components/BankPickerDialog";
import ManifestUpdateDialog from "~/components/ManifestUpdateDialog";
import NewBankDialog from "~/components/NewBankDialog";
import BankDetailScreen from "~/components/BankDetailScreen";
import BankArchiveScreen from "~/components/BankArchiveScreen";
import BankSourceCard from "~/components/BankSourceCard";
import SourceModeSwitch from "~/components/SourceModeSwitch";
import TodayQueueCard from "~/components/TodayQueueCard";
import SegmentedSlider, {
	type SliderOption,
} from "~/components/SegmentedSlider";
import ModeActions from "~/components/ModeActions";
import type { SpeedLevel } from "~/lib/timing";
import type { ContentMode } from "~/lib/state";
import type { WordBanksApi } from "~/lib/use-wordbanks";

interface Props {
	/** 词库/复习状态层（录入 / 词表 双模式与今日队列） */
	vocab: WordBanksApi;
	/** 录入模式的单词表 */
	words: string[];
	speed: SpeedLevel;
	contentMode: ContentMode;
	error: string | null;
	onAdd: (word: string) => void;
	onAddMany: (words: string[]) => void;
	onRemove: (word: string) => void;
	onClear: () => void;
	onSpeed: (s: SpeedLevel) => void;
	onContentMode: (m: ContentMode) => void;
	onStartWriting: () => void;
	onStartCyber: () => void;
	/** 档案页「专练薄弱词」：由上层开始一场单词 + 赛博 */
	onStartDrill: (bankId: string, words: string[]) => void;
	onOpenSettings: () => void;
	onOpenHistory: () => void;
	/** 暂存词表数量（再次默写覆盖前存的当前词表）；>0 时显示「恢复词汇」按钮 */
	stashCount?: number;
	onRestoreStash: () => void;
}

const SPEED_LEVELS: { key: SpeedLevel; label: string }[] = [
	{ key: "fast", label: "快" },
	{ key: "normal", label: "中" },
	{ key: "slow", label: "慢" },
];

const CONTENT_MODES: SliderOption<ContentMode>[] = [
	{ value: "word", label: "单词", icon: Type },
	{ value: "definition", label: "释义", icon: BookOpen },
	{ value: "chinese", label: "中文词", icon: Languages },
	{ value: "sentence", label: "短句", icon: MessageSquareQuote },
	{ value: "cloze", label: "组句", icon: TextCursorInput },
];

export default function WordBank(props: Props) {
	const [input, setInput] = createSignal("");
	const [batchOpen, setBatchOpen] = createSignal(false);
	const [pickerOpen, setPickerOpen] = createSignal(false);
	const [manifestOpen, setManifestOpen] = createSignal(false);
	const [newBankOpen, setNewBankOpen] = createSignal(false);
	const [detailBankId, setDetailBankId] = createSignal<string | null>(null);
	const [archiveBankId, setArchiveBankId] = createSignal<string | null>(null);
	let archiveTrigger: HTMLButtonElement | undefined;

	const submit = () => {
		const v = input().trim();
		if (!v) return;
		props.onAdd(v);
		setInput("");
	};

	const isEntry = () => props.vocab.mode() === "entry";
	const bannerError = () => props.error ?? props.vocab.error();
	/** 组句只允许赛博作答：书写按钮置灰 + 信息条说明原因 */
	const clozeOnly = () => props.contentMode === "cloze";
	/** 本次默写要用的词（模式操作区用；录入模式没有队列） */
	const queueWords = () => props.vocab.queue()?.queue.words ?? [];

	return (
		<div class="relative flex h-full flex-col gap-5 p-7">
			{/* 头部 */}
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-3">
					<Star class="h-9 w-9 text-gold" fill="currentColor" strokeWidth={1} />
					<div class="flex flex-col gap-0.5">
						<h1 class="font-heading text-3xl text-ink">默点啥</h1>
						<p class="text-[13px] text-ink-faint">记单词 · 听写 · 默写小帮手</p>
					</div>
				</div>
				<div class="flex items-center gap-1">
					<button
						type="button"
						class="rounded-full p-2 text-ink-faint transition hover:bg-soft hover:text-ink"
						onClick={props.onOpenHistory}
						aria-label="默写记录"
						title="最近几场默写记录"
					>
						<History class="h-[22px] w-[22px]" />
					</button>
					<button
						type="button"
						class="rounded-full p-2 text-ink-faint transition hover:bg-soft hover:text-ink"
						onClick={props.onOpenSettings}
						aria-label="设置"
					>
						<Settings class="h-[22px] w-[22px]" />
					</button>
				</div>
			</div>

			{/* 词源模式：录入 / 词表 */}
			<SourceModeSwitch
				mode={props.vocab.mode()}
				onChange={props.vocab.setMode}
			/>

			{/* 词源：录入模式是输入框，词表模式是「当前词表 + 今天默几个」 */}
			<Show
				when={isEntry()}
				fallback={
					<BankSourceCard
						bankName={props.vocab.activeBank()?.name ?? null}
						hasBank={Boolean(props.vocab.activeBankId())}
						todayTarget={props.vocab.todayTarget()}
						busy={props.vocab.busy()}
						onOpenPicker={() => setPickerOpen(true)}
						onTodayTarget={props.vocab.setTodayTarget}
						onOpenArchive={() => {
							const bankId = props.vocab.activeBankId();
							if (bankId) setArchiveBankId(bankId);
						}}
						archiveButtonRef={(el) => {
							archiveTrigger = el;
						}}
					/>
				}
			>
				<div class="flex items-center gap-2.5 rounded-2xl bg-surface px-4 py-3.5 shadow-sm">
					<PenLine class="h-5 w-5 shrink-0 text-brand" />
					<input
						class="w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-faint"
						placeholder="输入单词或词组，回车添加…"
						value={input()}
						onInput={(e) => setInput(e.currentTarget.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") submit();
						}}
					/>
					<button
						type="button"
						class="flex shrink-0 items-center gap-1.5 rounded-xl bg-canvas px-3 py-2 text-[13px] font-semibold text-ink-soft transition hover:bg-soft hover:text-ink"
						onClick={() => setBatchOpen(true)}
					>
						<ListPlus class="h-4 w-4 text-brand" />
						批量导入
					</button>
					<Show when={(props.stashCount ?? 0) > 0}>
						<button
							type="button"
							class="flex shrink-0 items-center gap-1.5 rounded-xl bg-brand/10 px-2.5 py-2 text-[13px] font-semibold text-brand transition hover:bg-brand/20 active:scale-[0.98]"
							onClick={props.onRestoreStash}
							aria-label="恢复词汇"
							title={`恢复词汇（暂存了 ${props.stashCount} 个词，点击换回当前词表）`}
						>
							<Undo2 class="h-4 w-4" />
						</button>
					</Show>
				</div>
			</Show>

			{/* 唯一的弹性区：录入模式是单词表，词表模式是今日队列 */}
			<Show
				when={isEntry()}
				fallback={
					<TodayQueueCard
						queue={props.vocab.queue()}
						progress={props.vocab.queue()?.progress ?? null}
						hasBank={Boolean(props.vocab.activeBankId())}
						busy={props.vocab.busy()}
						onRefresh={() => void props.vocab.refreshQueue()}
						onOpenPicker={() => setPickerOpen(true)}
						onNewBank={() => setNewBankOpen(true)}
					/>
				}
			>
				<div class="flex min-h-0 flex-1 flex-col gap-3 rounded-2xl bg-surface p-4 shadow-sm">
					<div class="flex items-center justify-between">
						<span class="text-[13px] text-ink-soft">
							单词表 · {props.words.length} 个
						</span>
						<Show when={props.words.length > 0}>
							<button
								type="button"
								class="flex items-center gap-1 rounded-full px-2 py-1 text-[12px] text-ink-faint transition hover:bg-err-bg hover:text-err"
								onClick={props.onClear}
							>
								<Trash2 class="h-4 w-4" />
								清空
							</button>
						</Show>
					</div>
					<div class="min-h-0 flex-1 overflow-y-auto">
						<Show
							when={props.words.length > 0}
							fallback={
								<div class="flex h-full items-center justify-center">
									<p class="text-center text-[13px] text-ink-faint">
										还没有单词，从上面输入开始吧 ✏️
									</p>
								</div>
							}
						>
							<div class="flex flex-wrap gap-2">
								<For each={props.words}>
									{(w) => (
										<button
											type="button"
											class="group flex items-center gap-1.5 rounded-full bg-[#EDF3F2] px-3.5 py-2 text-sm text-ink transition hover:bg-err-bg"
											onClick={() => props.onRemove(w)}
											title="点击删除"
										>
											{w}
											<X class="h-3 w-3 text-ink-faint group-hover:text-err" />
										</button>
									)}
								</For>
							</div>
						</Show>
					</div>
				</div>
			</Show>

			{/* 控制：速度 + 默写内容选择条 */}
			<div class="flex gap-3">
				<div class="flex shrink-0 gap-1 rounded-full bg-surface p-1 shadow-sm">
					<For each={SPEED_LEVELS}>
						{(l) => (
							<button
								type="button"
								class={`rounded-full px-4 py-2 text-[13px] transition ${
									props.speed === l.key
										? "bg-brand text-white"
										: "text-ink-faint hover:text-ink"
								}`}
								onClick={() => props.onSpeed(l.key)}
							>
								{l.label}
							</button>
						)}
					</For>
				</div>
				<SegmentedSlider
					class="w-[366px]"
					options={CONTENT_MODES}
					value={props.contentMode}
					onChange={props.onContentMode}
					ariaLabel="默写内容模式"
				/>
				{/* 按模式变化的操作区（当前只有短句模式有操作） */}
				<ModeActions
					contentMode={props.contentMode}
					queueWords={queueWords()}
				/>
			</div>

			<Show
				when={bannerError()}
				fallback={
					<Show when={clozeOnly()}>
						<div class="flex items-center gap-2 rounded-xl bg-brand/10 px-4 py-3 text-sm text-brand">
							组句模式请用赛博默写：选词作答需要在屏幕上完成
						</div>
					</Show>
				}
			>
				<div class="flex items-center gap-2 rounded-xl bg-err-bg px-4 py-3 text-sm text-err">
					{bannerError()}
				</div>
			</Show>

			{/* 操作 */}
			<div class="flex gap-3.5">
				<button
					type="button"
					class={`flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand px-6 py-3.5 text-base text-white shadow-sm transition ${
						clozeOnly()
							? "cursor-not-allowed opacity-45"
							: "hover:brightness-105 active:scale-[0.99]"
					}`}
					disabled={clozeOnly()}
					title={clozeOnly() ? "组句模式请用赛博默写" : undefined}
					onClick={props.onStartWriting}
				>
					<PenLine class="h-[18px] w-[18px]" />
					开始书写默写
				</button>
				<button
					type="button"
					class="flex flex-1 items-center justify-center gap-2 rounded-xl border-[1.5px] border-soft bg-surface px-6 py-3.5 text-base text-ink shadow-sm transition hover:border-brand/40 active:scale-[0.99]"
					onClick={props.onStartCyber}
				>
					<Keyboard class="h-[18px] w-[18px] text-ink-soft" />
					开始赛博默写
				</button>
			</div>

			<Show when={batchOpen()}>
				<BatchImportDialog
					existingWords={props.words}
					onImport={props.onAddMany}
					onClose={() => setBatchOpen(false)}
				/>
			</Show>

			<Show when={pickerOpen()}>
				<BankPickerDialog
					banks={props.vocab.banks()}
					catalog={props.vocab.catalog()}
					activeBankId={props.vocab.activeBankId()}
					busy={props.vocab.busy()}
					onSelect={(bankId) => {
						props.vocab.selectBank(bankId);
						setPickerOpen(false);
					}}
					onDownload={(row) => {
						void props.vocab.download(row).then(() => setPickerOpen(false));
					}}
					onEdit={(bankId) => {
						setPickerOpen(false);
						setDetailBankId(bankId);
					}}
					onDelete={(bankId) => void props.vocab.deleteBank(bankId)}
					onNewBank={() => {
						setPickerOpen(false);
						setNewBankOpen(true);
					}}
					onCheckUpdate={() => {
						setPickerOpen(false);
						setManifestOpen(true);
					}}
					onClose={() => setPickerOpen(false)}
				/>
			</Show>

			<Show when={manifestOpen()}>
				<ManifestUpdateDialog
					manifestUrl={props.vocab.manifestUrl()}
					busy={props.vocab.busy()}
					onSaveUrl={props.vocab.setManifestUrl}
					onCheck={props.vocab.checkManifest}
					onDownload={(row) => props.vocab.download(row)}
					onClose={() => setManifestOpen(false)}
				/>
			</Show>

			<Show when={newBankOpen()}>
				<NewBankDialog
					existingWords={props.words}
					busy={props.vocab.busy()}
					onSubmit={(name, words) => {
						void props.vocab.createNew(name, words).then(() => {
							setNewBankOpen(false);
						});
					}}
					onClose={() => setNewBankOpen(false)}
				/>
			</Show>

			{/* 学习档案：整屏覆盖；详情打开时先隐藏档案，返回后重新加载 */}
			<Show when={!detailBankId() ? archiveBankId() : null}>
				{(bankId) => (
					<div class="absolute inset-0 z-30 bg-canvas">
						<BankArchiveScreen
							bankId={bankId()}
							api={props.vocab}
							onBack={() => {
								setArchiveBankId(null);
								requestAnimationFrame(() => archiveTrigger?.focus());
							}}
							onOpenDetail={(id) => setDetailBankId(id)}
							onStartSession={() => {
								setArchiveBankId(null);
								props.onStartCyber();
							}}
							onPracticeWeak={(words) => {
								const id = archiveBankId();
								if (!id) return;
								setArchiveBankId(null);
								props.onStartDrill(id, words);
							}}
						/>
					</div>
				)}
			</Show>

			{/* 词表详情：整屏覆盖（与历史界面同层级） */}
			<Show when={detailBankId()}>
				{(bankId) => (
					<div class="absolute inset-0 z-30 bg-canvas">
						<BankDetailScreen
							bankId={bankId()}
							api={props.vocab}
							entryWords={props.words}
							onBack={() => {
								setDetailBankId(null);
								const archiveId = archiveBankId();
								if (archiveId) {
									// 详情里删除了词表：档案没有可展示的对象，直接回主界面
									const stillExists = props.vocab
										.banks()
										.some((bank) => bank.id === archiveId);
									if (!stillExists) {
										setArchiveBankId(null);
										requestAnimationFrame(() => archiveTrigger?.focus());
									}
								} else {
									requestAnimationFrame(() => archiveTrigger?.focus());
								}
							}}
						/>
					</div>
				)}
			</Show>
		</div>
	);
}
