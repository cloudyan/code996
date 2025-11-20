import chalk from 'chalk'
import ora from 'ora'
import dayjs from '../../utils/dayjs'
import { GitCollector } from '../../git/git-collector'
import { GitParser } from '../../git/git-parser'
import { AnalyzeOptions } from '../index'
import { buildAuthorFilter } from '../common/author-filter'
import { GitLogOptions, AuthorStats, AuthorRankingResult } from '../../types/git-types'
import { ensureCommitSamples } from '../common/commit-guard'
import { printAuthorRanking } from './report/ranking-printer'
import { resolveTimeRange } from '../common/time-range'

export interface RankingOptions extends AnalyzeOptions {
  author?: string // 指定统计某个作者
  excludeAuthors?: string // 排除某些作者（逗号分隔）
  merge?: boolean // 合并同名不同邮箱的作者
  sortBy?: 'index' | 'overtime' | 'commits' | 'score' // 排序方式
}

/**
 * 排名执行器，负责统计所有提交者的996指数并排序
 */
export class RankingExecutor {
  /**
   * 执行排名分析的主流程
   */
  static async execute(path: string, options: RankingOptions): Promise<void> {
    try {
      const collector = new GitCollector()

      // 计算时间范围（复用 analyze 命令的逻辑）
      const { since: effectiveSince, until: effectiveUntil } = await resolveTimeRange(collector, path, options)

      console.log(chalk.blue('🔍 分析仓库:'), path || process.cwd())
      if (effectiveSince && effectiveUntil) {
        console.log(chalk.blue('📅 时间范围:'), `${effectiveSince} 至 ${effectiveUntil}`)
      } else {
        console.log(chalk.blue('📅 时间范围:'), '所有时间')
      }

      // 处理排除作者列表
      const excludeList = options.excludeAuthors ? options.excludeAuthors.split(',').map((a) => a.trim()) : []
      if (excludeList.length > 0) {
        console.log(chalk.blue('🚫 排除作者:'), excludeList.join(', '))
      }

      // 处理指定作者
      if (options.author) {
        console.log(chalk.blue('👤 指定作者:'), options.author)
      }

      console.log()

      // 构建基础的 Git 采集参数
      const collectOptions: GitLogOptions = {
        path,
        since: effectiveSince,
        until: effectiveUntil,
        silent: false,
        authorPattern: undefined,
      }

      // 检查 commit 样本量
      const hasEnoughCommits = await ensureCommitSamples(collector, collectOptions, 20, '排名分析')
      if (!hasEnoughCommits) {
        return
      }

      // 创建进度指示器
      const spinner = ora('📦 获取所有提交者...').start()

      // 使用通用过滤模块获得匹配的作者正则并信息
      let authorPattern: string | undefined
      let allAuthors = await collector.getAllAuthors(collectOptions)
      try {
        const built = await buildAuthorFilter(collector, path, effectiveSince, effectiveUntil, options)
        authorPattern = built.pattern
        built.infoLines.forEach((l) => console.log(l))
        if (built.infoLines.length) console.log()
        // 若构建后的 pattern 对应的是一组作者，则我们将 allAuthors 缩减为匹配集合用于单独统计
        if (authorPattern) {
          const regex = new RegExp(authorPattern, 'i')
          allAuthors = allAuthors.filter((a) => regex.test(a.email) || regex.test(a.name))
        }
      } catch (e) {
        spinner.fail(`作者过滤失败: ${(e as Error).message}`)
        return
      }

      if (allAuthors.length === 0) {
        spinner.fail('作者过滤后无提交者')
        return
      }

      spinner.text = `匹配到 ${allAuthors.length} 位提交者，正在分析...`
      spinner.render()

      // 如果启用合并，先构建合并映射表
      let mergeMap: Map<string, { name: string; email: string }> | undefined
      if (options.merge) {
        const { AuthorMerger } = await import('../../core/author-merger')
        const merger = new AuthorMerger()
        mergeMap = merger.getMergeMap(allAuthors.map((a) => ({ name: a.name, email: a.email })))

        if (mergeMap.size > 0) {
          console.log(chalk.blue('🔄 启用作者合并:'), `将合并 ${mergeMap.size} 个身份`)
        }
      }

      // 并行分析每个作者的数据
      const authorStatsPromises = allAuthors.map(async (author) => {
        try {
          // 收集作者数据
          const rawData = await collector.collectForAuthor(collectOptions, author)

          // 如果提交数太少，跳过该作者
          if (rawData.totalCommits < 5) {
            return null
          }

          // 解析数据
          const parsedData = GitParser.parseGitData(rawData, undefined, effectiveSince, effectiveUntil)

          // 计算 996 指数
          const result = GitParser.calculate996Index(parsedData)

          const stats: AuthorStats = {
            name: author.name,
            email: author.email,
            totalCommits: rawData.totalCommits,
            index996: result.index996,
            index996Str: result.index996Str,
            overTimeRadio: result.overTimeRadio,
            workingHourCommits: parsedData.workHourPl[0].count,
            overtimeCommits: parsedData.workHourPl[1].count,
            weekdayCommits: parsedData.workWeekPl[0].count,
            weekendCommits: parsedData.workWeekPl[1].count,
          }

          return stats
        } catch (error) {
          // 如果某个作者分析失败，记录但不中断整体流程
          console.warn(chalk.yellow(`\n⚠️  无法分析作者 ${author.name}: ${(error as Error).message}`))
          return null
        }
      })

      const authorStatsResults = await Promise.all(authorStatsPromises)
      let authorStats = authorStatsResults.filter((stats): stats is AuthorStats => stats !== null)

      if (authorStats.length === 0) {
        spinner.fail('没有可分析的提交者数据')
        return
      }

      // 如果启用合并，合并同名作者的统计数据
      if (options.merge && mergeMap && mergeMap.size > 0) {
        authorStats = mergeAuthorStats(authorStats, mergeMap)
        console.log(chalk.green(`✓ 已合并，最终作者数: ${authorStats.length}`))
      }

      // 按指定方式排序（卷王排行）
      const sortBy = options.sortBy || 'score'; // 默认使用综合得分排序
      
      authorStats.sort((a, b) => {
        switch (sortBy) {
          case 'index': // 按996指数排序
            return b.index996 - a.index996;
          case 'overtime': // 按加班绝对次数排序
            return b.overtimeCommits - a.overtimeCommits;
          case 'commits': // 按总提交数排序
            return b.totalCommits - a.totalCommits;
          case 'score': // 按综合得分排序
          default:
            const scoreA = calculateRankingScore(a);
            const scoreB = calculateRankingScore(b);
            return scoreB - scoreA;
        }
      });

      // 计算排名综合得分
      function calculateRankingScore(stats: AuthorStats): number {
        // 如果996指数为负值（工作不饱和），直接返回负值
        if (stats.index996 < 0) {
          return stats.index996;
        }
        
        // 基础得分：996指数 * 样本量调整因子
        const commitCountFactor = Math.min(1, Math.log10(Math.max(1, stats.totalCommits)) / 2);
        const baseScore = stats.index996 * commitCountFactor;
        
        // 加班绝对次数权重
        const overtimeWeight = Math.min(stats.overtimeCommits, 50) / 5;
        
        return baseScore + overtimeWeight;
      }

      spinner.succeed('分析完成！')
      console.log()

      // 构建排名结果
      const rankingResult: AuthorRankingResult = {
        authors: authorStats,
        totalAuthors: authorStats.length,
        timeRange: {
          since: effectiveSince,
          until: effectiveUntil,
        },
      }

      // 打印排名结果
      printAuthorRanking(rankingResult, options)
    } catch (error) {
      console.error(chalk.red('❌ 排名分析失败:'), (error as Error).message)
      process.exit(1)
    }
  }
}

/**
 * 合并同名作者的统计数据
 */
function mergeAuthorStats(
  stats: AuthorStats[],
  mergeMap: Map<string, { name: string; email: string }>
): AuthorStats[] {
  const merged = new Map<string, AuthorStats>()

  for (const stat of stats) {
    // 查找是否需要合并到另一个主身份
    const primaryIdentity = mergeMap.get(stat.email.toLowerCase())
    const targetEmail = primaryIdentity ? primaryIdentity.email : stat.email
    const targetName = primaryIdentity ? primaryIdentity.name : stat.name

    const existing = merged.get(targetEmail.toLowerCase())

    if (existing) {
      // 合并到已有统计
      existing.totalCommits += stat.totalCommits
      existing.workingHourCommits += stat.workingHourCommits
      existing.overtimeCommits += stat.overtimeCommits
      existing.weekdayCommits += stat.weekdayCommits
      existing.weekendCommits += stat.weekendCommits

      // 重新计算 996 指数（加权平均）
      const totalCommits = existing.totalCommits
      existing.index996 =
        (existing.index996 * (totalCommits - stat.totalCommits) + stat.index996 * stat.totalCommits) / totalCommits
      existing.index996Str = existing.index996.toFixed(2)

      // 重新计算加班占比，保持与 calculate996Index 相同的百分比逻辑（包含周末修正）
      const y = existing.workingHourCommits // 工作时间提交
      const x = existing.overtimeCommits // 加班时间提交
      const m = existing.weekdayCommits // 工作日提交数
      const n = existing.weekendCommits // 周末提交数
      if (m + n > 0 && y + x > 0) {
        const overTimeAmendCount = Math.round(x + (y * n) / (m + n))
        existing.overTimeRadio = Math.ceil((overTimeAmendCount / (y + x)) * 100) // 百分比数值（与其他路径统一）
      }
    } else {
      // 新增统计（使用主身份的名称和邮箱）
      merged.set(targetEmail.toLowerCase(), {
        ...stat,
        name: targetName,
        email: targetEmail,
      })
    }
  }

  return Array.from(merged.values())
}


