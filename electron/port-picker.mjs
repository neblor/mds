/**
 * 内置服务端口动态挑选
 *
 * 背景：Windows 的 Hyper-V/WSL NAT 会动态保留端口段（netsh excludedportrange，
 * netstat 不可见，随重启洗牌）。固定端口落在保留段内时 bind 直接 EACCES，
 * 而 nitro/srvx 的 listen 失败被 `serve().catch(() => {})` 静默吞掉，
 * 表现为“内置服务启动超时”。因此主进程先自行探测可绑端口：
 *
 * 1. 优先尝试候选端口（默认 4827，保持习惯上的稳定值）
 * 2. 候选全部不可绑（EACCES/EADDRINUSE 等）时，绑 port 0 由 OS 分配空闲端口
 * 3. 探测用的 server 保持占用（release 前端口不会被抢），交给 nitro 前一刻再释放
 */
import nodeNet from "node:net";

export const PREFERRED_PORT = 4827;

/** 单次 listen：resolve 地址对象，reject 错误（不泄漏监听器） */
function listenOnce(server, port, host) {
	return new Promise((resolve, reject) => {
		const onError = (error) => {
			server.off("listening", onListening);
			reject(error);
		};
		const onListening = () => {
			server.off("error", onError);
			resolve(server.address());
		};
		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(port, host);
	});
}

function closeQuietly(server) {
	return new Promise((resolve) => {
		// 已 stop 的 server 再 close 会回调 error（ERR_SERVER_NOT_RUNNING），静默处理
		server.close(() => resolve());
	});
}

/**
 * 挑一个可绑定的本地端口。
 * 返回 { port, release }：release() 释放探测占位（应紧接着启动真正的服务）。
 * 连 OS 分配都失败时抛错（几乎不可能，如 fd 耗尽）。
 */
export async function acquireServerPort({
	host = "127.0.0.1",
	candidates = [PREFERRED_PORT],
	net = nodeNet,
} = {}) {
	for (const port of candidates) {
		const server = net.createServer();
		try {
			const addr = await listenOnce(server, port, host);
			if (addr && typeof addr.port === "number" && addr.port > 0) {
				return { port: addr.port, release: () => closeQuietly(server) };
			}
			await closeQuietly(server);
		} catch {
			await closeQuietly(server).catch(() => {});
		}
	}
	// 兜底：OS 分配空闲端口（绝不会撞保留段/占用）
	const server = net.createServer();
	try {
		const addr = await listenOnce(server, 0, host);
		return { port: addr.port, release: () => closeQuietly(server) };
	} catch (error) {
		await closeQuietly(server).catch(() => {});
		throw new Error(`本地端口均不可绑定: ${error?.code ?? error?.message ?? error}`);
	}
}
