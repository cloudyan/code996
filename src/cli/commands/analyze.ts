import chalk from 'chalk'
import ora from 'ora'
import { GitCollector } from '../../git/git-collector'
import { GitParser } from '../../git/git-parser'
import { AnalyzeOptions } from '../index'
import { calculateTimeRange } from '../../utils/terminal'
import { calculateDaysRange, parseYearOption } from '../../utils/date-parser'
import { GitLogData, GitLogOptions, ParsedGitData, Result996 } from '../../types/git-types'
import {
  printCoreResults,
  printDetailedAnalysis,
  printWorkTimeSummary,
  printTimeDistribution,
  printWeekdayOvertime,
  printWeekendOvertime,
  printLateNightAnalysis,
  printRecommendation,
} from './report'
import { ensureCommitSamples } from '../common/commit-guard'

type TimeRangeMode = 'all-time' | 'custom' | 'auto-last-commit' | 'fallback'

interface AuthorFilterInfo {
  pattern: string
  displayLabel: string
}

/** 分析执行器，集中处理采集、解析与渲染流程 */
export class AnalyzeExecutor {
  /** 执行分析的主流程 */
  static async execute(path: string, options: AnalyzeOptions): Promise<void> {
    try {
      const collector = new GitCollector()

      // 计算时间范围：优先使用用户输入，其次按最后一次提交回溯365天，最后退回到当前时间
      const {
        since: effectiveSince,
        until: effectiveUntil,
        mode: rangeMode,
        note: rangeNote,
      } = await resolveTimeRange({ collector, path, options })

      // 显示分析开始信息
      console.log(chalk.blue('🔍 分析仓库:'), path || process.cwd())
      switch (rangeMode) {
        case 'all-time':
          console.log(chalk.blue('📅 时间范围:'), '所有时间')
          break
        case 'custom':
          console.log(chalk.blue('📅 时间范围:'), `${effectiveSince} 至 ${effectiveUntil}`)
          break
        case 'auto-last-commit':
          console.log(
            chalk.blue('📅 时间范围:'),
            `${effectiveSince} 至 ${effectiveUntil}${rangeNote ? `（${rangeNote}）` : ''}`
          )
          break
        default:
          console.log(chalk.blue('📅 时间范围:'), `${effectiveSince} 至 ${effectiveUntil}（按当前日期回溯）`)
      }
      console.log()

      let authorFilter: AuthorFilterInfo | undefined
      if (options.self) {
        authorFilter = await resolveAuthorFilter(collector, path)
        console.log(chalk.blue('🙋 作者过滤:'), authorFilter.displayLabel)
        console.log()
      }

      // 构建统一的 Git 采集参数，保证所有步骤使用一致的过滤条件
      const collectOptions: GitLogOptions = {
        path,
        since: effectiveSince,
        until: effectiveUntil,
        authorPattern: authorFilter?.pattern,
      }

      // 在正式分析前，先检查 commit 样本量是否达到最低要求
      const hasEnoughCommits = await ensureCommitSamples(collector, collectOptions, 20, '分析')
      if (!hasEnoughCommits) {
        return
      }

      // 创建进度指示器
      const spinner = ora('📦 开始分析').start()

      // 步骤1: 数据采集
      const rawData = await collector.collect(collectOptions)
      spinner.text = '⚙️ 正在解析数据...'
      spinner.render()

      // 步骤2: 数据解析与验证
      const parsedData = GitParser.parseGitData(rawData, undefined, effectiveSince, effectiveUntil)
      const validation = GitParser.validateData(parsedData)

      if (!validation.isValid) {
        spinner.fail('数据验证失败')
        console.log(chalk.red('❌ 发现以下错误:'))
        validation.errors.forEach((error) => {
          console.log(`  ${chalk.red('•')} ${error}`)
        })
        process.exit(1)
      }

      spinner.text = '📈 正在计算996指数...'
      spinner.render()

      // 步骤3: 计算996指数
      const result = GitParser.calculate996Index(parsedData)

      spinner.succeed('分析完成！')
      console.log()

      // 若未指定时间范围，尝试回填实际的首尾提交时间
      let actualSince: string | undefined
      let actualUntil: string | undefined

      if (!options.since && !options.until && !options.allTime) {
        try {
          actualSince = await collector.getFirstCommitDate(collectOptions)
          actualUntil = await collector.getLastCommitDate(collectOptions)
        } catch {
          console.log(chalk.yellow('⚠️ 无法获取实际时间范围，将使用默认显示'))
        }
      }

      printResults(result, parsedData, rawData, options, effectiveSince, effectiveUntil, rangeMode)
    } catch (error) {
      console.error(chalk.red('❌ 分析失败:'), (error as Error).message)
      process.exit(1)
    }
  }
}

interface ResolveTimeRangeParams {
  collector: GitCollector
  path: string
  options: AnalyzeOptions
  debug?: boolean
}

async function resolveTimeRange({
  collector,
  path,
  options,
}: ResolveTimeRangeParams): Promise<{ since?: string; until?: string; mode: TimeRangeMode; note?: string }> {
  if (options.allTime) {
    // --all-time 时不传 since 和 until，让 git 返回所有数据
    return {
      mode: 'all-time',
    }
  }

  // 处理 --days 参数
  if (options.days) {
    const daysNum = typeof options.days === 'string' ? parseInt(options.days, 10) : options.days
    const daysRange = calculateDaysRange(daysNum)
    if (daysRange) {
      return {
        since: daysRange.since,
        until: daysRange.until,
        mode: 'custom',
        note: daysRange.note,
      }
    }
  }

  // 处理 --year 参数
  if (options.year) {
    const yearRange = parseYearOption(options.year)
    if (yearRange) {
      return {
        since: yearRange.since,
        until: yearRange.until,
        mode: 'custom',
        note: yearRange.note,
      }
    }
  }

  if (options.since || options.until) {
    const fallback = calculateTimeRange(false)
    return {
      since: options.since || fallback.since,
      until: options.until || fallback.until,
      mode: 'custom',
    }
  }

  const baseOptions = {
    path,
  }

  try {
    const lastCommitDate = await collector.getLastCommitDate(baseOptions)
    if (lastCommitDate) {
      const untilDate = toUTCDate(lastCommitDate)
      const sinceDate = new Date(untilDate.getTime())
      sinceDate.setUTCDate(sinceDate.getUTCDate() - 365)

      const baseline = Date.UTC(1970, 0, 1)
      if (sinceDate.getTime() < baseline) {
        sinceDate.setTime(baseline)
      }

      return {
        since: formatUTCDate(sinceDate),
        until: formatUTCDate(untilDate),
        mode: 'auto-last-commit',
        note: '以最后一次提交为基准回溯365天',
      }
    }
  } catch {}

  const fallback = calculateTimeRange(false)
  return {
    since: fallback.since,
    until: fallback.until,
    mode: 'fallback',
  }
}

/**
 * 当启用 --self 时解析当前 Git 用户的信息，生成作者过滤正则
 */
async function resolveAuthorFilter(collector: GitCollector, path: string): Promise<AuthorFilterInfo> {
  const authorInfo = await collector.resolveSelfAuthor(path)
  return {
    pattern: authorInfo.pattern,
    displayLabel: authorInfo.displayLabel,
  }
}

function toUTCDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map((value) => parseInt(value, 10))
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1))
}

function formatUTCDate(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** 输出核心结果、时间分布与统计信息 */
function printResults(
  result: Result996,
  parsedData: ParsedGitData,
  rawData: GitLogData,
  options: AnalyzeOptions,
  since?: string,
  until?: string,
  rangeMode?: TimeRangeMode
): void {
  printCoreResults(result, rawData, options, since, until, rangeMode)
  printDetailedAnalysis(result, parsedData) // 新增：详细分析
  printWorkTimeSummary(parsedData)
  printTimeDistribution(parsedData)
  printWeekdayOvertime(parsedData)
  printWeekendOvertime(parsedData)
  printLateNightAnalysis(parsedData)
  printRecommendation(result, parsedData)
}
