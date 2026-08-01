import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const defaultFs = { mkdirSync, unlinkSync, writeFileSync };

/**
 * portable 构建优先把运行时数据放在用户持有的 exe 同目录；
 * 开发态或同目录不可写时，回退到 Electron 的 userData。
 */
export function clientDataDirCandidates({ portableExecutableDir, userDataDir }) {
	const fallback = resolve(userDataDir, "mds-data");
	if (!portableExecutableDir?.trim()) return [fallback];
	const portable = resolve(portableExecutableDir, "mds-data");
	return portable === fallback ? [portable] : [portable, fallback];
}

/** 确认目录真实可写；portable exe 被放进只读目录时可安全走下一候选。 */
export function ensureWritableDataDir(candidates, fs = defaultFs) {
	let lastError;
	for (const candidate of candidates) {
		const probe = join(candidate, `.mds-write-test-${process.pid}`);
		try {
			fs.mkdirSync(candidate, { recursive: true });
			fs.writeFileSync(probe, "");
			fs.unlinkSync(probe);
			return candidate;
		} catch (error) {
			lastError = error;
			try {
				fs.unlinkSync(probe);
			} catch {
				// 探针未创建，无需处理
			}
		}
	}
	throw new Error("没有可写的应用数据目录", { cause: lastError });
}
