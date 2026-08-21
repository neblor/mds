import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const defaultFs = { mkdirSync, unlinkSync, writeFileSync };

/**
 * 安装版（NSIS）运行时数据统一放在 Electron userData 下的 mds-data：
 * 符合 Windows 惯例，且按用户选择卸载时保留（deleteAppDataOnUninstall=false）；
 * 不在安装目录（Program Files / 用户 Programs）留运行时数据残渣。
 */
export function clientDataDirCandidates({ userDataDir }) {
	return [resolve(userDataDir, "mds-data")];
}

/** 确认目录真实可写；不可写时按候选顺序回退，全部失败给出明确错误。 */
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
