export const BUMP_TYPES = ["major", "minor", "patch", "test"] as const;
export type BumpType = (typeof BUMP_TYPES)[number];

/**
 * 打包目标：自增类型（`major|minor|patch`）、`test` 通道，或显式版本 `1.2.3`（可带 `v` 前缀）。
 * 显式版本用于发布当前版本（例如首个 `1.0.0`）与续跑发布，仍然只有 `package.json` 一处版本来源。
 */
export type PackageTarget = BumpType | string;

const TARGET_USAGE =
	"用法：pnpm client:package <major|minor|patch|test|X.Y.Z>（目标必填且只能有一个）";

export function isBumpType(value: string): value is BumpType {
	return (BUMP_TYPES as readonly string[]).includes(value);
}

export function parseVersion(version: string): [number, number, number] {
	const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(
		String(version),
	);
	if (!match) throw new Error(`package.json version 必须是 x.y.z：${version}`);
	const parts = [Number(match[1]), Number(match[2]), Number(match[3])] as [
		number,
		number,
		number,
	];
	if (!parts.every((part) => Number.isSafeInteger(part))) {
		throw new Error(`package.json version 各段必须是安全整数：${version}`);
	}
	return parts;
}

export function compareVersions(left: string, right: string): number {
	const [leftMajor, leftMinor, leftPatch] = parseVersion(left);
	const [rightMajor, rightMinor, rightPatch] = parseVersion(right);
	return (
		leftMajor - rightMajor || leftMinor - rightMinor || leftPatch - rightPatch
	);
}

/** 去掉可选 `v` 前缀并校验为 `x.y.z`。 */
export function normalizeVersion(input: string): string {
	const text = String(input).trim();
	const stripped = /^[vV]/.test(text) ? text.slice(1) : text;
	parseVersion(stripped);
	return stripped;
}

/** 解析打包目标：自增类型原样返回，显式版本归一为 `x.y.z`。 */
export function parsePackageTarget(args: string[]): PackageTarget {
	if (args.length !== 1) throw new Error(TARGET_USAGE);
	const raw = String(args[0]).trim();
	if (isBumpType(raw)) return raw;
	if (!/^[vV]?\d/.test(raw)) throw new Error(TARGET_USAGE);
	return normalizeVersion(raw);
}

export function bumpVersion(version: string, bumpType: BumpType): string {
	const [major, minor, patch] = parseVersion(version);
	let next: string;
	switch (bumpType) {
		case "major":
			next = `${major + 1}.0.0`;
			break;
		case "minor":
			next = `${major}.${minor + 1}.0`;
			break;
		case "patch":
			next = `${major}.${minor}.${patch + 1}`;
			break;
		case "test":
			next = version;
			break;
		default:
			throw new Error(`未知版本递增类型：${String(bumpType)}`);
	}
	parseVersion(next);
	return next;
}

export interface PackagePlan {
	/** `explicit` 表示命令行直接给了版本号（不升版，仅按该版本打包） */
	bumpType: BumpType | "explicit";
	currentVersion: string;
	targetVersion: string;
	artifactName: string;
	changesVersion: boolean;
	outputDir: string;
}

export function createPackagePlan(
	version: string,
	target: PackageTarget | BumpType,
): PackagePlan {
	const explicit = !isBumpType(String(target));
	const targetVersion = explicit
		? String(target)
		: bumpVersion(version, target as BumpType);
	if (explicit && compareVersions(targetVersion, version) < 0) {
		throw new Error(
			`显式版本不能小于当前版本 ${version}：${targetVersion}`,
		);
	}
	return {
		bumpType: explicit ? "explicit" : (target as BumpType),
		currentVersion: version,
		targetVersion,
		artifactName: `mds-${targetVersion}-setup.exe`,
		changesVersion: targetVersion !== version,
		outputDir:
			target === "test" ? "dist/electron-test" : "dist/electron",
	};
}
