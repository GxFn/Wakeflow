import { inspectClaudeActivityForLayout } from "./wakeflow-claude-activity.mjs";
import { inspectClaudeWindowLocatorInventoryForLayout } from "./wakeflow-claude-locator.mjs";

/**
 * Claude Code 插件的宿主画像。
 *
 * 职责导航：
 * 1. 向共享核心声明 Claude Code 的协议身份、运行目录与能力现状。
 * 2. 只暴露布局观察器和启动偏好这两类有真实消费者的 Claude 扩展。
 * 3. 登记 facade、lifecycle、settings/assets 等宿主 owner 的产物路径。
 * 4. 不在画像中重建 tmux argv、语义文件名或窗口生命周期状态。
 */

// 观察器函数本身保持可调用；其所在对象和所有数据子树都不可被调用者替换。
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const hostProfile = deepFreeze({
  // 协议身份和磁盘运行目录分别声明，不能互相推导。
  hostId: "claude-code",
  hostName: "Claude Code",
  runtime: {
    hostDirName: "claude-code",
  },
  fleet: {
    transport: "host-helper",
  },

  // capability 只说明共享核心可期待什么，不接管 Claude 的物理实现。
  capabilities: {
    identity: { applicable: true, realization: "current" },
    pod: { applicable: true, realization: "current" },
    keepLive: { applicable: true, realization: "runtime-probed" },
    locator: { applicable: true, realization: "current" },
    settings: {
      applicable: true,
      realization: "current",
      paths: {
        portable: ".claude/settings.json",
        local: ".claude/settings.local.json",
      },
    },
    assets: {
      applicable: true,
      realization: "current",
      statuslineFileName: "statusline.mjs",
    },
    activity: { applicable: true, realization: "current" },
    temp: { applicable: true, realization: "current" },
    close: { applicable: true, realization: "current" },
    revoke: { applicable: true, realization: "current" },
    activation: { applicable: true, realization: "runtime-probed" },
  },

  // 共享初始化只需要统一的建窗意图；retitle 与 delivery 仍由 Claude facade 路由。
  memoryFile: "CLAUDE.md",
  pluginManifestPath: ".claude-plugin/plugin.json",
  hostTools: {
    createWindow: "wakeflow-claude-host launch-window",
  },

  // handleId 只约束登记到窗口绑定服务的真实 session ID。
  handleId: {
    kind: "claude-session",
    placeholders: [
      "current-claude-session",
      "current session",
      "<session id>",
      "current-codex-thread",
      "current thread",
      "<thread id>",
      "unknown",
      "",
    ],
    idShape: "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
  },

  // 共享布局检查只调用这两个只读观察器，不把它们升级为通用宿主管理器。
  localEventInspectors: {
    activityTemp: inspectClaudeActivityForLayout,
    locator: inspectClaudeWindowLocatorInventoryForLayout,
  },

  // 启动偏好由 Claude lifecycle 消费；角色选择仍由调用方显式传入。
  launch: {
    effortByRole: {
      controller: "max",
      design: "xhigh",
      test: "xhigh",
      product: "xhigh",
      default: "xhigh",
    },
  },

  // artifact 只登记当前包装验证和宿主 adapter 装载所需的静态路径。
  artifact: {
    packageName: "claude-code-wakeflow",
    facadeHostFile: "scripts/lib/wakeflow-claude-host.mjs",
    lifecycleHostFile: "scripts/lib/wakeflow-claude-lifecycle.mjs",
    podMaterializationHostFile: "scripts/lib/wakeflow-claude-pod-host.mjs",
    decommissionHostFile: "scripts/lib/wakeflow-claude-decommission.mjs",
    migrationDecommissionHostFile: "scripts/lib/wakeflow-claude-migration-decommission.mjs",
    migrationEffectHostFile: "scripts/lib/wakeflow-claude-migration-effect.mjs",
    activationScopeHostFile: "scripts/lib/wakeflow-claude-activation-scope.mjs",
    locatorHostFile: "scripts/lib/wakeflow-claude-locator.mjs",
    locatorSchemaFile: "schemas/wakeflow-claude-host/window-locator.schema.json",
    transportHostFile: "scripts/lib/wakeflow-claude-transport.mjs",
    settingsAssetsHostFile: "scripts/lib/wakeflow-claude-settings.mjs",
    activityHostFile: "scripts/lib/wakeflow-claude-activity.mjs",
    activityProcessSchemaFile: "schemas/wakeflow-claude-host/activity-monitor-process.schema.json",
    activityManagerLockSchemaFile: "schemas/wakeflow-claude-host/activity-monitor-manager-lock.schema.json",
    locatorFrozenPublicFiles: [
      "lib/wakeflow-mcp-tools.mjs",
      "scripts/wakeflow-cli.mjs",
      "scripts/wakeflow-setup.mjs",
    ],
    settingsAssetsFrozenPublicFiles: [
      "lib/wakeflow-mcp-tools.mjs",
      "scripts/wakeflow-cli.mjs",
    ],
    activityFrozenPublicFiles: [
      "lib/wakeflow-mcp-tools.mjs",
      "scripts/wakeflow-cli.mjs",
    ],
    packagedEntries: [
      ".claude-plugin/",
      ".mcp.json",
      "README.zh-CN.md",
      "commands/",
      "mcp/",
      "schemas/",
      "skills/",
      "scripts/",
      "templates/",
    ],
  },
});
