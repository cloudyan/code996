import dayjs from '../../utils/dayjs';
import { GitCollector } from '../../git/git-collector';
import { AnalyzeOptions } from '../index';
import { calculateTimeRange } from '../../utils/terminal';
import { GitLogOptions } from '../../types/git-types';

type TimeRangeMode = 'all-time' | 'custom' | 'auto-last-commit' | 'fallback';

interface TimeRangeResult {
  since?: string;
  until?: string;
  mode?: TimeRangeMode;
  note?: string;
}

/**
 * 解析时间范围（复用 analyze/ranking/trend 命令的逻辑）
 */
export async function resolveTimeRange(
  collector: GitCollector,
  path: string,
  options: AnalyzeOptions,
  debug: boolean = false
): Promise<TimeRangeResult> {
  if (options.allTime) {
    // --all-time 时不传 since 和 until，让 git 返回所有数据
    return {
      mode: 'all-time',
    };
  }

  // 处理 --year 参数
  if (options.year) {
    const yearRange = parseYearOption(options.year);
    if (yearRange) {
      return {
        since: yearRange.since,
        until: yearRange.until,
        mode: 'custom',
        note: yearRange.note,
      };
    }
  }

  if (options.since || options.until) {
    const fallback = calculateTimeRange(false);
    return {
      since: options.since || fallback.since,
      until: options.until || fallback.until,
      mode: 'custom',
    };
  }

  const baseOptions: GitLogOptions = {
    path,
    since: '1970-01-01',
    until: '2100-01-01',
    silent: true,
    authorPattern: undefined,
  };

  try {
    const lastCommitDate = await collector.getLastCommitDate(baseOptions);
    if (lastCommitDate) {
      const untilDate = toUTCDate(lastCommitDate);
      const sinceDate = untilDate.subtract(365, 'day');

      // 确保开始日期不早于1970年
      if (sinceDate.isBefore(dayjs('1970-01-01'))) {
        return {
          since: '1970-01-01',
          until: formatUTCDate(untilDate),
          mode: 'auto-last-commit',
          note: '以最后一次提交为基准回溯365天',
        };
      }

      return {
        since: formatUTCDate(sinceDate),
        until: formatUTCDate(untilDate),
        mode: 'auto-last-commit',
        note: '以最后一次提交为基准回溯365天',
      };
    }
  } catch {}

  const fallback = calculateTimeRange(false);
  return {
    since: fallback.since,
    until: fallback.until,
    mode: 'fallback',
  };
}

/**
 * 仅解析年份选项，不执行 Git 操作
 */
export function parseYearOption(yearStr: string): { since: string; until: string; note?: string } | null {
  // 去除空格
  yearStr = yearStr.trim();

  // 匹配年份范围格式：2023-2025
  const rangeMatch = yearStr.match(/^(\d{4})-(\d{4})$/);
  if (rangeMatch) {
    const startYear = parseInt(rangeMatch[1], 10);
    const endYear = parseInt(rangeMatch[2], 10);

    // 验证年份合法性
    if (startYear < 1970 || endYear < 1970 || startYear > endYear) {
      console.error('❌ 年份格式错误: 起始年份不能大于结束年份，且年份必须 >= 1970');
      process.exit(1);
    }

    return {
      since: `${startYear}-01-01`,
      until: `${endYear}-12-31`,
      note: `${startYear}-${endYear}年`,
    };
  }

  // 匹配单年格式：2025
  const singleMatch = yearStr.match(/^(\d{4})$/);
  if (singleMatch) {
    const year = parseInt(singleMatch[1], 10);

    // 验证年份合法性
    if (year < 1970) {
      console.error('❌ 年份格式错误: 年份必须 >= 1970');
      process.exit(1);
    }

    return {
      since: `${year}-01-01`,
      until: `${year}-12-31`,
      note: `${year}年`,
    };
  }

  // 格式不正确
  console.error('❌ 年份格式错误: 请使用 YYYY 格式（如 2025）或 YYYY-YYYY 格式（如 2023-2025）');
  process.exit(1);
}

function toUTCDate(dateStr: string): dayjs.Dayjs {
  return dayjs.utc(dateStr);
}

function formatUTCDate(date: dayjs.Dayjs): string {
  return date.format('YYYY-MM-DD');
}
