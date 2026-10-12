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
			// ① 主入口 → 本地 re-export（按需图标入口）
			{
				find: /^lucide-solid$/,
				replacement: resolve(import.meta.dirname, "src/lib/icons.tsx"),
			},
			// ② `lucide-solid/icons/<name>` 子路径 → 实际单文件目录
			// （solid 条件在 dev 下不被 vite 用于 exports 解析，显式指向源码单文件；
			// 该子路径在 package.json 的 exports 里有 types，tsc 能解析，见 icons.tsx）
			{
				find: /^lucide-solid\/icons\//,
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
			// 忽略项目内运行时/构建缓存目录：历史上 wine 前缀曾落在 .tmp/ 下，其
			// dosdevices/z: → / 会让跟随软链的监听器追到根文件系统、撞上符号链接环
			// （/run/udev/watch 等）触发 ELOOP 使 dev 服务崩溃。前缀现已外移到
			// ~/.cache/mds（见 plans/wine-prefix-rootfs-escape.md），此处保留作纵深防护。
			ignored: [
				"**/.tmp/**",
				"**/.output/**",
				"**/.mds-data/**",
				"**/dist/**",
			],
		},
	},
});
