#!/usr/bin/env node
/**
 * 从已有归档续跑发布：`pnpm release:publish v1.0.0 [--execute]`
 *
 * 用途：构建成功但提交/tag/推送/上传中途失败，或 `pnpm release --no-publish`
 * 之后人工验收完。**不重建、不重新打包**，只补未完成的部分（幂等）。
 * 默认只读预览，必须显式 `--execute` 才会写 git、推送与上传。
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePublishArgs } from "../src/lib/release-plan.ts";
import { publishRelease } from "./release.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
try {
	const { version, execute, allowDraftNotes } = parsePublishArgs(
		process.argv.slice(2),
	);
	publishRelease({ root: projectRoot, version, execute, allowDraftNotes });
} catch (error) {
	console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
	console.error(
		"已完成的提交/tag/上传都保留：排障后重跑同一条指令；不要删 tag、不要强推、不要覆盖已有资产。",
	);
	process.exitCode = 1;
}
