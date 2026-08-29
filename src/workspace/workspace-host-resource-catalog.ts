import {
  parsePortableResourcePath,
  type PortableResourcePath,
} from "../foundation/filesystem/portable-resource-path.js";
import {
  parseWakeflowWorkspaceHostResourceProfile,
  type WakeflowWorkspaceHostResourceProfile,
} from "./workspace-host-resource-profile.js";
import {
  parseWakeflowWorkspaceResourceDeclaration,
  type WakeflowWorkspaceResourceDeclaration,
} from "./workspace-resource-declaration.js";
import {
  wakeflowWindowHostBindingMutationLockRef,
  wakeflowWindowHostBindingRootRef,
  wakeflowWindowRuntimeProjectionRootRef,
} from "./window-runtime/wakeflow-window-runtime-paths.js";
import {
  wakeflowHostIdentityRootRef,
  wakeflowHostProjectionsRootRef,
  wakeflowHostRuntimeRootRef,
} from "./workspace-host-runtime-paths.js";

/**
 * Wakeflow Workspace：由宿主静态画像编译资源声明。
 *
 * 本模块拥有通用宿主路径语法和 surface 到资源政策的映射；具体宿主只提供已验证
 * Profile 值。它不按 `hostId` 推断能力，不登记动态实例，也不读取或修改文件系统。
 */

export type WakeflowWorkspaceHostResourceCatalog =
  readonly Readonly<WakeflowWorkspaceResourceDeclaration>[];

type IntegrationFileTracking = "tracked-shareable" | "ignored-private";

function hostRuntimeRef(
  profile: Readonly<WakeflowWorkspaceHostResourceProfile>,
  suffix?: string,
): PortableResourcePath {
  return parsePortableResourcePath(
    suffix === undefined
      ? wakeflowHostRuntimeRootRef(profile)
      : `${wakeflowHostRuntimeRootRef(profile)}/${suffix}`,
  );
}

function privateDirectoryDeclaration(
  declarationId: string,
  ownerId: string,
  relativePath: PortableResourcePath,
): Readonly<WakeflowWorkspaceResourceDeclaration> {
  return parseWakeflowWorkspaceResourceDeclaration({
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId,
    family: "host-runtime",
    ownerId,
    scope: "current-host",
    placement: {
      root: { kind: "workspace" },
      relativePath,
    },
    tracking: {
      disposition: "ignored",
      privacy: "runtime-private",
    },
    nodePolicy: {
      kind: "directory",
      mode: "0700",
      symlinkPolicy: "reject",
      existingModePolicy: "observe-without-change",
    },
    processing: {
      kind: "directory-container",
      materializationRecipe: "materialize-directory",
      existingDirectoryPolicy: "observe-without-mode-change",
      collisionPolicy: "reject-non-directory",
      descendantAuthority: "separate-declaration-required",
      recoveryStrategy: "report-only",
    },
  });
}

function integrationFileDeclaration(
  declarationId: string,
  ownerId: string,
  relativePath: PortableResourcePath,
  tracking: IntegrationFileTracking,
): Readonly<WakeflowWorkspaceResourceDeclaration> {
  const privateResource = tracking === "ignored-private";
  return parseWakeflowWorkspaceResourceDeclaration({
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId,
    family: "host-runtime",
    ownerId,
    scope: "current-host",
    placement: {
      root: { kind: "workspace" },
      relativePath,
    },
    tracking: {
      disposition: privateResource ? "ignored" : "tracked",
      privacy: privateResource ? "runtime-private" : "shareable",
    },
    nodePolicy: {
      kind: "file",
      mode: privateResource ? "0600" : "0644",
      linkPolicy: "single-link",
      executablePolicy: "forbidden",
    },
    processing: {
      kind: "resource",
      role: "managed-integration-text",
      allowedMutationRecipes: ["exact-source-recompose"],
      recoveryStrategy: "recompose-owned-content",
    },
  });
}

function transactionFileDeclaration(
  declarationId: string,
  ownerId: string,
  relativePath: PortableResourcePath,
): Readonly<WakeflowWorkspaceResourceDeclaration> {
  return parseWakeflowWorkspaceResourceDeclaration({
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId,
    family: "host-runtime",
    ownerId,
    scope: "current-host",
    placement: {
      root: { kind: "workspace" },
      relativePath,
    },
    tracking: {
      disposition: "ignored",
      privacy: "runtime-private",
    },
    nodePolicy: {
      kind: "file",
      mode: "0600",
      linkPolicy: "single-link",
      executablePolicy: "forbidden",
    },
    processing: {
      kind: "resource",
      role: "transaction-artifact",
      allowedMutationRecipes: ["exclusive-create", "exact-retire"],
      recoveryStrategy: "owner-transaction-recovery",
    },
  });
}

/** 为一个严格 Host Profile 返回其 Program Instruction 专属短锁路径。 */
export function wakeflowProgramInstructionRecompositionLockRef(
  profileValue: unknown,
): PortableResourcePath {
  const profile = parseWakeflowWorkspaceHostResourceProfile(profileValue);
  return parsePortableResourcePath(
    `.wakeflow-program-instruction-${profile.hostId}.lock`,
  );
}

function privateProjectionFileDeclaration(
  declarationId: string,
  ownerId: string,
  relativePath: PortableResourcePath,
): Readonly<WakeflowWorkspaceResourceDeclaration> {
  return parseWakeflowWorkspaceResourceDeclaration({
    kind: "WakeflowWorkspaceResourceDeclaration",
    declarationId,
    family: "host-runtime",
    ownerId,
    scope: "current-host",
    placement: {
      root: { kind: "workspace" },
      relativePath,
    },
    tracking: {
      disposition: "ignored",
      privacy: "runtime-private",
    },
    nodePolicy: {
      kind: "file",
      mode: "0600",
      linkPolicy: "single-link",
      executablePolicy: "forbidden",
    },
    processing: {
      kind: "resource",
      role: "derived-projection",
      allowedMutationRecipes: ["deterministic-rewrite"],
      recoveryStrategy: "rebuild-from-authority",
    },
  });
}

/** 把一个严格 Host Profile 编译为确定性、冻结的静态资源目录。 */
export function createWakeflowWorkspaceHostResourceCatalog(
  profileValue: unknown,
): WakeflowWorkspaceHostResourceCatalog {
  const profile = parseWakeflowWorkspaceHostResourceProfile(profileValue);
  const prefix = `host-runtime.${profile.hostId}`;
  const declarations: Readonly<WakeflowWorkspaceResourceDeclaration>[] = [
    privateDirectoryDeclaration(
      `${prefix}.root`,
      "host-runtime-layout",
      hostRuntimeRef(profile),
    ),
    privateDirectoryDeclaration(
      `${prefix}.identity-root`,
      "host-runtime-layout",
      wakeflowHostIdentityRootRef(profile),
    ),
    privateDirectoryDeclaration(
      `${prefix}.projections-root`,
      "host-runtime-layout",
      wakeflowHostProjectionsRootRef(profile),
    ),
    integrationFileDeclaration(
      `${prefix}.instruction`,
      "host-instruction-integration",
      profile.instructionFileName,
      "tracked-shareable",
    ),
    transactionFileDeclaration(
      `${prefix}.instruction-lock`,
      "host-instruction-integration",
      wakeflowProgramInstructionRecompositionLockRef(profile),
    ),
    privateDirectoryDeclaration(
      `${prefix}.window-runtime-projections-root`,
      "window-runtime-projection",
      wakeflowWindowRuntimeProjectionRootRef(profile),
    ),
  ];

  if (profile.surfaces.windowIdentity) {
    declarations.push(
      privateDirectoryDeclaration(
        `${prefix}.window-identity-root`,
        "window-host-binding",
        wakeflowWindowHostBindingRootRef(profile),
      ),
      transactionFileDeclaration(
        `${prefix}.window-identity-lock`,
        "window-host-binding",
        wakeflowWindowHostBindingMutationLockRef(profile),
      ),
    );
  }
  if (profile.surfaces.podEvidence) {
    declarations.push(
      privateDirectoryDeclaration(
        `${prefix}.evidence-root`,
        "host-runtime-layout",
        hostRuntimeRef(profile, "evidence"),
      ),
      privateDirectoryDeclaration(
        `${prefix}.pod-evidence-root`,
        "pod-evidence",
        hostRuntimeRef(profile, "evidence/pods"),
      ),
    );
  }
  const hasOperationSurface = profile.surfaces.keepLive
    || profile.surfaces.windowLocator
    || profile.surfaces.statuslineAsset !== null
    || profile.surfaces.activityMonitor
    || profile.surfaces.temporaryPrompts;
  if (hasOperationSurface) {
    declarations.push(privateDirectoryDeclaration(
      `${prefix}.operations-root`,
      "host-runtime-layout",
      hostRuntimeRef(profile, "operations"),
    ));
  }
  if (profile.surfaces.keepLive) {
    declarations.push(
      privateDirectoryDeclaration(
        `${prefix}.keep-live-root`,
        "keep-live",
        hostRuntimeRef(profile, "operations/keep-live"),
      ),
      privateDirectoryDeclaration(
        `${prefix}.keep-live-leases-root`,
        "keep-live",
        hostRuntimeRef(profile, "operations/keep-live/leases"),
      ),
    );
  }
  if (profile.surfaces.windowLocator) {
    declarations.push(privateDirectoryDeclaration(
      `${prefix}.window-locators-root`,
      "window-locator",
      hostRuntimeRef(profile, "operations/window-locators"),
    ));
  }
  if (profile.surfaces.settingsIntegration !== null) {
    declarations.push(
      integrationFileDeclaration(
        `${prefix}.settings-portable`,
        "host-settings-integration",
        profile.surfaces.settingsIntegration.portablePath,
        "tracked-shareable",
      ),
      integrationFileDeclaration(
        `${prefix}.settings-local`,
        "host-settings-integration",
        profile.surfaces.settingsIntegration.localPath,
        "ignored-private",
      ),
    );
  }
  if (profile.surfaces.statuslineAsset !== null) {
    declarations.push(
      privateDirectoryDeclaration(
        `${prefix}.statusline-assets-root`,
        "host-statusline",
        hostRuntimeRef(profile, "operations/assets"),
      ),
      privateProjectionFileDeclaration(
        `${prefix}.statusline-asset`,
        "host-statusline",
        hostRuntimeRef(
          profile,
          `operations/assets/${profile.surfaces.statuslineAsset.fileName}`,
        ),
      ),
    );
  }
  if (profile.surfaces.activityMonitor) {
    declarations.push(privateDirectoryDeclaration(
      `${prefix}.activity-monitor-root`,
      "activity-monitor",
      hostRuntimeRef(profile, "operations/activity-monitor"),
    ));
  }
  if (profile.surfaces.temporaryPrompts) {
    declarations.push(
      privateDirectoryDeclaration(
        `${prefix}.temporary-root`,
        "host-runtime-layout",
        hostRuntimeRef(profile, "operations/temp"),
      ),
      privateDirectoryDeclaration(
        `${prefix}.temporary-prompts-root`,
        "temporary-prompt",
        hostRuntimeRef(profile, "operations/temp/prompts"),
      ),
    );
  }

  return Object.freeze(declarations);
}
