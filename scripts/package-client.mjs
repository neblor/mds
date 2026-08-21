import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
	createPackagePlan,
	parseBumpType,
} from "../src/lib/client-package-version.ts";
import { cleanupPackageOutput } from "../src/lib/client-package-cleanup.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagePath = join(projectRoot, "package.json");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function runPnpm(args) {
	const result = spawnSync(pnpmCommand, args, {
		cwd: projectRoot,
		stdio: "inherit",
		env: process.env,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(`pnpm ${args.join(" ")} 失败（退出码 ${result.status}）`);
	}
}

let bumpType;
try {
	bumpType = parseBumpType(process.argv.slice(2));
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}

const originalPackageText = readFileSync(packagePath, "utf8");
const originalPackage = JSON.parse(originalPackageText);
const plan = createPackagePlan(originalPackage.version, bumpType);
const packagingPackage = structuredClone(originalPackage);
packagingPackage.version = plan.targetVersion;
packagingPackage.build.directories.output = plan.outputDir;
const writePackage = (value) =>
	writeFileSync(packagePath, `${JSON.stringify(value, null, 2)}\n`);

console.log(
	plan.changesVersion
		? `正式打包：${plan.currentVersion} → ${plan.targetVersion}（${bumpType}）`
		: `测试打包：保持版本 ${plan.currentVersion}，输出到 ${plan.outputDir}`,
);

let packageWasChanged = false;
try {
	runPnpm(["check"]);
	writePackage(packagingPackage);
	packageWasChanged = true;
	runPnpm(["exec", "electron-builder", "--win", "nsis"]);
	runPnpm([
		"client:verify",
		"--",
		"--output-dir",
		plan.outputDir,
		"--version",
		plan.targetVersion,
	]);
	const cleanup = cleanupPackageOutput(
		join(projectRoot, plan.outputDir),
		plan.artifactName,
	);
	console.log(
		cleanup.removedEntries.length > 0
			? `已清理 ${cleanup.removedEntries.length} 个构建临时项，仅保留 ${plan.artifactName}`
			: `输出目录已仅包含 ${plan.artifactName}`,
	);

	if (plan.changesVersion) {
		const finalPackage = structuredClone(originalPackage);
		finalPackage.version = plan.targetVersion;
		writePackage(finalPackage);
		console.log(`正式版本已更新为 ${plan.targetVersion}`);
	} else {
		writeFileSync(packagePath, originalPackageText);
		console.log(`测试打包完成，版本仍为 ${plan.currentVersion}`);
	}
} catch (error) {
	if (packageWasChanged) writeFileSync(packagePath, originalPackageText);
	console.error(error instanceof Error ? error.message : String(error));
	console.error("打包失败，package.json 已恢复，版本号未变更。");
	process.exitCode = 1;
}
