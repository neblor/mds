/**
 * 答案 AI 批改业务编排：一次请求批改本场全部作答（中文词 / 英文释义按 kind 选择口径）。
 * 只做第三方请求与结果对齐，不做磁盘缓存（批改是一次性结果）；
 * 响应不可解析时降级为空结果 + 警告，由调用方决定回退策略。
 */
import {
	DefinitionProviderError,
	fetchAnswerGrades,
	type GradeItem,
	type GradeKind,
	type GradeResult,
	type DefinitionProviderDiagnostics,
	type DefinitionProviderDiagnosticEvent,
} from "./definition-provider";
import type { RuntimeDiagnosticLogger } from "./runtime-logger";

export interface GradeAnswersOptions {
	kind: GradeKind;
	items: GradeItem[];
	baseUrl: string;
	apiKey: string;
	model: string;
	logger?: RuntimeDiagnosticLogger;
	signal?: AbortSignal;
	fetchImpl?: typeof fetch;
}

export interface GradeAnswersResult {
	grades: GradeResult[];
	missing?: string[];
	warning?: string;
	diagnostics?: DefinitionProviderDiagnostics;
}

export async function gradeAnswers(
	options: GradeAnswersOptions,
): Promise<GradeAnswersResult> {
	try {
		const result = await fetchAnswerGrades({
			kind: options.kind,
			items: options.items,
			baseUrl: options.baseUrl,
			apiKey: options.apiKey,
			model: options.model,
			signal: options.signal,
			fetchImpl: options.fetchImpl,
			onDiagnostic: (entry: DefinitionProviderDiagnosticEvent) =>
				options.logger?.write(entry),
		});
		return {
			grades: result.grades,
			...(result.missing.length > 0 ? { missing: result.missing } : {}),
			...(result.warning ? { warning: result.warning } : {}),
			diagnostics: result.diagnostics,
		};
	} catch (error) {
		if (
			error instanceof DefinitionProviderError &&
			(error.code === "invalid-response" || error.code === "empty")
		) {
			// 响应不可解析：不给错误结果，调用方回退本地匹配
			return {
				grades: [],
				missing: options.items.map((i) => i.word),
				warning: error.message,
			};
		}
		throw error;
	}
}
