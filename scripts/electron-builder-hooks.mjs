/**
 * Nitro 已把服务端运行依赖打进 .output/server，Electron 包内不需要再次复制
 * 根项目的 Web 构建依赖。返回 false 是 electron-builder 的约定：node_modules
 * 由项目自行处理，跳过自动 rebuild/收集。
 */
export function beforeBuild() {
	return false;
}
