import chalk from 'chalk'
import Table from 'cli-table3'
import { AuthorRankingResult, AuthorStats } from '../../../types/git-types'
import { RankingOptions } from '../ranking'

/**
 * 打印作者排名结果
 */
export function printAuthorRanking(result: AuthorRankingResult, options: RankingOptions): void {
  const { authors, totalAuthors, timeRange } = result

  // 根据排序方式调整标题
  const sortBy = options.sortBy || 'score';
  let sortByText = '';
  switch (sortBy) {
    case 'index':
      sortByText = ' (按996指数)';
      break;
    case 'overtime':
      sortByText = ' (按加班次数)';
      break;
    case 'commits':
      sortByText = ' (按总提交数)';
      break;
    case 'score':
      sortByText = ' (按综合得分)';
      break;
    default:
      sortByText = ' (按综合得分)';
  }

  // 打印标题
  console.log(chalk.bold.hex('#D72654')(`\n🏆 ============ 卷王排行榜${sortByText} ============ 🏆\n`))

  // 如果指定了单个作者，显示详细信息
  if (options.author && authors.length === 1) {
    printSingleAuthorDetail(authors[0])
    return
  }

  // 根据排序方式调整表头
  let tableHeaders = [
    chalk.cyan('排名'),
    chalk.cyan('作者'),
    chalk.cyan('邮箱'),
  ];
  
  // 根据排序方式调整主要列标题
  switch (sortBy) {
    case 'overtime':
      tableHeaders.push(chalk.cyan('加班数'));
      break;
    case 'commits':
      tableHeaders.push(chalk.cyan('提交数'));
      break;
    case 'index':
    case 'score':
    default:
      tableHeaders.push(chalk.cyan('提交数'));
      break;
  }
  
  // 添加其他指标列
  tableHeaders.push(
    chalk.cyan('996指数'),
    chalk.cyan('加班率'),
    chalk.cyan('周末提交'),
  );
  
  // 创建表格
  const table = new Table({
    head: tableHeaders,
    colWidths: [8, 20, 30, 12, 12, 12, 12],
    wordWrap: true,
  })

  // 填充表格数据
  authors.forEach((author, index) => {
    const rank = index + 1
    const rankEmoji = getRankEmoji(rank)
  // overTimeRadio 已经是百分比整数或小数（例如 8 表示 8%），无需再次乘 100
  const percentOvertime = author.overTimeRadio.toFixed(1) + '%'
    const weekendPercent = ((author.weekendCommits / author.totalCommits) * 100).toFixed(1) + '%'

    // 根据996指数着色
    const index996Color = getIndex996Color(author.index996)

    // 根据排序方式调整数据列
    let dataRow = [
      `${rankEmoji} ${rank}`,
      truncateString(author.name, 18),
      truncateString(author.email, 28),
    ];
    
    switch (sortBy) {
      case 'overtime':
        dataRow.push(author.overtimeCommits.toString()); // 显示加班数
        break;
      case 'commits':
      case 'index':
      case 'score':
      default:
        dataRow.push(author.totalCommits.toString()); // 显示提交数
        break;
    }
    
    dataRow.push(
      chalk.hex(index996Color)(author.index996.toFixed(1)),
      percentOvertime,
      weekendPercent,
    );

    table.push(dataRow);
  })

  console.log(table.toString())
  console.log()

  // 打印统计摘要
  printSummary(result, sortByText)

  // 打印说明
  printLegend(sortBy)
}

/**
 * 打印单个作者的详细信息
 */
function printSingleAuthorDetail(author: AuthorStats): void {
  console.log(chalk.bold('📊 作者详细信息\n'))

  const details = [
    ['作者名字', author.name],
    ['邮箱地址', author.email],
    ['总提交数', author.totalCommits],
    ['996指数', `${chalk.hex(getIndex996Color(author.index996))(author.index996.toFixed(1))} (${author.index996Str})`],
  ['加班率', `${author.overTimeRadio.toFixed(1)}%`],
    ['工作时间提交', author.workingHourCommits],
    ['加班时间提交', author.overtimeCommits],
    ['工作日提交', author.weekdayCommits],
    ['周末提交', `${author.weekendCommits} (${((author.weekendCommits / author.totalCommits) * 100).toFixed(1)}%)`],
  ]

  const table = new Table({
    colWidths: [20, 50],
  })

  details.forEach(([key, value]) => {
    table.push([chalk.cyan(key), value])
  })

  console.log(table.toString())
  console.log()
}

/**
 * 打印统计摘要
 */
function printSummary(result: AuthorRankingResult, sortByText: string = ''): void {
  const { authors } = result

  const totalCommits = authors.reduce((sum, a) => sum + a.totalCommits, 0)
  const avgIndex996 = authors.reduce((sum, a) => sum + a.index996, 0) / authors.length
  const maxIndex996 = Math.max(...authors.map((a) => a.index996))
  const minIndex996 = Math.min(...authors.map((a) => a.index996))
  
  // 根据排序方式显示不同的统计信息
  console.log(chalk.bold(`📈 统计摘要${sortByText}`))
  console.log(chalk.gray('─'.repeat(60)))
  console.log(`  总提交者数量: ${chalk.yellow(authors.length)}`)
  console.log(`  总提交数: ${chalk.yellow(totalCommits)}`)
  console.log(`  平均996指数: ${chalk.yellow(avgIndex996.toFixed(2))}`)
  console.log(`  最高996指数: ${chalk.red(maxIndex996.toFixed(2))} (${getAuthorByField(authors, 'index996', 'max')?.name})`)
  console.log(`  最低996指数: ${chalk.green(minIndex996.toFixed(2))} (${getAuthorByField(authors, 'index996', 'min')?.name})`)
  console.log()
}

/**
 * 根据指定字段获取作者（最大值或最小值）
 */
function getAuthorByField(authors: AuthorStats[], field: keyof AuthorStats, type: 'max' | 'min'): AuthorStats | undefined {
  if (authors.length === 0) return undefined;
  
  let targetAuthor = authors[0];
  let targetValue = authors[0][field] as number;
  
  for (const author of authors) {
    const value = author[field] as number;
    if (type === 'max' && value > targetValue) {
      targetValue = value;
      targetAuthor = author;
    } else if (type === 'min' && value < targetValue) {
      targetValue = value;
      targetAuthor = author;
    }
  }
  
  return targetAuthor;
}

/**
 * 打印图例说明
 */
function printLegend(sortBy: 'index' | 'overtime' | 'commits' | 'score'): void {
  console.log(chalk.bold('📖 指标说明'))
  console.log(chalk.gray('─'.repeat(60)))
  console.log('  • 996指数: 综合工作强度指标，数值越高表示加班越严重')
  console.log('  • 加班率: 非工作时间提交占总提交的比例')
  console.log('  • 周末提交: 周末提交占总提交的比例')
  
  // 根据排序方式显示不同提示
  let sortHint = '';
  switch (sortBy) {
    case 'index':
      sortHint = '当前按996指数（加班比例）排序';
      break;
    case 'overtime':
      sortHint = '当前按加班绝对次数排序';
      break;
    case 'commits':
      sortHint = '当前按总提交数排序';
      break;
    case 'score':
    default:
      sortHint = '当前按综合得分排序（平衡加班比例和绝对数量）';
      break;
  }
  console.log(`  • ${sortHint}`)
  console.log()
  console.log(chalk.yellow('💡 提示: 使用 --author <名字> 查看指定作者详情'))
  console.log(chalk.yellow('💡 提示: 使用 --exclude-authors <名字1>,<名字2> 排除机器人'))
  console.log(chalk.yellow(`💡 提示: 使用 --by [index|overtime|commits|score] 选择排序方式`))
  console.log()
}

/**
 * 获取排名 emoji
 */
function getRankEmoji(rank: number): string {
  if (rank === 1) return '🥇'
  if (rank === 2) return '🥈'
  if (rank === 3) return '🥉'
  return '  '
}

/**
 * 根据996指数获取颜色
 */
function getIndex996Color(index: number): string {
  if (index >= 80) return '#FF0000' // 深红 - 非常严重
  if (index >= 60) return '#FF6B6B' // 红色 - 严重
  if (index >= 40) return '#FFA500' // 橙色 - 中等
  if (index >= 20) return '#FFD700' // 金色 - 轻度
  return '#90EE90' // 绿色 - 正常
}

/**
 * 截断字符串
 */
function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.substring(0, maxLength - 3) + '...'
}
