import type { ObservationHostFacade } from "../../../src/capabilities/observation/service.js";
import { claudeCodeWindowHostIdentityProfile } from "../../../src/hosts/claude-code/claude-code-window-host-identity-profile.js";
import { claudeCodeWorkspaceHostResourceProfile } from "../../../src/hosts/claude-code/wakeflow-workspace-host-resource-profile.js";
import { codexWindowHostIdentityProfile } from "../../../src/hosts/codex/codex-window-host-identity-profile.js";
import { codexWorkspaceHostResourceProfile } from "../../../src/hosts/codex/wakeflow-workspace-host-resource-profile.js";

/**
 * 与 Codex 组合根一致的观察 facade：两个宿主的纯数据 profile 都在；状态栏资产是
 * Claude 宿主的执行内容，Codex 制品不携带，对端条目为 null。
 */
export const CODEX_OBSERVATION_FACADE: Readonly<ObservationHostFacade> = Object.freeze({
  hostId: "codex" as const,
  hosts: Object.freeze([
    Object.freeze({
      hostId: "codex" as const,
      resourceProfile: codexWorkspaceHostResourceProfile,
      identityProfile: codexWindowHostIdentityProfile,
      statuslineAsset: null,
    }),
    Object.freeze({
      hostId: "claude-code" as const,
      resourceProfile: claudeCodeWorkspaceHostResourceProfile,
      identityProfile: claudeCodeWindowHostIdentityProfile,
      statuslineAsset: null,
    }),
  ]),
});
