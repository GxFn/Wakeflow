import {
  createMinimalWakeflowConfigV3,
} from "./wakeflow-config-v3.fixture.js";

export const MINIMAL_WAKEFLOW_FRESH_SELECTION_UUIDS = Object.freeze([
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
  "55555555-5555-4555-8555-555555555555",
  "66666666-6666-4666-8666-666666666666",
  "77777777-7777-4777-8777-777777777777",
  "88888888-8888-4888-8888-888888888888",
]);

/** 从最小 Config fixture 去除 durable IDs，生成公共 Fresh selection。 */
export function createMinimalWakeflowFreshConfigSelection() {
  const config = createMinimalWakeflowConfigV3();
  const program = config.program as Record<string, unknown>;
  const topology = config.topology as {
    repositories: Record<string, unknown>[];
    supportSurfaces: Record<string, unknown>[];
    windows: Record<string, unknown>[];
  };
  const repositoryKeys = new Map<string, string>();
  const repositories = topology.repositories.map((entry, index) => {
    const selectionKey = `repository-${index + 1}`;
    repositoryKeys.set(String(entry.repositoryId), selectionKey);
    const { repositoryId: _repositoryId, ...rest } = entry;
    return { selectionKey, ...rest };
  });
  const surfaceKeys = new Map<string, string>();
  const supportSurfaces = topology.supportSurfaces.map((entry) => {
    const selectionKey = entry.capability === "design" ? "design" : "test";
    surfaceKeys.set(String(entry.surfaceId), selectionKey);
    const { surfaceId: _surfaceId, ...rest } = entry;
    return { selectionKey, ...rest };
  });
  const windows = topology.windows.map((entry, index) => {
    const root = entry.root as Record<string, unknown>;
    const { windowId: _windowId, ...rest } = entry;
    return {
      selectionKey: `window-${index + 1}`,
      ...rest,
      root: root.kind === "program"
        ? { kind: "program" }
        : root.kind === "repository"
          ? {
              kind: "repository",
              selectionKey: repositoryKeys.get(String(root.repositoryId)),
            }
          : {
              kind: "support-surface",
              selectionKey: surfaceKeys.get(String(root.surfaceId)),
            },
    };
  });
  return {
    program: {
      displayName: program.displayName,
    },
    presentation: {},
    topology: { repositories, supportSurfaces, windows },
    storage: config.storage,
    governance: config.governance,
    hosts: config.hosts,
  };
}

/** 为纯编译测试返回按给定序列消费 UUID 的工厂。 */
export function createSequenceUuidV4Factory(
  values = MINIMAL_WAKEFLOW_FRESH_SELECTION_UUIDS,
) {
  let index = 0;
  return () => values[index++] ?? "invalid";
}
