import { defineConfig } from "vite";
import { resolve } from "node:path";
import { nitro } from "nitro/vite";
import { solidStart } from "@solidjs/start/config";
import tailwindcss from "@tailwindcss/vite";
import { apiAudioNitroDevPlugin } from "./scripts/vite-api-media-route.mjs";

export default defineConfig({
	plugins: [
		// Nitro 3 beta 在 dev 下默认把 <audio> 请求交给 Vite 静态资源层；
		// /api/audio 是动态路由，必须在 Nitro 分流前把它标记为 fetch 请求。
		apiAudioNitroDevPlugin(),
		solidStart({
			// dev 错误查看器引 source-map-js 有 vite 预构建 interop 缺陷（客户端报错），关闭 overlay
			devOverlay: false,
		}),
		tailwindcss(),
		nitro(),
	],
	resolve: {
		alias: [
			// lucide 按需入口：dev 模式不再全量载入图标库（见 src/lib/icons.tsx）。
			// ① 主入口 → 本地 re-export；② 深路径（icons.tsx 内部用）→ 实际目录，
			// 绕过 exports 字段限制（rolldown 对不在 exports 里的深路径会拒绝）
			{
				find: /^lucide-solid$/,
				replacement: resolve(import.meta.dirname, "src/lib/icons.tsx"),
			},
			{
				find: /^lucide-solid\/dist\/source\/icons\//,
				replacement:
					resolve(
						import.meta.dirname,
						"node_modules/lucide-solid/dist/source/icons/",
					) + "/",
			},
		],
	},
	server: {
		// 固定端口，避免与其他项目（如 vue-admin 的 5173）冲突
		port: 5199,
		strictPort: true,
		watch: {
			// 忽略项目内运行时/构建缓存目录：wine 前缀（.tmp/wine-prefix）含
			// dosdevices/z: → / 的符号链接，监听器追到根文件系统会撞上符号链接环
			// （/run/udev/watch 等）触发 ELOOP 使 dev 服务崩溃。
			ignored: [
				"**/.tmp/**",
				"**/.output/**",
				"**/.mds-data/**",
				"**/dist/**",
			],
		},
	},
});
