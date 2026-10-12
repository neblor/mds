import { describe, expect, it } from "vitest";
import { acquireServerPort, PREFERRED_PORT } from "../../electron/port-picker.mjs";

/** acquireServerPort 的选项类型（从 .mjs 推断） */
type PortOptions = NonNullable<Parameters<typeof acquireServerPort>[0]>;

interface FakeServer {
	listeners: {
		error: ((error: Error & { code?: string }) => void)[];
		listening: (() => void)[];
	};
	closed: boolean;
	address?: () => { port: number; address: string };
	off(evt: string, fn: (...args: never[]) => void): void;
	once(evt: string, fn: (...args: never[]) => void): void;
	listen(port: number, host: string, cb?: () => void): void;
	close(cb?: () => void): void;
}

interface FakeNetOptions {
	failPorts?: number[];
	ephemeralPort?: number;
}

/** 假 net：按 failPorts 拒绝指定端口的 listen；port 0 分配 ephemeralPort */
function fakeNet({
	failPorts = [],
	ephemeralPort = 54321,
}: FakeNetOptions = {}) {
	const servers: FakeServer[] = [];
	const net = {
		createServer(): FakeServer {
			const server: FakeServer = {
				listeners: { error: [], listening: [] },
				closed: false,
				off(evt, fn) {
					if (evt === "error") {
						server.listeners.error = server.listeners.error.filter(
							(f) => f !== (fn as (error: Error) => void),
						);
					} else {
						server.listeners.listening = server.listeners.listening.filter(
							(f) => f !== (fn as () => void),
						);
					}
				},
				once(evt, fn) {
					if (evt === "error") {
						server.listeners.error.push(fn as (error: Error) => void);
					} else {
						server.listeners.listening.push(fn as () => void);
					}
				},
				listen(port, _host, cb) {
					queueMicrotask(() => {
						if (failPorts.includes(port)) {
							const err = new Error("blocked") as Error & { code?: string };
							err.code = port === PREFERRED_PORT ? "EACCES" : "EADDRINUSE";
							server.listeners.error.forEach((f) => f(err));
						} else {
							server.address = () => ({
								port: port === 0 ? ephemeralPort : port,
								address: "127.0.0.1",
							});
							server.listeners.listening.forEach((f) => f());
						}
						cb?.();
					});
				},
				close(cb) {
					server.closed = true;
					cb?.();
				},
			};
			servers.push(server);
			return server;
		},
	};
	return { net, servers };
}

/** 假 net 只需 createServer，其余 node:net 成员与本测试无关 */
function asNetArg(
	net: { createServer(): FakeServer },
): NonNullable<PortOptions["net"]> {
	return net as unknown as NonNullable<PortOptions["net"]>;
}

describe("acquireServerPort", () => {
	it("首选端口可绑：直接用首选，占位 server 在 release 前保持占用", async () => {
		const { net, servers } = fakeNet();
		const got = await acquireServerPort({ net: asNetArg(net) });
		expect(got.port).toBe(PREFERRED_PORT);
		expect(servers).toHaveLength(1);
		expect(servers[0].closed).toBe(false);
		await got.release();
		expect(servers[0].closed).toBe(true);
	});

	it("首选被系统保留段拒绝（EACCES）：候选耗尽后回落 OS 分配的空闲端口", async () => {
		const { net, servers } = fakeNet({
			failPorts: [PREFERRED_PORT, 14827],
			ephemeralPort: 51888,
		});
		const got = await acquireServerPort({
			net: asNetArg(net),
			candidates: [PREFERRED_PORT, 14827],
		});
		expect(got.port).toBe(51888);
		// 失败的探测 server 都被关闭，不泄漏
		expect(servers.map((s) => s.closed)).toEqual([true, true, false]);
		await got.release();
		expect(servers[2].closed).toBe(true);
	});

	it("端口被占用（EADDRINUSE）同样跳到下一候选", async () => {
		const { net } = fakeNet({ failPorts: [PREFERRED_PORT] });
		const got = await acquireServerPort({
			net: asNetArg(net),
			candidates: [PREFERRED_PORT, 15827],
		});
		expect(got.port).toBe(15827);
	});

	it("连 OS 分配都失败时抛出可读错误", async () => {
		const { net } = fakeNet({ failPorts: [PREFERRED_PORT, 0] });
		await expect(
			acquireServerPort({ net: asNetArg(net) }),
		).rejects.toThrow("本地端口均不可绑定");
	});

	it("真实 node:net 下首选可绑（本环境无保留段干扰的常规情形）", async () => {
		const got = await acquireServerPort({ candidates: [25827] });
		expect(got.port).toBe(25827);
		await got.release();
	});
});
