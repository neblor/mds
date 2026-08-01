/**
 * Nitro 3 的 Vite 开发中间件会把 Sec-Fetch-Dest=audio 当成静态资源并跳过 Nitro。
 * 本项目的 /api/audio 是动态服务端路由，因此只对该路径改写为 empty，让 Nitro 接管。
 * 生产 Nitro server 没有这层 Vite 静态资源分流，不需要改写。
 */
export function normalizeApiAudioFetchDest(request) {
	const pathname = request.url?.split(/[?#]/, 1)[0];
	if (
		pathname === "/api/audio" &&
		request.headers["sec-fetch-dest"] === "audio"
	) {
		request.headers["sec-fetch-dest"] = "empty";
		return true;
	}
	return false;
}

export function apiAudioNitroDevPlugin() {
	return {
		name: "mds-api-audio-nitro-dev-route",
		enforce: "pre",
		configureServer(server) {
			server.middlewares.use((request, _response, next) => {
				normalizeApiAudioFetchDest(request);
				next();
			});
		},
	};
}
