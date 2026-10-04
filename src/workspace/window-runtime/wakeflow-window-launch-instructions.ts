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
