import { computeCanonicalJsonSha256Digest } from "../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import type { JsonValue } from "../../foundation/data/json-value.js";
import { type Fail, failWith, ModuleError } from "../../foundation/error/module-error.js";
import {
  createWakeflowWorkspaceHostResourceCatalog,
  hostProfileHasOperationSurface,
} from "../workspace-host-resource-catalog.js";
import type { WakeflowHostId } from "../../contracts/vocabulary/wakeflow-host-id.js";
import type { WakeflowWorkspaceHostResourceProfile } from "../workspace-host-resource-profile.js";
import type { WakeflowWorkspaceResourceDeclaration } from "../../kernel/workspace-resource-declaration.js";

/**
 * Wakeflow Workspace / Host Runtime：当前宿主 capability 父目录的纯目标权威。
 *
 * 本 authority 只选择 Profile 声明适用的目录型资源，不包含 instruction/settings 文件、
 * statusline asset、Binding、Window Runtime projection 或任何事件产生的子资源。
 */

export interface WakeflowHostCapabilityLayoutAuthority {
  readonly kind: "WakeflowHostCapabilityLayoutAuthority";
  readonly schemaVersion: 1;
  readonly hostId: WakeflowHostId;
  readonly declarations: readonly Readonly<WakeflowWorkspaceResourceDeclaration>[];
  readonly authorityDigest: Sha256Digest;
}

export type WakeflowHostCapabilityLayoutAuthorityErrorReason = "catalog";

/** Host capability layout authority 编译失败的稳定、脱敏错误。 */
export class WakeflowHostCapabilityLayoutAuthorityError extends ModuleError<WakeflowHostCapabilityLayoutAuthorityErrorReason> {
  static override readonly code = "wakeflow-host-capability-layout-authority";
}

const fail: Fail<WakeflowHostCapabilityLayoutAuthorityErrorReason> = failWith(
  WakeflowHostCapabilityLayoutAuthorityError,
);

/** 仅按 Profile capability 编译父目录声明；不按 hostId 分支。 */
export function compileWakeflowHostCapabilityLayoutAuthority(
  profile: Readonly<WakeflowWorkspaceHostResourceProfile>,
): Readonly<WakeflowHostCapabilityLayoutAuthority> {
  const prefix = `host-runtime.${profile.hostId}`;
  const declarationIds: string[] = [];
  if (profile.surfaces.podReceipts) {
    declarationIds.push(`${prefix}.pod-receipts-root`);
  }
  if (hostProfileHasOperationSurface(profile)) {
    declarationIds.push(`${prefix}.operations-root`);
  }
  // 定位器目录 `identity/window-locators` 不进 capability 布局：它在 identity 下（窗口运行时发布对 identity
  // 的子项有精确断言），由 locator store 在第一次登记时创建；目录声明只作资源清单（复审 J5）。
  if (profile.surfaces.statuslineAsset !== null || profile.surfaces.helperAsset !== null) {
    declarationIds.push(`${prefix}.statusline-assets-root`);
  }
  const catalog = createWakeflowWorkspaceHostResourceCatalog(profile);
  const declarations = Object.freeze(
    declarationIds.map((declarationId) => {
      const declaration = catalog.find((entry) => entry.declarationId === declarationId);
      if (
        declaration === undefined ||
        declaration.nodePolicy.kind !== "directory" ||
        declaration.processing.kind !== "directory-container"
      ) {
        fail("catalog", "$declarations");
      }
      return declaration;
    }),
  );
  const basis = {
    kind: "WakeflowHostCapabilityLayoutAuthority" as const,
    schemaVersion: 1 as const,
    hostId: profile.hostId,
    declarations,
  };
  return Object.freeze({
    ...basis,
    authorityDigest: computeCanonicalJsonSha256Digest(basis as unknown as JsonValue),
  });
}
