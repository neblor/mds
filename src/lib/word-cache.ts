/**
 * 缓存目录（服务端共享）
 * 定在 public/word-cache/ 下：web 模式下 public 是静态可访问目录，client 模式同样不影响流程。
 * 音频按词+音色缓存；释义缓存在同一目录（不随音色走）。
 */
import { join } from "node:path";
import { mkdirSync } from "node:fs";

export const VOICE = "en-US-AvaNeural";
/**
 * 缓存根目录：默认 <cwd>/public/word-cache（web 模式）；
 * electron 桌面端由主进程设置 MDS_CACHE_DIR 指向 userData（可写、持久、不污染安装目录）
 */
export const cacheDir =
	process.env.MDS_CACHE_DIR ?? join(process.cwd(), "public", "word-cache");
/** 释义缓存文件（{ model, defs }，与音色无关） */
export const definitionsFile = join(cacheDir, "definitions.json");
mkdirSync(cacheDir, { recursive: true });
