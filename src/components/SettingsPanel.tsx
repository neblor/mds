import { For } from "solid-js";
import { X, Minus, Plus } from "lucide-solid";
import type { AppSettings } from "~/lib/settings";
import { clampMultiplier, VOICES } from "~/lib/settings";
import { isSettingsBackdropClick } from "~/lib/settings-panel";

interface Props {
	settings: AppSettings;
	onChange: (s: AppSettings) => void;
	onClose: () => void;
}

export default function SettingsPanel(props: Props) {
	const set = (patch: Partial<AppSettings>) =>
		props.onChange({ ...props.settings, ...patch });

	return (
		<div
			class="absolute inset-0 z-30 flex items-center justify-center bg-ink/30 backdrop-blur-sm"
			onClick={(event) => {
				if (isSettingsBackdropClick(event)) props.onClose();
			}}
		>
			<div class="flex max-h-[90%] w-[540px] flex-col gap-4 rounded-2xl bg-surface p-7 shadow-xl">
				<div class="flex items-center justify-between">
					<h2 class="font-heading text-2xl text-ink">设置</h2>
					<button type="button"
						class="rounded-full p-2 text-ink-faint transition hover:bg-soft hover:text-ink"
						onClick={props.onClose}
						aria-label="关闭"
					>
						<X class="h-[22px] w-[22px]" />
					</button>
				</div>

				<div class="flex flex-col gap-4 overflow-y-auto pr-1">
					{/* AI 配置 */}
					<div class="flex flex-col gap-3 rounded-2xl bg-canvas p-5">
						<p class="text-[15px] font-semibold text-ink">
							AI 释义服务（OpenAI 兼容）
						</p>
						<label class="flex flex-col gap-1.5">
							<span class="text-[13px] text-ink-soft">服务地址</span>
							<input
								class="rounded-lg border border-soft bg-surface px-3.5 py-3 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-brand"
								placeholder="https://api.example.com/v1"
								value={props.settings.aiBaseUrl}
								onInput={(e) => set({ aiBaseUrl: e.currentTarget.value })}
							/>
						</label>
						<label class="flex flex-col gap-1.5">
							<span class="text-[13px] text-ink-soft">API Key</span>
							<input
								class="rounded-lg border border-soft bg-surface px-3.5 py-3 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-brand"
								placeholder="sk-…"
								type="password"
								value={props.settings.aiApiKey}
								onInput={(e) => set({ aiApiKey: e.currentTarget.value })}
							/>
						</label>
						<label class="flex flex-col gap-1.5">
							<span class="text-[13px] text-ink-soft">模型名</span>
							<input
								class="rounded-lg border border-soft bg-surface px-3.5 py-3 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-brand"
								placeholder="gpt-4o-mini"
								value={props.settings.aiModel}
								onInput={(e) => set({ aiModel: e.currentTarget.value })}
							/>
						</label>
						<p class="text-xs text-ink-faint">
						不配置则无法使用"默写释义"和"中文词"功能
					</p>
					</div>

					{/* 音色选择 */}
					<div class="flex flex-col gap-3 rounded-2xl bg-canvas p-5">
						<p class="text-[15px] font-semibold text-ink">
							语音音色（发音角色）
						</p>
						<select
							class="w-full rounded-lg border border-soft bg-surface px-3.5 py-3 text-sm text-ink outline-none focus:border-brand"
							value={props.settings.voice}
							onChange={(e) => set({ voice: e.currentTarget.value })}
						>
							<For each={VOICES}>
								{(v) => <option value={v.id}>{v.label}</option>}
							</For>
						</select>
						<p class="text-xs text-ink-faint">不同音色缓存互不冲突</p>
					</div>

					{/* 倍率调整 */}
					<div class="flex items-center justify-between rounded-2xl bg-canvas p-5">
						<div class="flex flex-col gap-1">
							<p class="text-[15px] font-semibold text-ink">默写速度倍率调整</p>
							<p class="text-xs text-ink-faint">
								在计算出的每轮时长上再乘以此系数
							</p>
						</div>
						<div class="flex items-center gap-3 rounded-full bg-surface px-3 py-1.5 shadow-sm">
							<button type="button"
								class="h-7 w-7 rounded-full text-ink-soft transition hover:bg-soft hover:text-ink"
								onClick={() =>
									set({
										multiplier: clampMultiplier(
											props.settings.multiplier - 0.1,
										),
									})
								}
								aria-label="减小"
							>
								<Minus class="h-4 w-4" />
							</button>
							<span class="w-10 text-center font-data text-lg text-ink tabular-nums">
								{props.settings.multiplier.toFixed(1)}
							</span>
							<button type="button"
								class="h-7 w-7 rounded-full text-ink-soft transition hover:bg-soft hover:text-ink"
								onClick={() =>
									set({
										multiplier: clampMultiplier(
											props.settings.multiplier + 0.1,
										),
									})
								}
								aria-label="增大"
							>
								<Plus class="h-4 w-4" />
							</button>
						</div>
					</div>

					{/* 倒计时数字 */}
					<div class="flex items-center justify-between rounded-2xl bg-canvas p-5">
						<div class="flex flex-col gap-1">
							<p class="text-[15px] font-semibold text-ink">
								每轮倒计时显示数字
							</p>
							<p class="text-xs text-ink-faint">
								精确到 0.1 秒，关闭后只显示进度条
							</p>
						</div>
						<input
							type="checkbox"
							class="toggle-switch"
							checked={props.settings.showCountdownNumber}
							onChange={(e) =>
								set({ showCountdownNumber: e.currentTarget.checked })
							}
						/>
					</div>
				</div>
			</div>
		</div>
	);
}
