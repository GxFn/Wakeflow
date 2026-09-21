import { createMinimalWakeflowConfig } from "../../configuration/wakeflow-config.fixture.js";

export const MANAGED_BLOCK_REPOSITORY_ID =
  "repository_22222222-2222-4222-8222-222222222222";
export const EXTERNAL_DESIGN_SURFACE_ID =
  "surface_33333333-3333-4333-8333-333333333333";
export const SECOND_PRODUCT_WINDOW_ID =
  "window_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

export const MANAGED_BLOCK_REPOSITORY_TARGET = Object.freeze({
  kind: "repository",
  repositoryId: MANAGED_BLOCK_REPOSITORY_ID,
} as const);
export const EXTERNAL_DESIGN_SURFACE_TARGET = Object.freeze({
  kind: "support-surface",
  surfaceId: EXTERNAL_DESIGN_SURFACE_ID,
} as const);

/**
 * 最小 Config 加上 managed-block 仓库、external-owned 且 managed-block 的 Design 面，
 * 以及同一仓库的第二个 primary pod 产品窗口（带说明，用来验证窗口列表与排序）。
 */
export function createManagedBlockWakeflowConfig(
  language: "en" | "zh-Hans" = "en",
): Record<string, unknown> {
  const value = createMinimalWakeflowConfig();
  (value.presentation as Record<string, unknown>).language = language;
  const topology = value.topology as {
    repositories: Record<string, unknown>[];
    supportSurfaces: Record<string, unknown>[];
    windows: Record<string, unknown>[];
  };
  const repository = topology.repositories[0] as Record<string, unknown>;
  repository.instructionManagement = "managed-block";
  repository.description = "Product source responsibility root.";
  const design = topology.supportSurfaces[0] as Record<string, unknown>;
  design.ownership = "external-owned";
  design.path = "../ProductDesign";
  design.instructionManagement = "managed-block";
  design.description = "Externally owned design space.";
  topology.windows.push({
    windowId: SECOND_PRODUCT_WINDOW_ID,
    podId: "pod_99999999-9999-4999-8999-999999999999",
    role: "product",
    displayName: "Product A docs",
    description: "Documentation lane.",
    root: { kind: "repository", repositoryId: MANAGED_BLOCK_REPOSITORY_ID },
  });
  return value;
}
