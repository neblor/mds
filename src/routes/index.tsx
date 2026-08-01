import { Show } from "solid-js";
import WordBank from "~/components/WordBank";
import PreparingOverlay from "~/components/PreparingOverlay";
import ReadyOverlay from "~/components/ReadyOverlay";
import DictatingView from "~/components/DictatingView";
import ResultsView from "~/components/ResultsView";
import SettingsPanel from "~/components/SettingsPanel";
import { useDictation } from "~/lib/use-dictation";

export default function Home() {
	const d = useDictation();

	return (
		<div class="flex h-screen w-full justify-center bg-[#E6E9EC]">
			{/* 最大外框：浏览器全屏时居中收窄；client 模式后续可同步限制窗口 */}
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
							words={d.words()}
							speed={d.speed()}
							withDefinition={d.withDefinition()}
							error={d.error()}
							onAdd={d.addWord}
							onRemove={d.removeWord}
							onClear={d.clearWords}
							onSpeed={d.setSpeed}
							onWithDefinition={d.changeWithDefinition}
							onStartWriting={() => d.startDictation("writing")}
							onStartCyber={() => d.startDictation("cyber")}
							onOpenSettings={() => d.setSettingsOpen(true)}
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
						withDefinition={d.withDefinition()}
						onGo={d.go}
					/>
				</Show>

				<Show when={d.phase() === "dictating"}>
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
						withDefinition={d.withDefinition()}
						submittedWord={d.currentRound()?.answer}
						submittedDef={d.currentRound()?.answerDef}
						wordInput={d.wordInput()}
						defInput={d.defInput()}
						onWordInput={d.setWordInput}
						onDefInput={d.setDefInput}
						onWordSubmit={d.submitWord}
						onDefSubmit={d.submitDef}
					/>
				</Show>

				<Show when={d.phase() === "results"}>
					<ResultsView
						rows={d.resultRows()}
						mode={d.mode()}
						withDefinition={d.withDefinition()}
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
			</div>
		</div>
	);
}
