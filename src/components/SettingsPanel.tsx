import { For, Show } from "solid-js";
import { X, Minus, Plus, LoaderCircle, Square, Volume2 } from "~/lib/icons";
import type { AppSettings } from "~/lib/settings";
import {
	clampMultiplier,
	clampRequestRetentionSetting,
	VOICES,
} from "~/lib/settings";
import { CONTENT_LEVEL_OPTIONS, parseContentLevel } from "~/lib/content-level";
import { isSettingsBackdropClick } from "~/lib/settings-panel";
import { createVoicePreviewPlayer } from "~/lib/voice-preview-player";
import { previewButtonLabel, previewHintText } from "~/lib/voice-preview";

interface Props {
	settings: AppSettings;
	onChange: (s: AppSettings) => void;
	onClose: () => void;
}

/**
 * 设置面板
 *
 * 三张卡：AI 服务（含生成级别）/ 语音音色 / 参数卡（倍率调整、倒计时数字、复习期望保持率三行并存）。
 * 参数卡是合并来的：三个设置各占一张卡时面板总高会超过 820 窗口高度（实测 919），
 * 合并并收紧内边距后为 779，刚好装下且不用滚动。
 * 无确认按钮：改动即生效，由外层防抖 1.5s 落盘。
 */
export default function SettingsPanel(props: Props) {
	const set = (patch: Partial<AppSettings>) =>
		props.onChange({ ...props.settings, ...patch });

	/** 音色试听：状态编排在 voice-preview-player，驱动层默认接 /api/tts 与播放引擎 */
	const preview = createVoicePreviewPlayer(() => props.settings.voice);

	return (
		<div
			class="absolute inset-0 z-30 flex items-center justify-center bg-ink/30 backdrop-blur-sm"
			onClick={(event) => {
				if (isSettingsBackdropClick(event)) props.onClose();
			}}
		>
			<div class="flex max-h-[90%] w-[540px] flex-col gap-3.5 rounded-2xl bg-surface p-6 shadow-xl">
				<div class="flex items-center justify-between">
					<h2 class="font-heading text-2xl text-ink">设置</h2>
					<button
						type="button"
						class="rounded-full p-2 text-ink-faint transition hover:bg-soft hover:text-ink"
						onClick={props.onClose}
						aria-label="关闭"
					>
						<X class="h-[22px] w-[22px]" />
					</button>
				</div>

				<div class="flex flex-col gap-3.5 overflow-y-auto pr-1">
					{/* AI 配置 */}
					<div class="flex flex-col gap-2.5 rounded-2xl bg-canvas p-[18px]">
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
							不配置则无法使用「默写释义」和「中文词」功能
						</p>
						<label class="flex flex-col gap-1.5">
							<span class="text-[13px] text-ink-soft">生成级别</span>
							<select
								class="w-full rounded-lg border border-soft bg-surface px-3.5 py-3 text-sm text-ink outline-none focus:border-brand"
								value={props.settings.contentLevel}
								onChange={(e) =>
									set({ contentLevel: parseContentLevel(e.currentTarget.value) })
								}
							>
								<For each={CONTENT_LEVEL_OPTIONS}>
									{(option) => (
										<option value={option.value}>{option.label}</option>
									)}
								</For>
							</select>
						</label>
						<p class="text-xs text-ink-faint">
							约束 AI 出题与释义的词汇、句法难度；默认初中
						</p>
					</div>

					{/* 音色选择 + 试听 */}
					<div class="flex flex-col gap-2.5 rounded-2xl bg-canvas p-[18px]">
						<p class="text-[15px] font-semibold text-ink">
							语音音色（发音角色）
						</p>
						<div class="flex items-stretch gap-2">
							<select
								class="min-w-0 flex-1 rounded-lg border border-soft bg-surface px-3.5 py-3 text-sm text-ink outline-none focus:border-brand"
								value={props.settings.voice}
								onChange={(e) => {
									preview.voiceChanged(e.currentTarget.value);
									set({ voice: e.currentTarget.value });
								}}
							>
								<For each={VOICES}>
									{(v) => <option value={v.id}>{v.label}</option>}
								</For>
							</select>
							<button
								type="button"
								class="flex w-[92px] shrink-0 items-center justify-center gap-1.5 rounded-lg border-[1.5px] text-[13px] font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
								classList={{
									"border-brand bg-surface text-brand hover:bg-brand/10":
										preview.phase() === "idle" || preview.phase() === "error",
									"cursor-default border-soft bg-canvas text-ink-faint":
										preview.phase() === "synthesizing",
									"border-brand bg-brand/10 text-brand":
										preview.phase() === "playing",
								}}
								// 合成中用 aria-disabled 而不是 disabled：原生 disabled 会让按钮失焦，
								// 合成完焦点回不来，键盘用户就停不下播了（键盘铁律）
								aria-disabled={preview.phase() === "synthesizing"}
								onClick={() => preview.toggle()}
								aria-label={previewButtonLabel(preview.phase())}
								title={
									preview.phase() === "synthesizing"
										? "正在合成试听音频"
										: preview.phase() === "playing"
											? "停止试听"
											: "用当前音色随机念一句台词"
								}
							>
								<Show
									when={preview.phase() === "playing"}
									fallback={
										<Show
											when={preview.phase() === "synthesizing"}
											fallback={<Volume2 class="h-4 w-4" />}
										>
											<LoaderCircle class="h-4 w-4 animate-spin" />
										</Show>
									}
								>
									<Square class="h-4 w-4" />
								</Show>
								{previewButtonLabel(preview.phase())}
							</button>
						</div>
						<p
							class="truncate text-xs"
							classList={{
								"text-err": preview.phase() === "error",
								"text-ink-soft": preview.phase() === "playing",
								"text-ink-faint":
									preview.phase() === "idle" ||
									preview.phase() === "synthesizing",
							}}
						>
							{previewHintText(
								preview.phase(),
								preview.sentence(),
								preview.error(),
							)}
						</p>
					</div>

					{/* 参数卡：三个旋钮三行并存（合并是为了不超出窗口高度） */}
					<div class="flex flex-col gap-3.5 rounded-2xl bg-canvas p-[18px]">
						<div class="flex items-center justify-between">
							<div class="flex flex-col gap-1">
								<p class="text-[15px] font-semibold text-ink">
									默写速度倍率调整
								</p>
								<p class="text-xs text-ink-faint">
									在计算出的每轮时长上再乘以此系数
								</p>
							</div>
							<div class="flex items-center gap-3 rounded-full bg-surface px-3 py-1.5 shadow-sm">
								<button
									type="button"
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
								<button
									type="button"
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

						<div class="flex items-center justify-between">
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

						<div class="flex items-center justify-between">
							<div class="flex flex-col gap-1">
								<p class="text-[15px] font-semibold text-ink">
									复习期望保持率
								</p>
								<p class="text-xs text-ink-faint">越高复习越频繁；默认 0.9</p>
							</div>
							<div class="flex items-center gap-3 rounded-full bg-surface px-3 py-1.5 shadow-sm">
								<button
									type="button"
									class="h-7 w-7 rounded-full text-ink-soft transition hover:bg-soft hover:text-ink"
									onClick={() =>
										set({
											requestRetention: clampRequestRetentionSetting(
												props.settings.requestRetention - 0.01,
											),
										})
									}
									aria-label="降低期望保持率"
								>
									<Minus class="h-4 w-4" />
								</button>
								<span class="w-11 text-center font-data text-lg text-ink tabular-nums">
									{props.settings.requestRetention.toFixed(2)}
								</span>
								<button
									type="button"
									class="h-7 w-7 rounded-full text-ink-soft transition hover:bg-soft hover:text-ink"
									onClick={() =>
										set({
											requestRetention: clampRequestRetentionSetting(
												props.settings.requestRetention + 0.01,
											),
										})
									}
									aria-label="提高期望保持率"
								>
									<Plus class="h-4 w-4" />
								</button>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
