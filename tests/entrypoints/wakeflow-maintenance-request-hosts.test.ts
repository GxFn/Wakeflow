import { equal } from "node:assert/strict";
import { test } from "node:test";

import { WAKEFLOW_MAINTENANCE_PUBLIC_REQUEST_SCHEMA } from "../../src/contracts/generated/entrypoints/wakeflow-maintenance-public-request.generated.js";
import { parseJsonValue } from "../../src/foundation/data/json-value.js";
import { createRuntimeJsonSchemaValidator } from "../../src/foundation/schema/runtime-json-schema.js";

/**
 * I12（§13.190）：fresh-initialize 的 `selection.hosts` 在请求 Schema 里有了 Config Schema 的形状。
 * 写错 tmux 会话名或权限模式所在的键，在进入编译器之前就被请求 Schema 拒绝，拒绝点名到字段；
 * 现场的引导会话正是因为这里没有形状，才去读了别的工作区的配置来猜键名。
 */
function freshInitializePreview(hosts: unknown) {
  return parseJsonValue({
    root: "/workspace",
    mode: "preview",
    action: "fresh-initialize",
    request: {
      selection: {
        program: { displayName: "Program" },
        presentation: {},
        topology: { repositories: [], supportSurfaces: [], windows: [] },
        storage: { ledgerRoot: "ledger" },
        governance: {},
        hosts,
      },
    },
  });
}

test("I12：selection.hosts 接受 Config 形状的 tmux 会话名、权限模式与按角色的推理强度", () => {
  const validate = createRuntimeJsonSchemaValidator<unknown>(
    WAKEFLOW_MAINTENANCE_PUBLIC_REQUEST_SCHEMA,
  );
  equal(validate(freshInitializePreview({})).ok, true);
  equal(
    validate(
      freshInitializePreview({
        "claude-code": { tmux: { sessionName: "wakeflow8" }, launch: { permissionMode: "auto" } },
        codex: { launch: { reasoningEffortByRole: { product: "xhigh" } } },
      }),
    ).ok,
    true,
  );
});

test("I12：写错的 hosts 键在请求 Schema 这一层就被拒，并点名字段", () => {
  const validate = createRuntimeJsonSchemaValidator<unknown>(
    WAKEFLOW_MAINTENANCE_PUBLIC_REQUEST_SCHEMA,
  );
  const cases = [
    [
      { "claude-code": { session: "wakeflow8" } },
      "$/request/selection/hosts/claude-code",
      "additional:session",
    ],
    [
      { "claude-code": { tmux: { sessionName: " wakeflow8" } } },
      "$/request/selection/hosts/claude-code/tmux/sessionName",
      "pattern",
    ],
    [
      { "claude-code": { launch: { permissionMode: "yolo" } } },
      "$/request/selection/hosts/claude-code/launch/permissionMode",
      "enum",
    ],
  ] as const;
  for (const [hosts, path, detail] of cases) {
    const rejected = validate(freshInitializePreview(hosts));
    equal(rejected.ok, false);
    if (!rejected.ok) {
      equal(rejected.path, path);
      equal(rejected.detail, detail);
    }
  }
});
