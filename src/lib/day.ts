/**
 * 本地日期工具。
 *
 * 只给**统计/归档**用：取词队列本身按 SRS 的 `due <= now` 取词，不拿「今天」做边界。
 * 日界线一律用本地时区（与 SQLite 的 `day` 列一致），避免 UTC/DST 漂移。
 */
export function localDateKey(date: Date): string {
	const year = date.getFullYear();
	const month = `${date.getMonth() + 1}`.padStart(2, "0");
	const day = `${date.getDate()}`.padStart(2, "0");
	return `${year}-${month}-${day}`;
}
