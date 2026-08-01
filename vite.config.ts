import { defineConfig } from "vite";
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
	server: {
		// 固定端口，避免与其他项目（如 vue-admin 的 5173）冲突
		port: 5199,
		strictPort: true,
	},
});
