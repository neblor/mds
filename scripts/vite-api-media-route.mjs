/**
 * Nitro 3 beta 的 Vite 开发中间件与业务路由的两类分流缺陷（仅 dev，生产无此层）：
 *
 * 1. /api/audio：Sec-Fetch-Dest=audio 被当静态资源跳过 Nitro，
 *    但它是动态服务端路由 → 对该路径改写为 empty，让 Nitro 接管。
 *
 * 2. ?import 的 JSON 模块：Nitro 的资产扩展名白名单（ASSET_EXT_RE）不含 json，
 *    pnpm 深路径的 package.json?import 会被当成页面路由 SSR 渲染返回 text/html，
 *    浏览器拒绝执行（MIME 不允许）导致整条 import 链断裂、界面不水合。
 *    → 把 Sec-Fetch-Dest 改写为 script，让 Nitro 视作资产放行给 Vite transform。
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

/** 判定是否为 vite JSON 模块请求：路径 .json 结尾且查询串带 import */
export function isJsonImportRequest(url) {
	const [pathname, query = ""] = url?.split(/[?#]/, 2) ?? [];
	return (
		typeof pathname === "string" &&
		pathname.endsWith(".json") &&
		/(^|&)import\b/.test(query)
	);
}

export function normalizeJsonImportFetchDest(request) {
	if (
		isJsonImportRequest(request.url) &&
		request.headers["sec-fetch-dest"] !== "script"
	) {
		request.headers["sec-fetch-dest"] = "script";
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
				normalizeJsonImportFetchDest(request);
				next();
			});
		},
	};
}
