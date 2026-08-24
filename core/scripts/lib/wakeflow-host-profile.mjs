/**
 * Wakeflow 开发态宿主画像。
 *
 * 职责导航：
 * 1. 只为从 core/ 直接运行的仓库开发脚本提供 Codex 宿主事实。
 * 2. 插件产物各自维护真实宿主画像；sync-core 刻意不复制本文件。
 * 3. 画像只声明共享代码已有消费者的身份、能力、工具和产物接缝。
 * 4. 整棵对象在导出前冻结，避免同一进程中的调用者改写全局宿主事实。
 */

// 画像包含多层数组和对象，浅冻结不足以保护 capability 与 artifact 子树。
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const hostProfile = deepFreeze({
  // 协议身份与运行目录是两个独立字段；共享代码不得从其中一个反推另一个。
  hostId: "codex",
  hostName: "Codex",
  runtime: {
    hostDirName: "codex",
  },
  fleet: { transport: "agent-tools" },

  // capability 只描述适用性和当前实现状态，不承载宿主执行函数。
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

  // 共享初始化只消费创建窗口工具；重命名和投递由各自宿主执行路径负责。
  memoryFile: "AGENTS.md",
  pluginManifestPath: ".codex-plugin/plugin.json",
  hostTools: {
    createWindow: "create_thread",
  },

  // handleId 仅负责已登记窗口句柄的种类、占位符拒绝集和机器形状校验。
  handleId: {
    kind: "codex-thread",
    placeholders: ["current-codex-thread", "current thread", "<thread id>", "unknown", ""],
    idShape: "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
  },

  // artifact 只登记当前验证器或宿主 adapter loader 真正读取的产物事实。
  artifact: {
    packageName: "wakeflow-core-dev",
    podMaterializationHostFile: null,
    decommissionHostFile: null,
    migrationDecommissionHostFile: null,
    migrationEffectHostFile: null,
    activationScopeHostFile: null,
    packagedEntries: [],
  },
});
