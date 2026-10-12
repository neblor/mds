/**
 * 新建词表弹层（对应设计稿 21）
 *
 * 名称输入自动聚焦；可勾选把录入模式当前的词一起放进来（自动去重）。
 * 键盘：Enter 创建、Esc 关闭；勾选框可用空格切换。
 */
import { Show, createSignal, onMount } from "solid-js";
import { Check, X } from "lucide-solid";
import { isSettingsBackdropClick } from "~/lib/settings-panel";

interface Props {
	existingWords: string[];
	busy: boolean;
	onSubmit: (name: string, words: string[]) => void;
	onClose: () => void;
}

export default function NewBankDialog(props: Props) {
	const [name, setName] = createSignal("");
	const [includeWords, setIncludeWords] = createSignal(true);
	let input: HTMLInputElement | undefined;
	onMount(() => requestAnimationFrame(() => input?.focus()));

	const submit = () => {
		const value = name().trim();
		if (!value || props.busy) return;
		props.onSubmit(value, includeWords() ? props.existingWords : []);
	};

	return (
		<div
			class="absolute inset-0 z-30 flex items-center justify-center bg-ink/30 backdrop-blur-sm"
			role="dialog"
			aria-modal="true"
			aria-label="新建词表"
			onClick={(event) => {
				if (isSettingsBackdropClick(event)) props.onClose();
			}}
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					event.preventDefault();
					props.onClose();
				}
			}}
		>
			<div class="flex w-[480px] flex-col gap-4 rounded-2xl bg-surface p-7 shadow-xl">
				<div class="flex items-center justify-between">
					<h2 class="font-heading text-2xl text-ink">新建词表</h2>
					<button
						type="button"
						class="rounded-full p-2 text-ink-faint transition hover:bg-soft hover:text-ink"
						onClick={props.onClose}
						aria-label="关闭新建词表"
					>
						<X class="h-[22px] w-[22px]" />
					</button>
				</div>

				<label class="flex flex-col gap-1.5">
					<span class="text-[13px] text-ink-soft">名称</span>
					<input
						ref={input}
						class="rounded-lg border border-soft bg-canvas px-3.5 py-3 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-brand"
						placeholder="例如：我的生词"
						value={name()}
						onInput={(event) => setName(event.currentTarget.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								submit();
							}
						}}
					/>
				</label>

				<label class="flex items-center gap-2.5">
					<input
						type="checkbox"
						class="h-[18px] w-[18px] shrink-0 accent-[#4EA3A0]"
						checked={includeWords()}
						disabled={props.existingWords.length === 0}
						onChange={(event) => setIncludeWords(event.currentTarget.checked)}
					/>
					<span class="text-[13px] text-ink-soft">
						把录入模式当前的 {props.existingWords.length} 个词一起放进来
					</span>
				</label>

				<p class="text-xs leading-relaxed text-ink-faint">
					自建词表可随时增删词；资源词表只读，如需修改可先复制为自建词表。
				</p>

				<div class="flex items-center justify-end gap-2.5">
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
						disabled={!name().trim() || props.busy}
						onClick={submit}
					>
						<Show when={props.busy} fallback={<Check class="h-4 w-4" />}>
							<span class="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
						</Show>
						创建
					</button>
				</div>
			</div>
		</div>
	);
}
