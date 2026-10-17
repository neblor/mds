/**
 * 选择词表弹层（对应设计稿 20）
 *
 * 两组：
 * - 资源词表：随包发布的考纲词库（已下载的显示「使用中/使用」，未下载的显示「下载」）
 * - 自建词表：可编辑、可删除
 * 键盘：打开即聚焦首个可交互项（键盘流铁律），Esc 关闭，点击遮罩关闭。
 */
import { For, Show, onMount, type JSX } from "solid-js";
import { BookOpen, Download, Folder, Pencil, Trash2, X, Check, RefreshCw } from "lucide-solid";
import type { BankSummary } from "~/lib/bank-types";
import type { CatalogRow } from "~/lib/bank-catalog";
import { isSettingsBackdropClick } from "~/lib/settings-panel";

interface Props {
	banks: BankSummary[];
	/** 资源词表清单（内置 + 自定义远端），带下载/更新/已是最新状态 */
	catalog: CatalogRow[];
	activeBankId: string | null;
	busy: boolean;
	onSelect: (bankId: string) => void;
	onDownload: (row: CatalogRow) => void;
	onEdit: (bankId: string) => void;
	onDelete: (bankId: string) => void;
	onNewBank: () => void;
	/** 打开「检查清单更新」（自定义清单地址 + 增量检查） */
	onCheckUpdate: () => void;
	onClose: () => void;
}

function CountLabel(props: { count: number }) {
	return (
		<span class="text-[12px] text-ink-faint">{props.count.toLocaleString()} 词</span>
	);
}

export default function BankPickerDialog(props: Props) {
	let firstButton: HTMLButtonElement | undefined;
	onMount(() => requestAnimationFrame(() => firstButton?.focus()));

	const resourceBanks = () =>
		props.banks.filter((bank) => bank.source !== "custom");
	const customBanks = () => props.banks.filter((bank) => bank.source === "custom");
	/** 清单里没有列出的本地资源词表（例如换过清单/手动导入过）也要能选到 */
	const localOnlyResourceBanks = () =>
		resourceBanks().filter(
			(bank) => !props.catalog.some((row) => row.entry.id === bank.id),
		);
	const manifestHint = () =>
		props.catalog.some((row) => row.source === "remote")
			? "资源词表 · 内置 + 自定义清单，只读"
			: "资源词表 · 随包提供，只读";

	return (
		<div
			class="absolute inset-0 z-30 flex items-center justify-center bg-ink/30 backdrop-blur-sm"
			role="dialog"
			aria-modal="true"
			aria-label="选择词表"
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
			<div class="flex max-h-[88%] w-[640px] flex-col gap-3.5 rounded-2xl bg-surface p-7 shadow-xl">
				<div class="flex items-center justify-between">
					<h2 class="font-heading text-2xl text-ink">选择词表</h2>
					<button
						type="button"
						class="rounded-full p-2 text-ink-faint transition hover:bg-soft hover:text-ink"
						onClick={props.onClose}
						aria-label="关闭选择词表"
					>
						<X class="h-[22px] w-[22px]" />
					</button>
				</div>

				<div class="min-h-0 flex-1 overflow-y-auto pr-1">
					<p class="pb-2 text-[13px] text-ink-soft">{manifestHint()}</p>
					<div class="flex flex-col gap-2">
						<For each={props.catalog}>
							{(row) => (
								<Row
									icon={<BookOpen class="h-[18px] w-[18px] text-brand" />}
									name={row.entry.name}
									extra={<CountLabel count={row.entry.count} />}
									active={props.activeBankId === row.entry.id}
									busy={props.busy}
									action={
										row.state === "latest" ? (
											<span class="flex items-center gap-1 text-[12px] font-semibold text-ok">
												<Check class="h-3.5 w-3.5" />
												已是最新
											</span>
										) : (
											<span class="flex items-center gap-1.5 rounded-[10px] bg-surface px-3 py-1.5 text-[12px] font-semibold text-brand">
												<Download class="h-3.5 w-3.5" />
												{row.state === "update" ? "更新" : "下载"}
												<Show when={row.state === "update"}>
													<span class="font-data text-[11px] text-ink-faint">
														v{row.localVersion}→v{row.entry.version}
													</span>
												</Show>
											</span>
										)
									}
									onSelect={() =>
										row.state === "latest"
											? props.onSelect(row.entry.id)
											: props.onDownload(row)
									}
									buttonRef={(el) => {
										firstButton ??= el;
									}}
								/>
							)}
						</For>
						<For each={localOnlyResourceBanks()}>
							{(bank) => (
								<Row
									icon={<BookOpen class="h-[18px] w-[18px] text-brand" />}
									name={bank.name}
									extra={<CountLabel count={bank.count} />}
									active={props.activeBankId === bank.id}
									onSelect={() => props.onSelect(bank.id)}
									buttonRef={(el) => {
										firstButton ??= el;
									}}
								/>
							)}
						</For>
						<Show
							when={
								props.catalog.length + localOnlyResourceBanks().length > 0
							}
							fallback={
								<p class="rounded-xl bg-canvas px-4 py-3 text-[13px] text-ink-faint">
									没有可用的资源词表（内置清单缺失时会出现这种情况）。
								</p>
							}
						>
							<span />
						</Show>
					</div>

					<p class="pb-2 pt-4 text-[13px] text-ink-soft">自建词表 · 可编辑</p>
					<div class="flex flex-col gap-2">
						<For each={customBanks()}>
							{(bank) => (
								<Row
									icon={<Folder class="h-[18px] w-[18px] text-ink-soft" />}
									name={bank.name}
									extra={<CountLabel count={bank.count} />}
									active={props.activeBankId === bank.id}
									onSelect={() => props.onSelect(bank.id)}
									onEdit={() => props.onEdit(bank.id)}
									onDelete={() => props.onDelete(bank.id)}
									buttonRef={(el) => {
										firstButton ??= el;
									}}
								/>
							)}
						</For>
						<Show when={customBanks().length === 0}>
							<p class="rounded-xl bg-canvas px-4 py-3 text-[13px] text-ink-faint">
								还没有自建词表：点下面的「新建词表」建一个，把录入的词或历史记录导进去。
							</p>
						</Show>
					</div>
				</div>

				<div class="flex items-center justify-between">
					<button
						type="button"
						class="flex items-center gap-1.5 rounded-[10px] bg-brand px-3.5 py-2 text-[13px] font-semibold text-white transition hover:brightness-105"
						onClick={props.onNewBank}
					>
						＋ 新建词表
					</button>
					<button
						type="button"
						class="flex items-center gap-1.5 rounded-[10px] bg-canvas px-3.5 py-2 text-[13px] font-semibold text-ink-soft transition hover:text-ink"
						onClick={props.onCheckUpdate}
					>
						<RefreshCw class="h-3.5 w-3.5" />
						检查清单更新
					</button>
				</div>
			</div>
		</div>
	);
}

interface RowProps {
	icon: JSX.Element;
	name: string;
	extra?: JSX.Element;
	action?: JSX.Element;
	active?: boolean;
	busy?: boolean;
	onSelect: () => void;
	onEdit?: () => void;
	onDelete?: () => void;
	buttonRef?: (el: HTMLButtonElement) => void;
}

function Row(props: RowProps) {
	return (
		<div
			// 选中态用 border 而不是 ring：ring 是画在盒子外的 box-shadow，
			// 而本列表在 overflow-y-auto 的滚动容器里（`overflow-y:auto` 会让另一轴
			// 也退化为 auto 而裁剪），行左边贴着容器左边缘、左侧没有 padding，
			// 于是选中框的左半边会被裁掉。border 画在盒子内，任何容器都不会裁。
			// 未选中时保留同宽透明边框，避免选中态切换时行高与文字左右位移。
			class={`flex items-center gap-2.5 rounded-xl border-[1.5px] px-3.5 py-2.5 ${
				props.active
					? "border-brand bg-brand/10"
					: "border-transparent bg-canvas"
			}`}
		>
			<button
				type="button"
				ref={props.buttonRef}
				class="flex min-w-0 flex-1 items-center gap-2.5 text-left"
				onClick={props.onSelect}
				disabled={props.busy}
			>
				{props.icon}
				<span class="min-w-0 truncate text-[15px] font-semibold text-ink">
					{props.name}
				</span>
				{props.extra}
				<span class="flex-1" />
				<Show when={props.active}>
					<Check class="h-4 w-4 text-brand" />
					<span class="text-[12px] font-semibold text-brand">使用中</span>
				</Show>
				{props.action}
			</button>
			<Show when={props.onEdit}>
				<button
					type="button"
					class="flex items-center gap-1 rounded-[10px] bg-surface px-2.5 py-1.5 text-[12px] text-ink-soft transition hover:text-ink"
					onClick={props.onEdit}
					aria-label={`编辑 ${props.name}`}
				>
					<Pencil class="h-3.5 w-3.5" />
					编辑
				</button>
			</Show>
			<Show when={props.onDelete}>
				<button
					type="button"
					class="flex items-center gap-1 rounded-[10px] bg-surface px-2.5 py-1.5 text-[12px] text-err transition hover:brightness-95"
					onClick={props.onDelete}
					aria-label={`删除 ${props.name}`}
				>
					<Trash2 class="h-3.5 w-3.5" />
					删除
				</button>
			</Show>
		</div>
	);
}
