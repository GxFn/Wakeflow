/** 新 TypeScript 配置测试共享的最小公开 v3 数据；字段顺序与持久 writer 一致。 */
export function createMinimalWakeflowConfig(): Record<string, unknown> {
  return {
    $schema: "urn:wakeflow:config:v1",
    kind: "WakeflowConfig",
    schemaVersion: 1,
    program: {
      programId: "program_11111111-1111-4111-8111-111111111111",
      displayName: "Example Program",
    },
    presentation: { language: "en" },
    topology: {
      repositories: [
        {
          repositoryId: "repository_22222222-2222-4222-8222-222222222222",
          path: "../ProductA",
          displayName: "Product A",
          instructionManagement: "owner-managed",
        },
      ],
      supportSurfaces: [
        {
          surfaceId: "surface_33333333-3333-4333-8333-333333333333",
          capability: "design",
          path: "Design",
          displayName: "Design",
          ownership: "wakeflow-managed",
        },
        {
          surfaceId: "surface_44444444-4444-4444-8444-444444444444",
          capability: "test",
          path: "Test",
          displayName: "Test",
          ownership: "wakeflow-managed",
        },
      ],
      windows: [
        {
          windowId: "window_55555555-5555-4555-8555-555555555555",
          podId: "pod_99999999-9999-4999-8999-999999999999",
          role: "controller",
          displayName: "Controller",
          root: { kind: "program" },
        },
        {
          windowId: "window_66666666-6666-4666-8666-666666666666",
          podId: "pod_99999999-9999-4999-8999-999999999999",
          role: "design",
          displayName: "Design",
          root: {
            kind: "support-surface",
            surfaceId: "surface_33333333-3333-4333-8333-333333333333",
          },
        },
        {
          windowId: "window_77777777-7777-4777-8777-777777777777",
          podId: "pod_99999999-9999-4999-8999-999999999999",
          role: "test",
          displayName: "Test",
          root: {
            kind: "support-surface",
            surfaceId: "surface_44444444-4444-4444-8444-444444444444",
          },
        },
        {
          windowId: "window_88888888-8888-4888-8888-888888888888",
          podId: "pod_99999999-9999-4999-8999-999999999999",
          role: "product",
          displayName: "Product A",
          root: {
            kind: "repository",
            repositoryId: "repository_22222222-2222-4222-8222-222222222222",
          },
        },
      ],
    },
    pods: [
      {
        podId: "pod_99999999-9999-4999-8999-999999999999",
        name: "main",
        placement: "primary",
        lifecycle: "open",
        worktrees: [],
        closing: null,
      },
    ],
    storage: { ledgerRoot: "../wakeflow-ledger" },
    governance: {},
    hosts: {},
  };
}

export function serializeWakeflowConfigFixture(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
