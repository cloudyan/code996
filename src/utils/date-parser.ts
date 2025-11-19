import chalk from 'chalk'

/**
 * 解析 --days 参数，计算最近 N 天的时间范围
 */
export function calculateDaysRange(days: number): { since: string; until: string; note?: string } | null {
  // 验证天数合法性
  if (!Number.isInteger(days) || days <= 0) {
    console.error(chalk.red('❌ 天数格式错误: 请输入正整数'))
    process.exit(1)
  }

  const now = new Date()
  const untilDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()) // 今天 00:00:00
  const sinceDate = new Date(untilDate)
  sinceDate.setDate(sinceDate.getDate() - days + 1) // N 天前的开始

  const formatDate = (date: Date): string => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  return {
    since: formatDate(sinceDate),
    until: formatDate(untilDate),
    note: `最近${days}天`,
  }
}

/**
 * 解析 --year 参数，支持单年和年份范围
 */
export function parseYearOption(yearStr: string): { since: string; until: string; note?: string } | null {
  // 去除空格
  yearStr = yearStr.trim()

  // 匹配年份范围格式：2023-2025
  const rangeMatch = yearStr.match(/^(\d{4})-(\d{4})$/)
  if (rangeMatch) {
    const startYear = parseInt(rangeMatch[1], 10)
    const endYear = parseInt(rangeMatch[2], 10)

    // 验证年份合法性
    if (startYear < 1970 || endYear < 1970 || startYear > endYear) {
      console.error(chalk.red('❌ 年份格式错误: 起始年份不能大于结束年份，且年份必须 >= 1970'))
      process.exit(1)
    }

    return {
      since: `${startYear}-01-01`,
      until: `${endYear}-12-31`,
      note: `${startYear}-${endYear}年`,
    }
  }

  // 匹配单年格式：2025
  const singleMatch = yearStr.match(/^(\d{4})$/)
  if (singleMatch) {
    const year = parseInt(singleMatch[1], 10)

    // 验证年份合法性
    if (year < 1970) {
      console.error(chalk.red('❌ 年份格式错误: 年份必须 >= 1970'))
      process.exit(1)
    }

    return {
      since: `${year}-01-01`,
      until: `${year}-12-31`,
      note: `${year}年`,
    }
  }

  // 格式不正确
  console.error(chalk.red('❌ 年份格式错误: 请使用 YYYY 格式（如 2025）或 YYYY-YYYY 格式（如 2023-2025）'))
  process.exit(1)
}
