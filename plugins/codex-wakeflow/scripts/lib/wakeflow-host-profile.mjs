/**
 * Codex 插件的宿主画像。
 *
 * 职责导航：
 * 1. 向共享核心声明 Codex 的协议身份、运行目录与能力现状。
 * 2. 登记共享初始化所需的原生建窗工具和窗口句柄合同。
 * 3. 登记验证器与宿主 adapter loader 消费的插件产物路径。
 * 4. 不实现宿主动作，也不保存 workspace、窗口或迁移运行状态。
 *
 * 共享核心可以读取这些值，但不得通过 hostId 分支重建宿主行为。
 */

// 画像是进程级静态事实；递归冻结阻止调用者改写嵌套能力或产物路径。
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const hostProfile = deepFreeze({
  // 协议身份与运行目录分别声明，避免共享代码隐式耦合两套词汇。
  hostId: "codex",
  hostName: "Codex",
  runtime: {
    hostDirName: "codex",
  },
  fleet: { transport: "agent-tools" },

  // capability 是宿主中立的适用性合同；物理实现继续留在 Codex owner 中。
  capabilities: {
    identity: { applicable: true, realization: "current" },
    pod: { applicable: true, realization: "current" },
    keepLive: { applicable: true, realization: "runtime-probed" },
    locator: { applicable: false, realization: "not-applicable" },
    settings: {
      applicable: false,
      realization: "not-applicable",
      paths: { portable: null, local: null },
    },
    assets: {
      applicable: false,
      realization: "not-applicable",
      statuslineFileName: null,
    },
    activity: { applicable: false, realization: "not-applicable" },
    temp: { applicable: false, realization: "not-applicable" },
    close: { applicable: true, realization: "manual-gate" },
    revoke: { applicable: true, realization: "manual-gate" },
    activation: { applicable: true, realization: "runtime-probed" },
  },

  // 共享初始化当前只消费 createWindow；其他宿主动作不通过画像间接调度。
  memoryFile: "AGENTS.md",
  pluginManifestPath: ".codex-plugin/plugin.json",
  hostTools: {
    createWindow: "create_thread",
  },

  // handleId 为窗口绑定提供确定性拒绝和形状校验，不保存任何真实 thread ID。
  handleId: {
    kind: "codex-thread",
    placeholders: ["current-codex-thread", "current thread", "<thread id>", "unknown", ""],
    idShape: "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
  },

  // artifact 是静态包装与宿主接缝清单，不是全局插件注册表。
  artifact: {
    packageName: "wakeflow",
    podMaterializationHostFile: "scripts/lib/wakeflow-codex-pod-host.mjs",
    decommissionHostFile: "scripts/lib/wakeflow-codex-decommission.mjs",
    migrationDecommissionHostFile: "scripts/lib/wakeflow-codex-migration-decommission.mjs",
    migrationEffectHostFile: "scripts/lib/wakeflow-codex-migration-effect.mjs",
    activationScopeHostFile: "scripts/lib/wakeflow-codex-activation-scope.mjs",
    packagedEntries: [".codex-plugin/", ".mcp.json", "README.zh-CN.md", "mcp/", "schemas/", "skills/", "scripts/", "templates/"],
  },
});
