export const BUMP_TYPES = ["major", "minor", "patch", "test"] as const;
export type BumpType = (typeof BUMP_TYPES)[number];

export function parseBumpType(args: string[]): BumpType {
	if (args.length !== 1 || !BUMP_TYPES.includes(args[0] as BumpType)) {
		throw new Error(
			"用法：pnpm client:package <major|minor|patch|test>（bump_type 必填且只能有一个）",
		);
	}
	return args[0] as BumpType;
}

export function parseVersion(version: string): [number, number, number] {
	const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(
		String(version),
	);
	if (!match) throw new Error(`package.json version 必须是 x.y.z：${version}`);
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function bumpVersion(version: string, bumpType: BumpType): string {
	const [major, minor, patch] = parseVersion(version);
	switch (bumpType) {
		case "major":
			return `${major + 1}.0.0`;
		case "minor":
			return `${major}.${minor + 1}.0`;
		case "patch":
			return `${major}.${minor}.${patch + 1}`;
		case "test":
			return version;
	}
}

export function createPackagePlan(version: string, bumpType: BumpType) {
	const targetVersion = bumpVersion(version, bumpType);
	return {
		bumpType,
		currentVersion: version,
		targetVersion,
		artifactName: `mds-${targetVersion}-x64.exe`,
		changesVersion: bumpType !== "test",
		outputDir:
			bumpType === "test" ? "dist/electron-test" : "dist/electron",
	};
}
