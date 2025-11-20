import chalk from 'chalk'
import ora from 'ora'
import dayjs from '../../utils/dayjs'
import { GitCollector } from '../../git/git-collector'
import { TrendAnalyzer } from '../../core/trend-analyzer'
import { printTrendReport } from './report/trend-printer'
import { AnalyzeOptions } from '../index'
import { buildAuthorFilter } from '../common/author-filter'
import { calculateTimeRange } from '../../utils/terminal'
import { GitLogOptions } from '../../types/git-types'
import { ensureCommitSamples } from '../common/commit-guard'
import { resolveTimeRange as resolveTimeRangeCommon, parseYearOption } from '../common/time-range'

/**
 * 趋势分析命令执行器
 */
export class TrendExecutor {
  /**
   * 执行趋势分析
   */
  static async execute(path: string, options: AnalyzeOptions): Promise<void> {
    try {
      const collector = new GitCollector()

      // 计算时间范围
      const { since, until } = await this.resolveTimeRange(collector, path, options)

      // 显示分析开始信息
      console.log(chalk.blue('🔍 趋势分析仓库:'), path || process.cwd())
      console.log(chalk.blue('📅 时间范围:'), `${since} 至 ${until}`)
      console.log()

      // 作者过滤（统一处理 self/author/exclude-authors）
      let authorPattern: string | undefined
      try {
        const built = await buildAuthorFilter(collector, path, since, until, options)
        authorPattern = built.pattern
        built.infoLines.forEach((l) => console.log(l))
        if (built.infoLines.length) console.log()
      } catch (e) {
        console.error(chalk.red('❌ 作者过滤失败:'), (e as Error).message)
        process.exit(1)
      }

      // 构造采样参数，确保 commit 过滤条件与趋势统计一致
      const collectOptions: GitLogOptions = {
        path,
        since,
        until,
        authorPattern,
        silent: false,
      }

      // 趋势分析同样需要足够的样本量
      const hasEnoughCommits = await ensureCommitSamples(collector, collectOptions, 20, '趋势分析')
      if (!hasEnoughCommits) {
        return
      }

      // 创建进度指示器
      const spinner = ora('📦 开始月度趋势分析...').start()

      // 执行趋势分析
      const trendResult = await TrendAnalyzer.analyzeTrend(path, since, until, authorPattern)

      spinner.succeed('趋势分析完成！')

      // 输出趋势报告
      printTrendReport(trendResult)
    } catch (error) {
      console.error(chalk.red('❌ 趋势分析失败:'), (error as Error).message)
      process.exit(1)
    }
  }

  /**
   * 解析时间范围
   */
  private static async resolveTimeRange(
    collector: GitCollector,
    path: string,
    options: AnalyzeOptions
  ): Promise<{ since: string; until: string }> {
    // 使用通用的时间范围解析函数
    const result = await resolveTimeRangeCommon(collector, path, options);
    
    // 确保返回值包含必须的 since 和 until
    if (result.mode === 'all-time') {
      // 全时间范围需要获取仓库的实际首尾提交时间
      const baseOpts: GitLogOptions = { path, since: '1970-01-01', until: '2100-01-01', silent: true, authorPattern: undefined }
      const firstCommit = await collector.getFirstCommitDate(baseOpts)
      const lastCommit = await collector.getLastCommitDate(baseOpts)

      if (!firstCommit || !lastCommit) {
        throw new Error('无法获取仓库的提交历史时间范围')
      }

      return {
        since: firstCommit,
        until: lastCommit,
      }
    }
    
    // 对于其他情况，如果 since 和 until 存在则直接返回，否则使用默认值
    if (result.since && result.until) {
      return {
        since: result.since,
        until: result.until,
      };
    } else {
      // 默认最近一年
      const until = dayjs();
      const since = until.subtract(1, 'year');
      return {
        since: since.format('YYYY-MM-DD'),
        until: until.format('YYYY-MM-DD'),
      };
    }
  }


}
