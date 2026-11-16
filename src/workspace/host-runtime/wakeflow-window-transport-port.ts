import type {
  CreationObservation,
  LivenessObservation,
} from "../../contracts/generated/entrypoints/wakeflow-window-host-binding-registration-request.generated.js";
import type { JsonObject } from "../../foundation/data/json-value.js";

/**
 * Wakeflow Workspace / Host Runtime：窗口传输端口（open-items L6；ADR-0025 D2、D3 的延伸）。
 *
 * 执行端点切片要知道三件随传输变的事：创建观察里哪一段是定位、落盘的定位记录里那一段长什么样、一份存活
 * 观察对当前绑定说明了什么。这三件事此前写在切片里，按观察的种类与传输的名字分支——加一种传输就要改切片。
 * 这里把它们收成一个端口：宿主在 `src/hosts/<host>/` 里为自己的每一种传输实现一份，组合根随门面交给切片，
 * 切片只调用、不认名字。公共合同（观察的 wire 形状）不变，端口吃的就是合同里的观察。
 *
 * 共享层在这个端口上只做两件与名字有关的事，并且都不分支：把 `provider` 原样写进定位记录，再按记录里的
 * `provider` 找到对应的编解码器。
 */

/** 一份定位：传输名加它自己的一段载荷。记录里存成 `{ provider, [provider]: payload }`。 */
export interface WakeflowWindowLocatorTarget {
  readonly provider: string;
  readonly payload: Readonly<JsonObject>;
}

/** 定位记录里与传输无关的身份：它把一个绑定代际钉在一个定位代际上。 */
export interface WakeflowWindowLocatorIdentity {
  readonly programId: string;
  readonly hostId: string;
  readonly windowId: string;
  readonly bindingId: string;
  readonly locatorId: string;
}

export type WakeflowWindowLocator = WakeflowWindowLocatorIdentity & WakeflowWindowLocatorTarget;

/**
 * 定位记录里某一种传输的那一段。一个宿主把自己认得的全部传输都交出来：工作区换过传输之后，磁盘上可能还
 * 留着上一种传输写的记录，读回它要用它自己的编解码器。
 */
export interface WakeflowWindowLocatorCodec {
  readonly provider: string;
  /** 解析这一段载荷；形状不对时调用 `invalid(path)`，它抛出调用方自己的错误。 */
  parsePayload(value: unknown, invalid: (path: string) => never): Readonly<JsonObject>;
  /** 定位代际标识的派生输入：命名空间，与载荷里参与派生的各段（顺序是合同，改了旧记录就读不回）。 */
  identitySeed(
    payload: Readonly<JsonObject>,
  ): Readonly<{ readonly namespace: string; readonly parts: readonly string[] }>;
}

/** 一份存活观察对端点的结论：确定还在、确定不在了，或者什么也证明不了。 */
export type WakeflowWindowPresence = "alive" | "absent" | "unknown";

/**
 * 分类后的存活观察。`kind` 是观察自己的种类；`status` 是传输自己的封闭词汇，只进记录与结果；判定只读
 * `presence`。
 */
export interface WakeflowWindowLiveness {
  readonly kind: LivenessObservation["kind"];
  readonly status?: string;
  readonly presence: WakeflowWindowPresence;
}

export interface WakeflowWindowLivenessInput {
  /** 当前绑定；没有绑定时什么也对照不了。 */
  readonly binding: Readonly<{ readonly bindingId: string; readonly handleValue: string }> | null;
  /** 当前落盘的定位记录；可能是另一种传输留下的。 */
  readonly locator: Readonly<WakeflowWindowLocator> | null;
  readonly observation: Readonly<LivenessObservation>;
  /** 配置的 `hosts` 段，当被动数据交进来：每个宿主只读自己的键。 */
  readonly hosts: unknown;
}

/** 创建观察的定位子没有通过准入：拒绝的 reason 与指向的请求字段。 */
export interface WakeflowWindowLocatorRefusal {
  readonly reason: string;
  readonly path: string;
}

export interface WakeflowWindowTransportPort {
  /** 写进定位记录的传输名；共享层不拿它分支。 */
  readonly provider: string;
  /** 这种传输有没有定位子（项目聊天没有）。 */
  readonly hasLocator: boolean;
  /**
   * 同一个会话换定位（relocate）在这种传输上成不成立：成立；有定位子但没有可换的位置；根本没有定位子。
   */
  readonly relocation: "supported" | "not-applicable" | "unavailable";
  /** 本宿主认得的全部定位载荷。 */
  readonly locatorCodecs: readonly Readonly<WakeflowWindowLocatorCodec>[];
  /** 创建观察的定位子准入：通过为 null。带了别的传输的定位子、或缺了本传输的，都在这里拒绝。 */
  admitCreationLocator(
    observation: Readonly<CreationObservation>,
  ): Readonly<WakeflowWindowLocatorRefusal> | null;
  /** 从创建观察里取出本传输的定位；观察没带时为 null。 */
  locatorOf(
    observation: Readonly<CreationObservation>,
  ): Readonly<WakeflowWindowLocatorTarget> | null;
  /** 这份存活观察对这个绑定与定位说明了什么。 */
  classifyLiveness(input: Readonly<WakeflowWindowLivenessInput>): Readonly<WakeflowWindowLiveness>;
}

/**
 * 什么也证明不了的那一种结论：观察的种类不是本传输的，或者没有可对照的绑定与定位。没有观察时就是
 * `unobserved`；别的种类报 `no-locator`。
 */
export function wakeflowWindowLivenessWithoutEvidence(
  observation: Readonly<LivenessObservation>,
): Readonly<WakeflowWindowLiveness> {
  if (observation.kind === "unobserved") {
    return Object.freeze({ kind: "unobserved" as const, presence: "unknown" as const });
  }
  return Object.freeze({
    kind: observation.kind,
    status: "no-locator",
    presence: "unknown" as const,
  });
}
