/**
 * 兼容模式：旧 JSON/JSONL 存储（迁移失败时临时使用）
 *
 * 目的只有一个：迁移出问题时，默写/队列/结算仍然可用，不把用户挡在门外。
 * 统计页在兼容模式不可用（stats = null，路由返回 503）。
 * 兼容模式写入的 cards/logs/sessions 会在下次启动迁移时一并导入 SQLite。
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { isValidBankId } from "./bank-types";
import { localDateKey } from "./day";
import {
	appendJsonl,
	readJsonFile,
	readJsonl,
	writeJsonFileAtomic,
} from "./json-file";
import {
	logToJson,
	parseCards,
	parseLogRecord,
	parseSessionRecord,
	sessionToJson,
	type CommitPayload,
	type DayStats,
	type ReviewLogRecord,
	type ReviewStore,
	type SessionLogRecord,
	type StoredCards,
} from "./review-types";

export function createLegacyReviewStore(rootDir: string): ReviewStore {
	mkdirSync(rootDir, { recursive: true });
	const cardsPath = (bankId: string): string =>
		join(rootDir, `${assertBank(bankId)}.cards.json`);
	const logPath = (bankId: string): string =>
		join(rootDir, `${assertBank(bankId)}.log.jsonl`);
	const sessionsPath = (bankId: string): string =>
		join(rootDir, `${assertBank(bankId)}.sessions.jsonl`);

	const readCards = (bankId: string): StoredCards =>
		parseCards(readJsonFile(cardsPath(bankId)));

	const readLogs = (bankId: string): ReviewLogRecord[] => {
		const records: ReviewLogRecord[] = [];
		for (const value of readJsonl(logPath(bankId))) {
			const record = parseLogRecord(value);
			if (record) records.push(record);
		}
		return records;
	};

	const readSessions = (bankId: string): SessionLogRecord[] => {
		const records: SessionLogRecord[] = [];
		for (const value of readJsonl(sessionsPath(bankId))) {
			const record = parseSessionRecord(value, bankId);
			if (record) records.push(record);
		}
		return records;
	};

	return {
		mode: "legacy",
		stats: null,

		readCards,
		readLogs,
		readSessions,

		readDayStats(bankId: string, date: string): DayStats {
			assertBank(bankId);
			let correct = 0;
			let total = 0;
			let elapsedMs = 0;
			for (const record of readLogs(bankId)) {
				if (localDateKey(new Date(record.at)) !== date) continue;
				total += 1;
				if (record.correct) correct += 1;
				elapsedMs += Math.max(0, record.elapsedMs);
			}
			let words = 0;
			for (const session of readSessions(bankId)) {
				if (localDateKey(new Date(session.at)) !== date) continue;
				words += session.words.length;
			}
			return { date, words, correct, total, elapsedMs };
		},

		commit(bankId: string, payload: CommitPayload): { duplicate: boolean } {
			assertBank(bankId);
			if (payload.session) {
				const clean = parseSessionRecord(
					sessionToJson(payload.session),
					bankId,
				);
				if (
					clean &&
					readSessions(bankId).some((session) => session.id === clean.id)
				) {
					return { duplicate: true };
				}
			}

			if (payload.cards.length > 0) {
				const cards = readCards(bankId);
				for (const item of payload.cards) {
					cards[item.key] = item.card;
				}
				writeJsonFileAtomic(cardsPath(bankId), {
					version: 1,
					updatedAt: Date.now(),
					cards,
				});
			}
			if (payload.logs.length > 0) {
				appendJsonl(logPath(bankId), payload.logs.map(logToJson));
			}
			if (payload.session) {
				const clean = parseSessionRecord(
					sessionToJson(payload.session),
					bankId,
				);
				if (clean) appendJsonl(sessionsPath(bankId), [sessionToJson(clean)]);
			}
			return { duplicate: false };
		},

		removeBankState(bankId: string): void {
			assertBank(bankId);
			rmSync(cardsPath(bankId), { force: true });
			rmSync(logPath(bankId), { force: true });
			rmSync(sessionsPath(bankId), { force: true });
		},

		close(): void {
			// JSON 每次写入即落盘，没有连接需要关闭
		},
	};
}

function assertBank(bankId: string): string {
	if (!isValidBankId(bankId)) throw new Error(`非法词库 id：${bankId}`);
	return bankId;
}

/** 兼容模式是否还有可迁移的旧文件（迁移失败/存在数据时用于诊断） */
export function legacyFilesExist(rootDir: string, bankId: string): boolean {
	if (!isValidBankId(bankId)) return false;
	return [
		join(rootDir, `${bankId}.cards.json`),
		join(rootDir, `${bankId}.log.jsonl`),
		join(rootDir, `${bankId}.sessions.jsonl`),
	].some((path) => existsSync(path));
}
