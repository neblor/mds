/**
 * 图标导出表守卫。
 *
 * 背景：`vite.config.ts` 把 `lucide-solid` 别名到 `src/lib/icons.tsx`（按需入口），
 * 但 tsc 按真实包解析类型 —— 于是「组件里用了某个图标、icons.tsx 忘了 re-export」
 * 在 tsc 下完全通过，运行时才炸成
 * `SyntaxError: The requested module '/src/lib/icons.tsx' does not provide an export named 'X'`，
 * 而且 dev 下只表现为「页面能渲染但事件不工作」，非常难查（本轮就踩到过）。
 * 这里直接对源码做静态校验，缺一个就失败。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const srcRoot = resolve(import.meta.dirname, "..");
const iconsFile = join(srcRoot, "lib", "icons.tsx");

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) walk(full, out);
		else if (/\.(tsx?|jsx?)$/.test(entry) && !entry.endsWith(".test.ts")) out.push(full);
	}
	return out;
}

/** icons.tsx 里 export 出来的名字 */
function exportedIcons(): Set<string> {
	const source = readFileSync(iconsFile, "utf8");
	const names = new Set<string>();
	for (const match of source.matchAll(/export\s+\{\s*default\s+as\s+(\w+)\s*\}/g)) {
		if (match[1]) names.add(match[1]);
	}
	return names;
}

/** 各文件里 `import { A, B } from "lucide-solid"` 用到的图标名 */
function importedIcons(): Map<string, string[]> {
	const byFile = new Map<string, string[]>();
	for (const file of walk(srcRoot)) {
		if (file === iconsFile) continue;
		const source = readFileSync(file, "utf8");
		const names: string[] = [];
		for (const match of source.matchAll(
			/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"lucide-solid"/g,
		)) {
			for (const raw of (match[1] ?? "").split(",")) {
				const name = raw.trim().split(/\s+as\s+/)[0]?.trim();
				if (name) names.push(name);
			}
		}
		if (names.length > 0) byFile.set(file, names);
	}
	return byFile;
}

describe("lucide 按需入口", () => {
	it("组件里用到的图标必须都在 icons.tsx 里 re-export", () => {
		const exported = exportedIcons();
		const missing: string[] = [];
		for (const [file, names] of importedIcons()) {
			for (const name of names) {
				if (!exported.has(name)) {
					missing.push(`${file.replace(`${srcRoot}/`, "")}: ${name}`);
				}
			}
		}
		expect(missing, `icons.tsx 缺少这些导出：\n${missing.join("\n")}`).toEqual([]);
	});

	it("icons.tsx 里的图标名用 kebab-case 子路径（升级 lucide 时要能解析）", () => {
		const source = readFileSync(iconsFile, "utf8");
		const subpaths = [...source.matchAll(/lucide-solid\/icons\/([\w-]+)/g)].map(
			(match) => match[1],
		);
		expect(subpaths.length).toBeGreaterThan(20);
		expect(subpaths.every((name) => /^[a-z0-9-]+$/.test(name ?? ""))).toBe(true);
	});
});
