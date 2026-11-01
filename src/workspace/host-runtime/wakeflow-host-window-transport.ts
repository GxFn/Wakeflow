import type { WakeflowWorkspaceHostResourceProfile } from "../workspace-host-resource-profile.js";

/**
 * Wakeflow Workspace / Host Runtime：窗口传输的 profile 选择（ADR-0025 D1）。
 *
 * 一个宿主可以提供多份资源 profile（Claude Code：tmux 与桌面会话），由配置 `hosts.<host>.windowTransport`
 * 选其一。本模块只按键索引：键的名字与含义归宿主，共享层在能力切片准入门面时调用一次，之后只读选出的
 * profile；`grep windowTransport` 在宿主、配置、本模块与 Schema 之外不得命中。没有传输表的宿主（Codex）
 * 原样返回它唯一的 profile。
 */

export interface WakeflowWorkspaceHostTransportTable {
  /** 配置未声明时选用的键。 */
  readonly defaultTransport: string;
  readonly profiles: Readonly<Record<string, Readonly<WakeflowWorkspaceHostResourceProfile>>>;
}

export interface WakeflowWorkspaceHostTransportSource {
  readonly hostId: string;
  readonly resourceProfile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly transports?: Readonly<WakeflowWorkspaceHostTransportTable> | undefined;
}

/**
 * 选择只读配置里 `hosts.<host>.windowTransport` 这一个键；其余配置形状与本模块无关。配置已由 Schema
 * 准入，这里把 `hosts` 当被动数据读：不是对象或没有该键就视为未声明。
 */
export interface WakeflowWorkspaceHostTransportModel {
  readonly hosts?: unknown;
}

function configuredTransportValue(hosts: unknown, hostId: string): string | undefined {
  if (typeof hosts !== "object" || hosts === null) return undefined;
  const entry = (hosts as Readonly<Record<string, unknown>>)[hostId];
  if (typeof entry !== "object" || entry === null) return undefined;
  const value = (entry as Readonly<Record<string, unknown>>).windowTransport;
  return typeof value === "string" ? value : undefined;
}

export type WakeflowWorkspaceHostTransportErrorReason = "unknown-transport";

export class WakeflowWorkspaceHostTransportError extends Error {
  override readonly name = "WakeflowWorkspaceHostTransportError";
  readonly code = "wakeflow-workspace-host-transport" as const;
  readonly reason: WakeflowWorkspaceHostTransportErrorReason;
  readonly transport: string;

  constructor(reason: WakeflowWorkspaceHostTransportErrorReason, transport: string) {
    super("Wakeflow workspace host transport is not provided by this host.");
    this.reason = reason;
    this.transport = transport;
  }
}

/** 配置选了的传输键；配置未声明时是宿主的缺省键；没有传输表的宿主返回 null。 */
export function configuredWakeflowWorkspaceHostTransport(
  host: Readonly<WakeflowWorkspaceHostTransportSource>,
  model: Readonly<WakeflowWorkspaceHostTransportModel>,
): string | null {
  if (host.transports === undefined) return null;
  return configuredTransportValue(model.hosts, host.hostId) ?? host.transports.defaultTransport;
}

/** 按配置选出当前工作区该宿主的资源 profile；传输键不在表里即抛错（配置 Schema 已限定枚举，这是合同违背）。 */
export function selectWakeflowWorkspaceHostResourceProfile(
  host: Readonly<WakeflowWorkspaceHostTransportSource>,
  model: Readonly<WakeflowWorkspaceHostTransportModel>,
): Readonly<WakeflowWorkspaceHostResourceProfile> {
  const transport = configuredWakeflowWorkspaceHostTransport(host, model);
  if (transport === null || host.transports === undefined) return host.resourceProfile;
  const profile = Object.hasOwn(host.transports.profiles, transport)
    ? host.transports.profiles[transport]
    : undefined;
  if (profile === undefined)
    throw new WakeflowWorkspaceHostTransportError("unknown-transport", transport);
  return profile;
}
