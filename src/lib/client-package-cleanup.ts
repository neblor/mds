import { existsSync, readdirSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";

export interface PackageCleanupResult {
	artifactPath: string;
	removedEntries: string[];
}

/**
 * 校验最终产物后清理 electron-builder 的展开目录、调试文件及旧产物。
 * 输出目录中只保留本次已经通过校验的 portable EXE。
 */
export function cleanupPackageOutput(
	outputDir: string,
	artifactName: string,
): PackageCleanupResult {
	if (basename(artifactName) !== artifactName || !artifactName.endsWith(".exe")) {
		throw new Error(`非法客户端产物文件名：${artifactName}`);
	}

	const resolvedOutputDir = resolve(outputDir);
	const artifactPath = join(resolvedOutputDir, artifactName);
	if (!existsSync(artifactPath)) {
		throw new Error(`清理前未找到已校验的客户端产物：${artifactPath}`);
	}

	const removedEntries = readdirSync(resolvedOutputDir).filter(
		(entry) => entry !== artifactName,
	);
	for (const entry of removedEntries) {
		rmSync(join(resolvedOutputDir, entry), { recursive: true, force: true });
	}

	return { artifactPath, removedEntries };
}
