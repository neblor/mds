/**
 * 运行时存储单例：业务路由只从这里拿存储，不自己拼路径、不判断运行环境
 * （与 audio/definitions 的 runtimeCache 同一套边界思路）。
 */
import { bankDir, reviewDir } from "./data-paths";
import { createBankStore } from "./bank-store";
import { createReviewStore } from "./review-store";

export const bankStore = createBankStore(bankDir);
export const reviewStore = createReviewStore(reviewDir);
