import {
	closeSync,
	existsSync,
	openSync,
	readFileSync,
	readSync,
	readdirSync,
	statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function parseOptions(args) {
	const options = {};
	for (let index = 0; index < args.length; index++) {
		const name = args[index];
		if (name === "--") continue;
		if (name !== "--output-dir" && name !== "--version") {
			throw new Error(`未知参数：${name}`);
		}
		const value = args[++index];
		if (!value || value.startsWith("--")) throw new Error(`${name} 缺少值`);
		options[name.slice(2)] = value;
	}
	return options;
}

const options = parseOptions(process.argv.slice(2));
const packageJson = JSON.parse(
	readFileSync(join(projectRoot, "package.json"), "utf8"),
);
const outputDir = resolve(projectRoot, options["output-dir"] ?? "dist/electron");
const packageVersion = options.version ?? packageJson.version;
const artifact = join(outputDir, `mds-${packageVersion}-x64.exe`);
const appDir = join(outputDir, "win-unpacked", "resources", "app");

const failures = [];
if (!existsSync(artifact)) {
	failures.push(`缺少 portable EXE：${artifact}`);
} else {
	const stat = statSync(artifact);
	const header = Buffer.alloc(2);
	const descriptor = openSync(artifact, "r");
	try {
		readSync(descriptor, header, 0, header.length, 0);
	} finally {
		closeSync(descriptor);
	}
	if (stat.size < 1024 * 1024) failures.push("portable EXE 体积异常小");
	if (header[0] !== 0x4d || header[1] !== 0x5a) {
		failures.push("portable 产物不是有效的 Windows MZ 可执行文件");
	}
}

const required = [
	join(appDir, ".output", "server", "index.mjs"),
	join(appDir, ".output", "public", "icons", "app.ico"),
	join(appDir, "electron", "main.mjs"),
	join(appDir, "electron", "runtime-paths.mjs"),
	join(appDir, "electron", "window-options.mjs"),
];
for (const file of required) {
	if (!existsSync(file)) failures.push(`包内缺少运行文件：${file}`);
}

const forbidden = [
	join(appDir, "node_modules"),
	join(appDir, ".output", "public", "word-cache"),
];
for (const path of forbidden) {
	if (existsSync(path)) failures.push(`包内出现不应打包的目录：${path}`);
}

if (failures.length > 0) {
	for (const failure of failures) console.error(`- ${failure}`);
	process.exit(1);
}

const size = statSync(artifact).size;
const topLevelFiles = readdirSync(outputDir).sort();
console.log(`Electron portable verified: ${artifact} (${size} bytes)`);
console.log(`Output entries: ${topLevelFiles.join(", ")}`);
