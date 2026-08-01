import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverEntry = resolve(projectRoot, ".output", "server", "index.mjs");

function parseOptions(args) {
	const options = {};
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--") continue;
		const [name, inlineValue] = arg.split("=", 2);
		if (!["--host", "--port", "--cache-dir"].includes(name)) {
			throw new Error(`未知参数：${arg}`);
		}
		const value = inlineValue ?? args[++index];
		if (!value || value.startsWith("--")) {
			throw new Error(`${name} 缺少参数值`);
		}
		options[name.slice(2)] = value;
	}
	return options;
}

let options;
try {
	options = parseOptions(process.argv.slice(2));
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	console.error(
		"用法：pnpm web:start -- --host 127.0.0.1 --port 3000 --cache-dir .mds-data/word-cache",
	);
	process.exit(1);
}

if (!existsSync(serverEntry)) {
	console.error("未找到 Web 生产构建，请先运行 pnpm web:build");
	process.exit(1);
}

const host = options.host ?? process.env.NITRO_HOST ?? process.env.HOST ?? "127.0.0.1";
const portText = options.port ?? process.env.NITRO_PORT ?? process.env.PORT ?? "3000";
const port = Number(portText);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
	console.error(`端口必须是 1-65535 的整数，当前值：${portText}`);
	process.exit(1);
}

process.chdir(projectRoot);
process.env.MDS_RUNTIME_MODE = "web";
process.env.HOST = host;
process.env.NITRO_HOST = host;
process.env.PORT = String(port);
process.env.NITRO_PORT = String(port);
if (options["cache-dir"]) {
	process.env.MDS_CACHE_DIR = resolve(projectRoot, options["cache-dir"]);
}

const cacheDescription =
	process.env.MDS_CACHE_DIR ?? resolve(projectRoot, ".mds-data", "word-cache");
console.log(`Web production: http://${host}:${port}; cache: ${cacheDescription}`);
await import(pathToFileURL(serverEntry).href);

const probeHost =
	host === "0.0.0.0" ? "127.0.0.1" : host === "::" ? "[::1]" : host;
let ready = false;
for (let attempt = 0; attempt < 40; attempt++) {
	try {
		const response = await fetch(`http://${probeHost}:${port}/`, {
			signal: AbortSignal.timeout(500),
		});
		await response.arrayBuffer();
		if (response.ok) {
			ready = true;
			break;
		}
	} catch {
		// 服务尚未就绪，继续轮询
	}
	await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
}
if (!ready) {
	throw new Error(`Web production 未能监听 ${host}:${port}`);
}
console.log("Web production ready");

// 当前 Nitro 3 beta 的 node-server listener 不会单独保持 Node 事件循环；
// Electron 有 BrowserWindow 作为活动句柄，纯 Web 生产进程则需要显式保活。
setInterval(() => {}, 60_000);
