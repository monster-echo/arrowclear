/**
 * 全关卡指标总表：链接深度（拓扑剥洋葱层数）/ 四维评分 / 开局可释放根数。
 * 运行：npm run table:levels（见 package.json）或
 *   esbuild tools/level-table.ts --bundle --platform=node --format=esm --outfile=.tmp/table.mjs && node .tmp/table.mjs
 * 输出：docs/11-关卡指标总表.md
 */
import { writeFileSync } from 'fs';
import {
  LEVEL_COUNT,
  chapterOf,
  getLevel,
  getLevelParts,
  isBoss,
  worldOf,
} from '../assets/scripts/core/levels';
import { MasterReport } from '../assets/scripts/core/arrowscore';
import { Level } from '../assets/scripts/core/types';

type LevelWithReport = Level & { report?: MasterReport };

interface Row {
  label: string;
  id: number;
  world: number;
  chapter: number;
  mode: string;
  shape: string;
  board: string;
  arrows: number;
  depth: number;
  score: number;
  tier: string;
  movable: number;
  empty: number;
  time: number;
  /** 五维拆分：箭量丰度/形态跨度/反斑马/回字包络/拓扑向心。 */
  subs: string;
  density: number;
  gate: number;
  passes: boolean;
}

function rowFor(level: LevelWithReport, label: string): Row {
  const report = level.report;
  return {
    label,
    id: level.id,
    world: worldOf(level.id),
    chapter: chapterOf(level.id),
    mode: level.mode ?? 'normal',
    shape: level.shape ?? 'board',
    board: `${level.cols}×${level.rows}`,
    arrows: level.arrows.length,
    depth: report ? report.maxChainDepth : -1,
    score: report ? report.totalScore : -1,
    tier: report ? report.difficultyTier : '--',
    movable: freeAtStartCount(level),
    empty: report ? report.emptyCells : -1,
    time: level.timeLimit,
    subs: report
      ? `${report.subScores.abundance}/${report.subScores.hierarchy}/${report.subScores.antiZebra}/${report.subScores.cavity}/${report.subScores.topo}`
      : '--',
    density: report ? report.density : 0,
    gate: report ? report.gate : 0,
    passes: report ? report.passes : false,
  };
}

const rows: Row[] = [];
for (let id = 1; id <= LEVEL_COUNT; id++) {
  if (isBoss(id) && worldOf(id) >= 2) {
    getLevelParts(id).forEach((part, i) => {
      rows.push(rowFor(part as LevelWithReport, `${id}·${i + 1}/3`));
    });
  } else {
    rows.push(rowFor(getLevel(id) as LevelWithReport, String(id)));
  }
}
rows.push(rowFor(getLevel(501) as LevelWithReport, '501★'));

// ---- 汇总统计 ----
const scored = rows.filter((r) => r.score >= 0);
const notPass = rows.filter((r) => !r.passes);
const minArrows = Math.min(...rows.map((r) => r.arrows));
const tiers = { S: 0, A: 0, B: 0 } as Record<string, number>;
for (const r of scored) {
  if (r.score >= 85) tiers.S++;
  else if (r.score >= 75) tiers.A++;
  else tiers.B++;
}
const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const depthAll = scored.map((r) => r.depth);
const scoreAll = scored.map((r) => r.score);
const movableAll = rows.map((r) => r.movable);
const worst10 = [...scored].sort((a, b) => a.score - b.score).slice(0, 10);

const head = `# 11 · 全关卡指标总表

> 由《四阶段多尺度巨蟒包络》生成器 + 五维质量评分器自动产出。
> **评分标准（0~100）**：
>
> | 维度 | 权重 | 口径 |
> | --- | --- | --- |
> | 箭量丰度 | 25 | 绝对箭数（每 8 箭 1 分，封顶 16）+ 密度（0.15 箭/格满档，9 分） |
> | 形态跨度 | 20 | 巨蟒（≥12 格）数量 + 长度标准差 + 平均长度，惩罚碎短箭 |
> | 反斑马线 | 20 | 相邻异箭同向平行的比例；满铺基准 30% 为满分线，55% 为零点 |
> | 回字包络 | 10 | 大箭包围内部箭形成的嵌套腔体数量与包围格数 |
> | 拓扑向心 | 25 | 剥洋葱深度 + 外圈向心率 + 开局可动箭数收敛 |
> | 空格惩罚 | −0~20 | 按填充率计：≥99% 不罚，越稀疏扣越多 |
>
> **等级**：≥85 S级 · ≥75 A级 · ≥65 B级 · 其余 C级（不允许出现）。
> **达标线**（硬门禁，低于此分自动换种子重摇）：大盘 70 / 中盘 68 / 小盘 60。
>
> - **链深** = 拓扑剥洋葱层数（解开整盘所需的波数，越深越烧脑）
> - **可释放** = 开局即可点击飞出的箭数（Boss 可飞则计）
> - **密度** = 箭数 / 可放格数
>
> 总计 ${rows.length} 个盘面（主线 500 关 + Boss 三连打部件 + 彩蛋 501）。
> S/A/B 分布：**S ${tiers.S} · A ${tiers.A} · B ${tiers.B}**；
> 平均链深 **${avg(depthAll).toFixed(1)}**（最深 ${Math.max(...depthAll, 0)}），
> 平均评分 **${avg(scoreAll).toFixed(1)}**，
> 平均开局可释放 **${avg(movableAll).toFixed(1)}** 根；
> 箭量最少 **${minArrows}** 支、平均 **${avg(rows.map((r) => r.arrows)).toFixed(0)}** 支；
> 未达标盘面 **${notPass.length}** 个（达标线按盘面规模：大盘 70 / 中盘 68 / 小盘 60）。

## 评分最低的 10 个盘面（优先重制候选）

| 关 | 评分 | 等级 | 链深 | 可释放 | 箭数 | 空格 |
| --- | --- | --- | --- | --- | --- | --- |
${worst10.map((r) => `| ${r.label} | ${r.score} | ${r.tier.slice(0, 1)} | ${r.depth} | ${r.movable} | ${r.arrows} | ${r.empty} |`).join('\n')}

## 全量明细
`;

const lines: string[] = [
  '| 关 | 章 | 模式 | 形态 | 盘面 | 箭数 | 密度 | 链深 | 评分 | 达标线 | 达标 | 等级 | 五维(量/跨/斑/腔/拓) | 可释放 | 空格 | 限时 |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
];
for (const r of rows) {
  lines.push(
    `| ${r.label} | ${r.chapter} | ${r.mode} | ${r.shape} | ${r.board} | ${r.arrows} | ${r.density.toFixed(3)} | ${r.depth} | ${r.score} | ${r.gate} | ${r.passes ? '✓' : '✗'} | ${r.tier.slice(0, 1)} | ${r.subs} | ${r.movable} | ${r.empty} | ${r.time === 0 ? '∞' : `${r.time}s`} |`,
  );
}

const md = head + lines.join('\n') + '\n';
writeFileSync('docs/11-关卡指标总表.md', md);

// 控制台摘要
console.log(
  `总计 ${rows.length} 盘面 | S ${tiers.S} / A ${tiers.A} / B ${tiers.B} | 平均链深 ${avg(depthAll).toFixed(1)} | 平均评分 ${avg(scoreAll).toFixed(1)} | 平均可释放 ${avg(movableAll).toFixed(1)}`,
);
console.log(`明细已写入 docs/11-关卡指标总表.md`);
console.log('\n前 14 行预览：');
console.log(lines.slice(0, 15).join('\n'));
