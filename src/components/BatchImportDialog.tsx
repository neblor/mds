import { createMemo, createSignal } from "solid-js";
import { ListPlus, X } from "lucide-solid";
import { newBatchWords } from "~/lib/batch-import";
import { isSettingsBackdropClick } from "~/lib/settings-panel";

interface Props {
	existingWords: string[];
	onImport: (words: string[]) => void;
	onClose: () => void;
}

function autoFocus(element: HTMLTextAreaElement | undefined) {
	if (element) requestAnimationFrame(() => element.focus());
}

export default function BatchImportDialog(props: Props) {
	const [text, setText] = createSignal("");
	const pendingWords = createMemo(() => newBatchWords(text(), props.existingWords));
	const importWords = () => {
		const words = pendingWords();
		if (words.length === 0) return;
		props.onImport(words);
		props.onClose();
	};

	return (
		<div
			class="absolute inset-0 z-30 flex items-center justify-center bg-ink/30 backdrop-blur-sm"
			role="dialog"
			aria-modal="true"
			aria-labelledby="batch-import-title"
			onClick={(event) => {
				if (isSettingsBackdropClick(event)) props.onClose();
			}}
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					event.preventDefault();
					props.onClose();
				} else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
					event.preventDefault();
					importWords();
				}
			}}
		>
			<div class="flex w-[540px] flex-col gap-[18px] rounded-2xl bg-surface p-7 shadow-xl">
				<div class="flex items-center justify-between">
					<h2 id="batch-import-title" class="font-heading text-2xl text-ink">
						批量导入词汇
					</h2>
					<button
						type="button"
						class="rounded-full p-2 text-ink-faint transition hover:bg-soft hover:text-ink"
						onClick={props.onClose}
						aria-label="关闭批量导入"
					>
						<X class="h-[22px] w-[22px]" />
					</button>
				</div>

				<p class="text-[13px] leading-relaxed text-ink-soft">
					使用空格、Tab、回车、英文逗号或分号分隔；重复内容会自动忽略。
				</p>
				<textarea
					ref={autoFocus}
					aria-label="待导入词汇"
					class="h-[168px] resize-none rounded-xl border-[1.5px] border-soft bg-canvas p-[15px] text-[15px] leading-relaxed text-ink outline-none placeholder:text-ink-faint focus:border-brand"
					placeholder={"apple banana\norange, pear\ngrape; lemon"}
					value={text()}
					onInput={(event) => setText(event.currentTarget.value)}
				/>

				<div class="flex items-center justify-between gap-4">
					<p class="text-xs text-ink-faint">
						已识别 {pendingWords().length} 条新词汇
					</p>
					<div class="flex items-center gap-2.5">
						<button
							type="button"
							class="rounded-xl border-[1.5px] border-soft px-[18px] py-2.5 text-sm text-ink-soft transition hover:border-brand/40 hover:text-ink"
							onClick={props.onClose}
						>
							取消
						</button>
						<button
							type="button"
							class="flex items-center gap-1.5 rounded-xl bg-brand px-[18px] py-2.5 text-sm font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45"
							disabled={pendingWords().length === 0}
							onClick={importWords}
							title="也可按 Ctrl+Enter 导入"
						>
							<ListPlus class="h-4 w-4" />
							导入词汇
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
