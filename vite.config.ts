import { defineConfig } from "vite";
import { resolve } from "node:path";
import { nitro } from "nitro/vite";
import { solidStart } from "@solidjs/start/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
	plugins: [
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
	},
});
