import type { WakeflowConfigModel } from "../../configuration/wakeflow-config.js";
import type { JsonObject } from "../../foundation/data/json-value.js";
import type { WakeflowWorkspaceHostResourceProfile } from "../workspace-host-resource-profile.js";
import type { WakeflowWindowLaunchIntent } from "./wakeflow-window-launch-intent.js";

/** Pure rendering port. No host calls, project IDs, absolute paths or binding authority. */
export interface WakeflowWindowLaunchInstructionInput {
  readonly model: WakeflowConfigModel;
  readonly intent: Readonly<WakeflowWindowLaunchIntent>;
  readonly profile: Readonly<WakeflowWorkspaceHostResourceProfile>;
  readonly attachedWorktrees: readonly {
    readonly repositoryId: string;
    readonly status: "receipt-present" | "receipt-missing";
    readonly pathFromWorkspaceRoot: string | null;
  }[];
}

export type WakeflowWindowLaunchInstructionsRenderer = (
  input: WakeflowWindowLaunchInstructionInput,
) => JsonObject;

/**
 * 一个窗口自己解析后的启动取值（open-items G14）：宿主画像把 Config 的宿主段与模板缺省按这个窗口的角色
 * 解析成"名字 → 取值"，例如 model、effort、permissionMode、transport。共享代码不知道这些名字的含义，只在
 * 握手时把它们记进绑定、在 status 里逐项比较；没有配置的一项是 null。
 */
export type WakeflowWindowLaunchValues = Readonly<Record<string, string | null>>;

/** Pure rendering port, same boundary as the instructions renderer. */
export type WakeflowWindowLaunchValuesRenderer = (
  input: Pick<WakeflowWindowLaunchInstructionInput, "model" | "intent" | "profile">,
) => WakeflowWindowLaunchValues;
