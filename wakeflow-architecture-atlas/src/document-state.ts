/** Shared reader vocabulary. A document label never certifies product acceptance. */
export type TruthKind = 'current-code' | 'in-progress-worktree' | 'stale' | 'historical' | 'target-design';
export function statusLabel(kind: string | undefined): string {
  switch (kind) {
    case 'current-code': return '当前';
    case 'in-progress-worktree': return '进行中';
    case 'stale': return '待复核';
    case 'historical': return '历史';
    case 'target-design': return '目标设计';
    case undefined: return '指南';
    default: return '未核验';
  }
}
export function statusClass(kind: string | undefined): string {
  switch (kind) {
    case 'current-code': return 'status-current';
    case 'in-progress-worktree': return 'status-progress';
    case 'historical': case 'target-design': case undefined: return 'status-guide';
    default: return 'status-stale';
  }
}
/** The mapping table owns full file identity; repeated service.ts labels are presentation only. */
export function fileNodePaths(body: string): Readonly<Record<string, string>> {
  const paths: Record<string, string> = {};
  for (const m of body.matchAll(/^\|\s*([A-Za-z][A-Za-z0-9_]*)\s*\|\s*`(src\/[^`#]+\.ts)(?:#[^`]+)?`\s*\|/gmu)) {
    if (m[1] && m[2]) paths[m[1]] = m[2];
  }
  return paths;
}
export const GROUP_LABELS: Readonly<Record<string, string>> = {
  '根目录': '标准与总览',
  'plans': '更新记录与历史计划',
  '01-overall-architecture': '总体架构',
  '02-foundation': '基础原语',
  '03-configuration-workspace': '配置与工作区',
  '04-governance-event-sourcing': 'Demand 与事件流',
  '05-tasking-slice': '任务规划',
  '06-implementation-delivery-review': '投递与结果',
  '07-review-rework-completion': '评审与生命周期',
  '08-real-environment-testing': '测试合同与证据',
  '09-public-mcp-host-seams': '公共工具与宿主',
  '10-end-to-end-business-flow': '业务主线与状态',
  '11-kernel': '应用内核',
  '12-endpoint': '执行端点',
  '13-requirement': '需求包与看板',
  '14-evidence': '受管证据',
  '15-pod': 'Pod 执行环境',
};
