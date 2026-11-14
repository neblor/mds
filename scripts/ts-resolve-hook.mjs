/**
 * Node 解析钩子：让本地脚本能直接 import 项目里的 TS 模块。
 *
 * 项目源码按 Vite 风格写相对导入（`./bank-types` 不带扩展名），Node 的 ESM
 * 解析器要求写全扩展名。这里在解析失败时依次补 .ts/.tsx/.js/.mjs 再试，
 * 只影响显式调用 `registerTsResolve()` 的脚本（`scripts/*.mjs`），
 * 不改变运行时（Vite/Nitro）与测试（Vitest）的解析行为。
 *
 * 用同步的 `module.registerHooks()`：旧的异步 `module.register()` 在 Node 26 已标记废弃
 * （DEP0205），每次跑诊断脚本都会往 stderr 打一条弃用警告。
 */
import { registerHooks } from "node:module";

const CANDIDATE_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".cjs"];

function resolve(specifier, context, nextResolve) {
	const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
	const hasExtension = /\.[cm]?[jt]sx?$/.test(specifier);
	if (isRelative && !hasExtension) {
		for (const extension of CANDIDATE_EXTENSIONS) {
			try {
				return nextResolve(specifier + extension, context);
			} catch {
				// 换下一个扩展名继续试
			}
		}
	}
	return nextResolve(specifier, context);
}

/** 注册解析钩子；必须在动态 import 业务模块之前调用一次。 */
export function registerTsResolve() {
	registerHooks({ resolve });
}
