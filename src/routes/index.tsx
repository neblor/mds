import { Show, createEffect, createSignal } from "solid-js";
import WordBank from "~/components/WordBank";
import PreparingOverlay from "~/components/PreparingOverlay";
import ReadyOverlay from "~/components/ReadyOverlay";
import DictatingView from "~/components/DictatingView";
import ClozeView from "~/components/ClozeView";
import GradingOverlay from "~/components/GradingOverlay";
import ResultsView from "~/components/ResultsView";
import SettingsPanel from "~/components/SettingsPanel";
import HistoryScreen from "~/components/HistoryScreen";
import { useDictation } from "~/lib/use-dictation";
import { useWordBanks } from "~/lib/use-wordbanks";
import { planRetry } from "~/lib/history-screen";

export default function Home() {
	const d = useDictation();
	const vocab = useWordBanks({
		requestRetention: () => d.settings().requestRetention,
		manifestUrl: () => d.settings().bankManifestUrl,
		onManifestUrl: (url) =>
			d.changeSettings({ ...d.settings(), bankManifestUrl: url }),
	});
	// 历史界面独立于默写流程状态机，只在词库阶段（WordBank 渲染期间）可打开
	const [historyOpen, setHistoryOpen] = createSignal(false);
	// 再次默写覆盖前的词表暂存（仅内存，刷新即失效；恢复一次性）
	const [stashedWords, setStashedWords] = createSignal<string[] | null>(null);

	/**
	 * 开始默写：词表模式用「今日队列」覆盖本次词表（录入模式仍用手敲的那张表）。
	 * 队列为空时给出可执行的提示，而不是让用户点了没反应。
	 */
	const startDictation = (mode: "writing" | "cyber") => {
		if (vocab.mode() === "bank") {
			const bankId = vocab.activeBankId();
			const queue = vocab.queue();
			const words = queue?.queue.words ?? [];
			if (!bankId) {
				vocab.setError("先选一个词表再开始默写");
				return;
			}
			if (words.length === 0) {
				vocab.setError(
					"今天的队列是空的：换个词表，或把「今天默几个」调大一点",
				);
				return;
			}
			vocab.setError(null);
			vocab.beginSession(bankId);
			// 组句的候选词带英文释义（出题质量更好），其余模式用不到
			d.startDictation(mode, words, queue?.definitions ?? {});
			return;
		}
		d.startDictation(mode);
	};

	/**
	 * 当前轮次按类型收窄（组句轮与单词轮渲染不同组件）
	 */
	const wordRound = () => {
		const round = d.currentRound();
		return round && round.kind === "word" ? round : undefined;
	};
	const clozeRound = () => {
		const round = d.currentRound();
		return round && round.kind === "cloze" ? round : undefined;
	};

	// 结算时把这一场的判定写回复习计划（书写模式没有判定字段 → 底层会跳过）
	let committed = false;
	createEffect(() => {
		const phase = d.phase();
		if (phase !== "results") {
			committed = false;
			return;
		}
		if (committed || !vocab.sessionBankId()) return;
		committed = true;
		void vocab.commitSession({
			rows: d.resultRows(),
			mode: d.contentMode(),
			genMode: d.mode(),
			elapsedMs: d.roundElapsed(),
		});
	});

	/** 结果页的复习反馈文案（写回成功后才有） */
	const reviewNote = () => {
		if (d.mode() === "writing") {
			return vocab.sessionBankId()
				? "书写模式不计入复习计划；想纳入请用赛博默写"
				: null;
		}
		const commit = vocab.lastCommit();
		if (!commit || commit.updated.length === 0) return null;
		const later = commit.updated.filter((item) => !item.laterToday).length;
		const soon = commit.updated.length - later;
		const parts: string[] = [];
		if (later > 0) {
			const minDays = Math.min(
				...commit.updated.filter((item) => !item.laterToday).map((item) => item.inDays),
			);
			parts.push(`${later} 个已排期（最近 ${Math.max(1, minDays)} 天后）`);
		}
		if (soon > 0) parts.push(`${soon} 个今天内再练`);
		return parts.length > 0 ? `已更新复习计划 · ${parts.join(" · ")}` : null;
	};

	/** 历史里点「再次默写」：先暂存当前词表，再覆盖并回主界面 */
	const retryWithHistory = (historyWords: string[]) => {
		const plan = planRetry({ currentWords: d.words(), historyWords });
		setStashedWords(plan.stashed);
		d.replaceWords(plan.nextWords);
		setHistoryOpen(false);
	};
	/** 输入行的「恢复词汇」：取回暂存词表（一次性） */
	const restoreStash = () => {
		const restored = stashedWords();
		setStashedWords(null);
		if (restored) d.replaceWords(restored);
	};

	return (
		<div class="flex h-screen w-full justify-center bg-[#E6E9EC]">
			{/* 最大外框：浏览器全屏时居中收窄；client 模式窗口即此尺寸 */}
			<div class="relative h-full w-full max-w-[1120px] overflow-hidden bg-canvas shadow-2xl">
				<Show
					when={
						d.phase() === "idle" ||
						d.phase() === "preparing" ||
						d.phase() === "ready"
					}
				>
					<div class="h-full w-full">
						<WordBank
							vocab={vocab}
							words={d.words()}
							speed={d.speed()}
							contentMode={d.contentMode()}
							error={d.error()}
							onAdd={d.addWord}
							onAddMany={d.addWords}
							onRemove={d.removeWord}
							onClear={d.clearWords}
							onSpeed={d.setSpeed}
							onContentMode={d.changeContentMode}
							onStartWriting={() => startDictation("writing")}
							onStartCyber={() => startDictation("cyber")}
							onOpenSettings={() => d.setSettingsOpen(true)}
							onOpenHistory={() => setHistoryOpen(true)}
							stashCount={stashedWords()?.length ?? 0}
							onRestoreStash={restoreStash}
						/>
					</div>
				</Show>

				<Show when={d.phase() === "preparing"}>
					<PreparingOverlay
						progress={d.prepProgress()}
						status={d.prepStatus()}
						error={d.prepError()}
						onAbort={d.abortPreparation}
					/>
				</Show>

				<Show when={d.phase() === "ready"}>
					<ReadyOverlay
						count={d.rounds().length}
						contentMode={d.contentMode()}
						onGo={d.go}
					/>
				</Show>

				<Show when={d.phase() === "dictating"}>
					<Show
						when={clozeRound()}
						fallback={
							<DictatingView
								index={d.currentIndex()}
								total={d.rounds().length}
								remainingSec={d.remaining()}
								durationSec={d.currentRound()?.countdownSec ?? 1}
								showNumber={d.settings().showCountdownNumber}
								repeatIndex={d.repeatIndex()}
								repeatCount={d.currentRound()?.repeatCount ?? 1}
								speechDone={d.speechDone()}
								sounding={d.sounding()}
								mode={d.mode()}
								contentMode={d.contentMode()}
								submittedWord={wordRound()?.answer}
								submittedDef={wordRound()?.answerDef}
								wordInput={d.wordInput()}
								defInput={d.defInput()}
								onWordInput={d.setWordInput}
								onDefInput={d.setDefInput}
								onWordSubmit={d.submitWord}
								onDefSubmit={d.submitDef}
							/>
						}
					>
						{(round) => (
							<ClozeView
								index={d.currentIndex()}
								total={d.rounds().length}
								remainingSec={d.remaining()}
								durationSec={round().countdownSec}
								showNumber={d.settings().showCountdownNumber}
								sentences={round().sentences}
								blanks={round().blanks}
								candidates={d.clozeCandidates()}
								onChoose={d.chooseClozeWord}
								onClear={d.clearClozeWord}
							/>
						)}
					</Show>
				</Show>

				<Show when={d.phase() === "grading"}>
					<GradingOverlay onAbort={d.abortGrading} />
				</Show>

				<Show when={d.phase() === "results"}>
					<ResultsView
						rows={d.resultRows()}
						mode={d.mode()}
						contentMode={d.contentMode()}
						gradeNote={d.gradeNote()}
						note={d.resultNote()}
						reviewNote={reviewNote()}
						playingAudioName={d.resultAudioName()}
						onPlayAudio={d.playResultAudio}
						onClose={d.closeResults}
					/>
				</Show>

				<Show when={d.settingsOpen()}>
					<SettingsPanel
						settings={d.settings()}
						onChange={d.changeSettings}
						onClose={d.closeSettings}
					/>
				</Show>

				<Show when={historyOpen()}>
					<HistoryScreen
						onClose={() => setHistoryOpen(false)}
						onRetry={retryWithHistory}
					/>
				</Show>
			</div>
		</div>
	);
}
