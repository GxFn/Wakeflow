import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  capStatusList,
  deriveNextActions,
  deriveWorkspaceGates,
  type NextActionInput,
  nextFromActions,
  projectionFreshness,
  STATUS_LIST_MAXIMUMS,
  summarizeGates,
  type VerifyGate,
  verifyNext,
  type WorkspaceGateFacts,
} from "../../../src/capabilities/observation/decide.js";
import { WAKEFLOW_CONFIG_FILE_REF } from "../../../src/configuration/wakeflow-config-authority-snapshot.js";
import { WAKEFLOW_VERIFY_RESULT_SCHEMA } from "../../../src/contracts/generated/entrypoints/wakeflow-verify-result.generated.js";
import { computeCanonicalJsonSha256Digest } from "../../../src/foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";
import {
  WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF,
  WAKEFLOW_ACTIVE_WORKSPACE_STATUS_REF,
} from "../../../src/kernel/layout.js";

/**
 * 观察切片的纯决定（gate-log §13.94 D1、D3、D10）：下一步的排序、去重与上限；十四道工作区门
 * 按名字排序，每门只看纯事实；汇总里 unavailable 算不通过但分开计数；verify 的 next 指向维护；
 * 投影新鲜度取最坏目标。
 */

const DEMAND_A = "demand_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEMAND_B = "demand_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WINDOW_A = "window_11111111-1111-4111-8111-111111111111";
const WINDOW_B = "window_22222222-2222-4222-8222-222222222222";
const WINDOW_C = "window_33333333-3333-4333-8333-333333333333";
const POD_MAIN = "pod_99999999-9999-4999-8999-999999999999";
const POD_FEATURE = "pod_88888888-8888-4888-8888-888888888888";
const REPOSITORY = "repository_22222222-2222-4222-8222-222222222222";
const GATE_NAMES = Object.freeze([
  "active-projection",
  "append-candidates-clear",
  "board-consistency",
  "config-authority",
  "demand-root-audit",
  "evidence-integrity",
  "host-hook-channel",
  "host-settings-assets",
  "ledger-layout",
  "local-layout",
  "pod-execution-location",
  "window-identity",
  "window-runtime-projection",
  "work-claims",
]);

function digest(seed: string): Sha256Digest {
  return computeCanonicalJsonSha256Digest({ seed });
}

const OBSERVED = Object.freeze({ status: "observed" as const, issue: null });

function healthyFacts(overrides: Partial<WorkspaceGateFacts> = {}): WorkspaceGateFacts {
  return {
    domains: { demands: OBSERVED, claims: OBSERVED, pods: OBSERVED },
    configRecheck: "current",
    configRef: WAKEFLOW_CONFIG_FILE_REF,
    configDigest: digest("config"),
    layout: "current",
    local: { status: "ready", codes: [] },
    ledger: "current",
    board: { status: "observed", skipped: 0, indexCurrent: true, claimedWithoutRoot: [] },
    demands: [
      {
        demandId: DEMAND_A,
        status: "observed",
        audit: "pass",
        evidence: "pass",
        appendCandidates: 0,
      },
    ],
    strayJournals: [],
    claims: [{ windowId: WINDOW_A, orphan: false }],
    claimsUnreadable: 0,
    hooks: [
      {
        hostId: "codex",
        current: true,
        status: "observed",
        directory: "private",
        records: 2,
        skipped: 0,
      },
      {
        hostId: "claude-code",
        current: false,
        status: "observed",
        directory: "absent",
        records: 0,
        skipped: 0,
      },
    ],
    windows: [
      { windowId: WINDOW_A, identity: "registered" },
      { windowId: WINDOW_B, identity: "registered" },
    ],
    windowRuntime: [
      {
        hostId: "codex",
        status: "observed",
        issue: null,
        windows: [
          { windowId: WINDOW_A, status: "current" },
          { windowId: WINDOW_B, status: "current" },
        ],
      },
      {
        hostId: "claude-code",
        status: "observed",
        issue: null,
        windows: [
          { windowId: WINDOW_A, status: "current" },
          { windowId: WINDOW_B, status: "current" },
        ],
      },
    ],
    pods: [
      { podId: POD_MAIN, placement: "primary", lifecycle: "open", state: "ready", worktrees: [] },
    ],
    primaryCheckouts: true,
    assets: [
      { hostId: "codex", status: "not-applicable", settings: "not-applicable" },
      { hostId: "claude-code", status: "not-applicable", settings: "not-applicable" },
    ],
    projection: {
      status: "observed",
      targets: [
        {
          resourcePath: WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF,
          status: "current",
          reason: null,
          digest: digest("index"),
        },
        {
          resourcePath: WAKEFLOW_ACTIVE_WORKSPACE_STATUS_REF,
          status: "current",
          reason: null,
          digest: digest("status"),
        },
      ],
    },
    ...overrides,
  };
}

function gateOf(gates: readonly Readonly<VerifyGate>[], name: string): Readonly<VerifyGate> {
  const found = gates.find((gate) => gate.name === name);
  if (found === undefined) throw new Error(`gate ${name} missing`);
  return found;
}

function verdictOf(
  facts: WorkspaceGateFacts,
  name: string,
): readonly [VerifyGate["status"], string | null] {
  const gate = gateOf(deriveWorkspaceGates(facts), name);
  return [gate.status, gate.code];
}

function nextInput(overrides: Partial<NextActionInput> = {}): NextActionInput {
  return {
    maintenance: false,
    unregisteredWindows: [],
    demands: [],
    pendingPackages: [],
    ...overrides,
  };
}

test("deriveNextActions：维护 > 活动 pod 的未登记窗口（按 windowId）> Demand 前沿（primary 先，再按 demandId）> 待认领需求包；终态与无前沿的 Demand 不进列表", () => {
  const actions = deriveNextActions(
    nextInput({
      maintenance: true,
      unregisteredWindows: [
        { windowId: WINDOW_C, podId: POD_MAIN, placement: "primary", podActive: true },
        { windowId: WINDOW_B, podId: POD_FEATURE, placement: "worktree", podActive: false },
        { windowId: WINDOW_A, podId: POD_FEATURE, placement: "worktree", podActive: true },
      ],
      demands: [
        {
          demandId: DEMAND_A,
          placement: "worktree",
          disposition: "work-available",
          frontier: "implementation-delivery-planning",
          owner: "controller",
          suggestedTool: "wakeflow_prepare_delivery",
        },
        {
          demandId: DEMAND_B,
          placement: "primary",
          disposition: "blocked",
          frontier: "implementation-result-import",
          owner: "target",
          suggestedTool: null,
        },
        {
          demandId: "demand_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          placement: "primary",
          disposition: "terminal",
          frontier: "demand-continuation",
          owner: "controller",
          suggestedTool: "wakeflow_continue_demand",
        },
        {
          demandId: "demand_dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          placement: "primary",
          disposition: "work-available",
          frontier: null,
          owner: "none",
          suggestedTool: null,
        },
      ],
      pendingPackages: [
        { requirementId: "requirement_22222222-2222-4222-8222-222222222222" },
        { requirementId: "requirement_11111111-1111-4111-8111-111111111111" },
      ],
    }),
  );
  deepEqual(
    actions.map((action) => [action.owner, action.tool, action.reason, action.subject]),
    [
      ["controller", "wakeflow_maintain_workspace", "workspace-maintenance", null],
      ["controller", "wakeflow_register_window_binding", "pod-window-registration", WINDOW_A],
      ["controller", "wakeflow_register_window_binding", "pod-window-registration", WINDOW_C],
      ["target", null, "implementation-result-import", DEMAND_B],
      ["controller", "wakeflow_prepare_delivery", "implementation-delivery-planning", DEMAND_A],
      [
        "controller",
        "wakeflow_create_demand",
        "requirement-claim",
        "requirement_11111111-1111-4111-8111-111111111111",
      ],
      [
        "controller",
        "wakeflow_create_demand",
        "requirement-claim",
        "requirement_22222222-2222-4222-8222-222222222222",
      ],
    ],
  );
  deepEqual(nextFromActions(actions), {
    frontier: "workspace-maintenance",
    owner: "controller",
    suggestedTool: "wakeflow_maintain_workspace",
    blockers: [],
  });
  deepEqual(nextFromActions([]), {
    frontier: null,
    owner: "none",
    suggestedTool: null,
    blockers: [],
  });
});

test("deriveNextActions：同一动作去重，总数上限 64", () => {
  const duplicated = deriveNextActions(
    nextInput({
      pendingPackages: [
        { requirementId: "requirement_11111111-1111-4111-8111-111111111111" },
        { requirementId: "requirement_11111111-1111-4111-8111-111111111111" },
      ],
    }),
  );
  equal(duplicated.length, 1);
  const packages = Array.from({ length: 70 }, (_, index) => ({
    requirementId: `requirement_${index.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`,
  }));
  const capped = deriveNextActions(nextInput({ maintenance: true, pendingPackages: packages }));
  equal(capped.length, 64);
  equal(capped[0]?.reason, "workspace-maintenance");
  equal(capped[63]?.subject, packages[62]?.requirementId);
});

test("deriveWorkspaceGates：健康事实十四门全 pass、按名字排序；汇总 ok 且 next 无前沿", () => {
  const gates = deriveWorkspaceGates(healthyFacts());
  deepEqual(
    gates.map((gate) => gate.name),
    GATE_NAMES,
  );
  deepEqual(
    gates.map((gate) => gate.status),
    GATE_NAMES.map(() => "pass"),
  );
  equal(gateOf(gates, "host-settings-assets").code, "not-applicable");
  equal(gateOf(gates, "window-identity").code, null);
  deepEqual(gateOf(gates, "config-authority").evidence, [
    { ref: WAKEFLOW_CONFIG_FILE_REF, digest: digest("config") },
  ]);
  deepEqual(
    gateOf(gates, "active-projection").evidence.map((entry) => entry.ref),
    [WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF, WAKEFLOW_ACTIVE_WORKSPACE_STATUS_REF],
  );
  deepEqual(summarizeGates(gates), { ok: true, summary: { pass: 14, fail: 0, unavailable: 0 } });
  deepEqual(verifyNext(gates), {
    frontier: null,
    owner: "none",
    suggestedTool: null,
    blockers: [],
  });
});

test("deriveWorkspaceGates：每门从事实得出 fail 与 unavailable 并带出原因码", () => {
  deepEqual(verdictOf(healthyFacts({ configRecheck: "changed" }), "config-authority"), [
    "fail",
    "changed",
  ]);
  deepEqual(verdictOf(healthyFacts({ configRecheck: "unavailable" }), "config-authority"), [
    "unavailable",
    "unavailable",
  ]);

  // local-layout：静态资源矩阵的对账预览 ready 且无步骤（§13.94 D3）。
  deepEqual(
    verdictOf(
      healthyFacts({
        local: {
          status: "blocked",
          codes: ["gitignore-git", "step:recompose-program-instruction"],
        },
      }),
      "local-layout",
    ),
    ["fail", "local:blocked,gitignore-git,step:recompose-program-instruction"],
  );
  deepEqual(
    verdictOf(healthyFacts({ local: { status: "unavailable", codes: [] } }), "local-layout"),
    ["unavailable", "local:unavailable"],
  );
  deepEqual(verdictOf(healthyFacts({ layout: "absent" }), "local-layout"), [
    "fail",
    "active:absent",
  ]);
  deepEqual(verdictOf(healthyFacts({ layout: "unavailable" }), "local-layout"), [
    "unavailable",
    "active:unavailable",
  ]);

  deepEqual(verdictOf(healthyFacts({ ledger: "stale" }), "ledger-layout"), ["fail", "stale"]);
  deepEqual(verdictOf(healthyFacts({ ledger: "unavailable" }), "ledger-layout"), [
    "unavailable",
    "unavailable",
  ]);

  deepEqual(
    verdictOf(
      healthyFacts({
        board: {
          status: "observed",
          skipped: 1,
          indexCurrent: false,
          claimedWithoutRoot: [DEMAND_B],
        },
      }),
      "board-consistency",
    ),
    ["fail", `skipped:1,index-stale,claimed-without-root:${DEMAND_B}`],
  );
  deepEqual(
    verdictOf(
      healthyFacts({
        board: { status: "unavailable", skipped: 0, indexCurrent: null, claimedWithoutRoot: [] },
      }),
      "board-consistency",
    ),
    ["unavailable", "unavailable"],
  );

  const failingDemand = healthyFacts({
    demands: [
      {
        demandId: DEMAND_A,
        status: "observed",
        audit: "fail",
        evidence: "fail",
        appendCandidates: 2,
      },
      {
        demandId: DEMAND_B,
        status: "unavailable",
        audit: "unavailable",
        evidence: "unavailable",
        appendCandidates: 0,
      },
    ],
    strayJournals: ["demand_cccccccc-cccc-4ccc-8ccc-cccccccccccc"],
  });
  deepEqual(verdictOf(failingDemand, "demand-root-audit"), ["fail", `${DEMAND_A},${DEMAND_B}`]);
  // 未通过的 Demand 全部列出：fail 与 unavailable 都不是 pass，状态取最坏的 fail。
  deepEqual(verdictOf(failingDemand, "evidence-integrity"), ["fail", `${DEMAND_A},${DEMAND_B}`]);
  deepEqual(verdictOf(failingDemand, "append-candidates-clear"), [
    "fail",
    "candidates:2,journal:demand_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  ]);
  // 日志目录读不出：门 unavailable 而不是 pass（读失败不能变成通过）。
  deepEqual(verdictOf(healthyFacts({ strayJournals: null }), "append-candidates-clear"), [
    "unavailable",
    "journals:unreadable",
  ]);
  deepEqual(
    verdictOf(
      healthyFacts({
        demands: [
          {
            demandId: DEMAND_B,
            status: "unavailable",
            audit: "unavailable",
            evidence: "unavailable",
            appendCandidates: 0,
          },
        ],
      }),
      "demand-root-audit",
    ),
    ["unavailable", DEMAND_B],
  );

  deepEqual(
    verdictOf(
      healthyFacts({ claims: [{ windowId: WINDOW_A, orphan: true }], claimsUnreadable: 1 }),
      "work-claims",
    ),
    ["fail", `orphan:${WINDOW_A},unreadable:1`],
  );

  deepEqual(
    verdictOf(
      healthyFacts({
        hooks: [
          {
            hostId: "codex",
            current: true,
            status: "observed",
            directory: "private",
            records: 3,
            skipped: 1,
          },
          {
            hostId: "claude-code",
            current: false,
            status: "observed",
            directory: "mode",
            records: 0,
            skipped: 0,
          },
        ],
      }),
      "host-hook-channel",
    ),
    ["fail", "codex:skipped-1,claude-code:mode"],
  );
  deepEqual(
    verdictOf(
      healthyFacts({
        hooks: [
          {
            hostId: "codex",
            current: true,
            status: "unavailable",
            directory: "absent",
            records: 0,
            skipped: 0,
          },
        ],
      }),
      "host-hook-channel",
    ),
    ["unavailable", "codex:unavailable"],
  );

  // §13.97 D10：当前宿主的目录缺席或零记录不是损坏（pass），但 code 报出，让"hook 从未触发"
  // 在 verify 里可见；同伴宿主的缺席与零记录保持沉默（它的记录由另一份制品写）。
  deepEqual(
    verdictOf(
      healthyFacts({
        hooks: [
          {
            hostId: "codex",
            current: true,
            status: "observed",
            directory: "absent",
            records: 0,
            skipped: 0,
          },
          {
            hostId: "claude-code",
            current: false,
            status: "observed",
            directory: "absent",
            records: 0,
            skipped: 0,
          },
        ],
      }),
      "host-hook-channel",
    ),
    ["pass", "codex:absent"],
  );
  deepEqual(
    verdictOf(
      healthyFacts({
        hooks: [
          {
            hostId: "codex",
            current: false,
            status: "observed",
            directory: "private",
            records: 0,
            skipped: 0,
          },
          {
            hostId: "claude-code",
            current: true,
            status: "observed",
            directory: "private",
            records: 0,
            skipped: 0,
          },
        ],
      }),
      "host-hook-channel",
    ),
    ["pass", "claude-code:records-0"],
  );
  deepEqual(
    verdictOf(
      healthyFacts({
        hooks: [
          {
            hostId: "codex",
            current: true,
            status: "observed",
            directory: "private",
            records: 1,
            skipped: 0,
          },
          {
            hostId: "claude-code",
            current: false,
            status: "observed",
            directory: "private",
            records: 0,
            skipped: 0,
          },
        ],
      }),
      "host-hook-channel",
    ),
    ["pass", null],
  );
  // 损坏码优先于提示码：当前宿主模式不对或有读不出的记录时不再报 absent / records-0。
  deepEqual(
    verdictOf(
      healthyFacts({
        hooks: [
          {
            hostId: "codex",
            current: true,
            status: "observed",
            directory: "mode",
            records: 0,
            skipped: 0,
          },
        ],
      }),
      "host-hook-channel",
    ),
    ["fail", "codex:mode"],
  );
  deepEqual(
    verdictOf(
      healthyFacts({
        hooks: [
          {
            hostId: "codex",
            current: true,
            status: "observed",
            directory: "private",
            records: 0,
            skipped: 2,
          },
        ],
      }),
      "host-hook-channel",
    ),
    ["fail", "codex:skipped-2"],
  );

  // 未登记不是损坏：pass 并在 code 报计数；未观察才 unavailable。
  deepEqual(
    verdictOf(
      healthyFacts({
        windows: [
          { windowId: WINDOW_A, identity: "registered" },
          { windowId: WINDOW_B, identity: "unregistered" },
        ],
      }),
      "window-identity",
    ),
    ["pass", "unregistered:1"],
  );
  deepEqual(
    verdictOf(
      healthyFacts({ windows: [{ windowId: WINDOW_A, identity: "unobserved" }] }),
      "window-identity",
    ),
    ["unavailable", "unobserved:1"],
  );

  deepEqual(
    verdictOf(
      healthyFacts({
        assets: [
          { hostId: "codex", status: "not-applicable", settings: "not-applicable" },
          { hostId: "claude-code", status: "drift", settings: "current" },
        ],
      }),
      "host-settings-assets",
    ),
    ["fail", "claude-code:drift"],
  );
  deepEqual(
    verdictOf(
      healthyFacts({
        assets: [{ hostId: "claude-code", status: "unavailable", settings: "current" }],
      }),
      "host-settings-assets",
    ),
    ["unavailable", "claude-code:unavailable"],
  );
  // 本地设置条目各一票：缺文件与条目不等为 fail，不是 JSON 对象为 unavailable（§13.94 D6）。
  deepEqual(
    verdictOf(
      healthyFacts({ assets: [{ hostId: "claude-code", status: "current", settings: "missing" }] }),
      "host-settings-assets",
    ),
    ["fail", "claude-code:settings-missing"],
  );
  deepEqual(
    verdictOf(
      healthyFacts({ assets: [{ hostId: "claude-code", status: "drift", settings: "drift" }] }),
      "host-settings-assets",
    ),
    ["fail", "claude-code:drift,claude-code:settings-drift"],
  );
  deepEqual(
    verdictOf(
      healthyFacts({
        assets: [{ hostId: "claude-code", status: "current", settings: "unreadable" }],
      }),
      "host-settings-assets",
    ),
    ["unavailable", "claude-code:settings-unreadable"],
  );
});

test("pod-execution-location：ready 的 worktree pod 缺回执或检出即 fail；creating 只报 pending-registration 且不失败；closing 的 pod 检出仍在只报 disposal-pending；primary 仓库根未观察为 unavailable、不是主检出为 fail", () => {
  // §13.94 D3 把回执要求限定在 ready：creating 的 pod 还没登记窗口，回执缺席是过渡态，
  // 只有窗口登记能解决，不该把 verify 的 next 指向工作区维护。
  const creating = healthyFacts({
    pods: [
      { podId: POD_MAIN, placement: "primary", lifecycle: "open", state: "ready", worktrees: [] },
      {
        podId: POD_FEATURE,
        placement: "worktree",
        lifecycle: "open",
        state: "creating",
        worktrees: [{ repositoryId: REPOSITORY, receipt: "absent" }],
      },
    ],
  });
  deepEqual(verdictOf(creating, "pod-execution-location"), [
    "pass",
    `${POD_FEATURE}:${REPOSITORY}:pending-registration`,
  ]);
  const openMissing = healthyFacts({
    pods: [
      { podId: POD_MAIN, placement: "primary", lifecycle: "open", state: "ready", worktrees: [] },
      {
        podId: POD_FEATURE,
        placement: "worktree",
        lifecycle: "open",
        state: "ready",
        worktrees: [{ repositoryId: REPOSITORY, receipt: "absent" }],
      },
    ],
  });
  deepEqual(verdictOf(openMissing, "pod-execution-location"), [
    "fail",
    `${POD_FEATURE}:${REPOSITORY}:absent`,
  ]);
  const openLost = healthyFacts({
    pods: [
      {
        podId: POD_FEATURE,
        placement: "worktree",
        lifecycle: "open",
        state: "ready",
        worktrees: [{ repositoryId: REPOSITORY, receipt: "checkout-missing" }],
      },
    ],
  });
  deepEqual(verdictOf(openLost, "pod-execution-location"), [
    "fail",
    `${POD_FEATURE}:${REPOSITORY}:checkout-missing`,
  ]);
  const closingPresent = healthyFacts({
    pods: [
      {
        podId: POD_FEATURE,
        placement: "worktree",
        lifecycle: "closing",
        state: "closing",
        worktrees: [{ repositoryId: REPOSITORY, receipt: "present" }],
      },
    ],
  });
  deepEqual(verdictOf(closingPresent, "pod-execution-location"), [
    "pass",
    `${POD_FEATURE}:${REPOSITORY}:disposal-pending`,
  ]);
  deepEqual(verdictOf(healthyFacts({ primaryCheckouts: null }), "pod-execution-location"), [
    "unavailable",
    null,
  ]);
  deepEqual(verdictOf(healthyFacts({ primaryCheckouts: false }), "pod-execution-location"), [
    "fail",
    `${POD_MAIN}:main-checkout`,
  ]);
  const unobserved = healthyFacts({
    pods: [
      {
        podId: POD_MAIN,
        placement: "primary",
        lifecycle: "open",
        state: "unobserved",
        worktrees: [],
      },
    ],
  });
  deepEqual(verdictOf(unobserved, "pod-execution-location"), ["unavailable", null]);
});

test("active-projection 门：stale 或 missing 为 fail，手写目标 pass 并报 handwritten（同轮被挡的兄弟计数在 code），其他 unsafe 为 fail，未观察为 unavailable", () => {
  const target = (status: "current" | "missing" | "stale" | "unsafe", reason: string | null) => ({
    resourcePath: WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF,
    status,
    reason,
    digest: status === "missing" ? null : digest(status),
  });
  const withTargets = (...targets: readonly ReturnType<typeof target>[]) =>
    healthyFacts({ projection: { status: "observed", targets } });
  deepEqual(
    verdictOf(withTargets(target("stale", null), target("missing", null)), "active-projection"),
    ["fail", "stale,missing"],
  );
  deepEqual(verdictOf(withTargets(target("unsafe", "handwritten")), "active-projection"), [
    "pass",
    "handwritten",
  ]);
  deepEqual(
    verdictOf(
      withTargets(target("unsafe", "handwritten"), target("stale", null)),
      "active-projection",
    ),
    ["pass", "handwritten,blocked:1"],
  );
  deepEqual(verdictOf(withTargets(target("unsafe", "symlink")), "active-projection"), [
    "fail",
    "unsafe-symlink",
  ]);
  deepEqual(
    verdictOf(
      healthyFacts({ projection: { status: "unavailable", targets: [] } }),
      "active-projection",
    ),
    ["unavailable", "unavailable"],
  );
  equal(
    gateOf(deriveWorkspaceGates(withTargets(target("missing", null))), "active-projection").evidence
      .length,
    0,
  );
});

test("summarizeGates：至少一门且全部 pass 才 ok；unavailable 分开计数；verifyNext 列出未通过的门并指向维护；projectionFreshness 取最坏目标", () => {
  deepEqual(summarizeGates([]), { ok: false, summary: { pass: 0, fail: 0, unavailable: 0 } });
  deepEqual(summarizeGates([{ status: "pass" }, { status: "unavailable" }, { status: "fail" }]), {
    ok: false,
    summary: { pass: 1, fail: 1, unavailable: 1 },
  });
  const gates = deriveWorkspaceGates(
    healthyFacts({ configRecheck: "changed", ledger: "unavailable" }),
  );
  deepEqual(summarizeGates(gates), { ok: false, summary: { pass: 12, fail: 1, unavailable: 1 } });
  deepEqual(verifyNext(gates), {
    frontier: "workspace-maintenance",
    owner: "controller",
    suggestedTool: "wakeflow_maintain_workspace",
    blockers: ["config-authority:fail", "ledger-layout:unavailable"],
  });

  equal(projectionFreshness(null), "unavailable");
  equal(projectionFreshness([]), "current");
  equal(projectionFreshness([{ status: "current" }, { status: "stale" }]), "stale");
  equal(projectionFreshness([{ status: "stale" }, { status: "missing" }]), "missing");
  equal(projectionFreshness([{ status: "missing" }, { status: "unsafe" }]), "unsafe");
});

/** wire 的 `code` 模式取自生成的 verify Schema，测试与 Schema 不各写一份。 */
function schemaCodePattern(): RegExp {
  const defs = WAKEFLOW_VERIFY_RESULT_SCHEMA.$defs;
  const code = (defs as Readonly<Record<string, unknown>>).code;
  const pattern = (code as Readonly<Record<string, unknown>>).pattern;
  if (typeof pattern !== "string") throw new Error("verify Schema lacks $defs.code.pattern");
  return new RegExp(pattern, "u");
}

const CODE_PATTERN = schemaCodePattern();

function longDemandIds(count: number): readonly string[] {
  return Array.from(
    { length: count },
    (_unused, index) => `demand_${index.toString(16).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
  );
}

test("code 截断：收尾串仍在 wire 的 code 字符集内，整串不超过 256，一条都放不下时也能自己起头", () => {
  const [status, code] = verdictOf(
    healthyFacts({
      board: {
        status: "observed",
        skipped: 0,
        indexCurrent: true,
        claimedWithoutRoot: longDemandIds(6),
      },
    }),
    "board-consistency",
  );
  equal(status, "fail");
  if (code === null) throw new Error("board-consistency lost its code");
  equal(code.length <= 256, true, `code is ${code.length} characters long`);
  equal(CODE_PATTERN.test(code), true, `code ${code} is outside the wire pattern`);
  equal(code.endsWith(",more-3"), true, code);

  // 第一条就放不下：收尾串独占整个 code，首字符仍须是字母数字。
  const [, only] = verdictOf(
    healthyFacts({
      board: {
        status: "observed",
        skipped: 0,
        indexCurrent: true,
        claimedWithoutRoot: [`demand_${"a".repeat(250)}`],
      },
    }),
    "board-consistency",
  );
  equal(only, "more-1");
  if (only === null) throw new Error("board-consistency lost its code");
  equal(CODE_PATTERN.test(only), true, `code ${only} is outside the wire pattern`);
});

test("active-projection 门的证据只收两份工作区页：每 Demand 两份投影页不进证据，33 个活动 Demand 也不越过 wire 的 64 条上限", () => {
  const workspacePages = [
    {
      resourcePath: WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF,
      status: "current" as const,
      reason: null,
      digest: digest("index"),
    },
    {
      resourcePath: WAKEFLOW_ACTIVE_WORKSPACE_STATUS_REF,
      status: "current" as const,
      reason: null,
      digest: digest("status"),
    },
  ];
  const demandPages = longDemandIds(33).flatMap((demandId) =>
    ["index.md", "developer-progress.md"].map((name) => ({
      resourcePath: parsePortableResourcePath(
        `.wakeflow-active/current/${demandId}/${name}`,
        "$target",
      ),
      status: "current" as const,
      reason: null,
      digest: digest(`${demandId}/${name}`),
    })),
  );
  const gates = deriveWorkspaceGates(
    healthyFacts({
      projection: { status: "observed", targets: [...workspacePages, ...demandPages] },
    }),
  );
  const evidence = gateOf(gates, "active-projection").evidence;
  equal(evidence.length <= 64, true, `evidence has ${evidence.length} entries`);
  deepEqual(
    evidence.map((entry) => entry.ref),
    [WAKEFLOW_ACTIVE_WORKSPACE_INDEX_REF, WAKEFLOW_ACTIVE_WORKSPACE_STATUS_REF],
  );
  deepEqual(
    verdictOf(
      healthyFacts({
        projection: { status: "observed", targets: [...workspacePages, ...demandPages] },
      }),
      "active-projection",
    ),
    ["pass", null],
  );
});

test("域读不出：demands、claims、pods 的空列表不当成事实，依赖它们的门是 unavailable 并带域 issue，需要活动 Demand 集合的交叉检查不做", () => {
  const demandsDown = healthyFacts({
    domains: {
      demands: { status: "unavailable", issue: "demands:not-directory" },
      claims: OBSERVED,
      pods: OBSERVED,
    },
  });
  for (const name of [
    "demand-root-audit",
    "append-candidates-clear",
    "evidence-integrity",
    "board-consistency",
    "work-claims",
  ]) {
    deepEqual(verdictOf(demandsDown, name), ["unavailable", "demands:not-directory"], name);
  }
  equal(summarizeGates(deriveWorkspaceGates(demandsDown)).ok, false);

  const claimsDown = healthyFacts({
    domains: {
      demands: OBSERVED,
      claims: { status: "unavailable", issue: "claims:not-directory" },
      pods: OBSERVED,
    },
    claims: [],
  });
  deepEqual(verdictOf(claimsDown, "work-claims"), ["unavailable", "claims:not-directory"]);

  const podsDown = healthyFacts({
    domains: {
      demands: OBSERVED,
      claims: OBSERVED,
      pods: { status: "unavailable", issue: "pods:receipt-listing-not-directory" },
    },
    pods: [],
  });
  deepEqual(verdictOf(podsDown, "pod-execution-location"), [
    "unavailable",
    "pods:receipt-listing-not-directory",
  ]);

  // issue 缺失时仍给得出一个合法的 code。
  const noIssue = healthyFacts({
    domains: { demands: OBSERVED, claims: OBSERVED, pods: { status: "unavailable", issue: null } },
    pods: [],
  });
  deepEqual(verdictOf(noIssue, "pod-execution-location"), ["unavailable", "pods:unavailable"]);
});

test("status 列表上限：超出上限的条目被确定性截断并报出略去的条数，未超出时原样保留", () => {
  const maximum = STATUS_LIST_MAXIMUMS.unmergedAccepted;
  const overflowing = Array.from({ length: maximum + 1 }, (_unused, index) => index);
  const truncated = capStatusList(overflowing, maximum);
  equal(truncated.entries.length, maximum);
  equal(truncated.omitted, 1);
  equal(truncated.entries[0], 0);
  equal(truncated.entries[maximum - 1], maximum - 1);

  const kept = capStatusList([1, 2, 3], maximum);
  deepEqual([...kept.entries], [1, 2, 3]);
  equal(kept.omitted, 0);
  deepEqual([STATUS_LIST_MAXIMUMS.claims, STATUS_LIST_MAXIMUMS.worktrees], [512, 64]);
});

test("window-runtime-projection：每个宿主的每个窗口投影都与重算一致才 pass；stale / missing / unsafe 逐窗口报出，宿主读不出即 unavailable（G6，§13.111）", () => {
  deepEqual(verdictOf(healthyFacts(), "window-runtime-projection"), ["pass", null]);
  const drifted = healthyFacts({
    windowRuntime: [
      {
        hostId: "codex",
        status: "observed",
        issue: null,
        windows: [
          { windowId: WINDOW_A, status: "stale" },
          { windowId: WINDOW_B, status: "current" },
        ],
      },
      {
        hostId: "claude-code",
        status: "observed",
        issue: null,
        windows: [
          { windowId: WINDOW_A, status: "missing" },
          { windowId: WINDOW_B, status: "unsafe" },
        ],
      },
    ],
  });
  deepEqual(verdictOf(drifted, "window-runtime-projection"), [
    "fail",
    `codex:${WINDOW_A}:stale,claude-code:${WINDOW_A}:missing,claude-code:${WINDOW_B}:unsafe`,
  ]);
  // 一个宿主读不出而另一个宿主有过期窗口：fail 压过 unavailable（同其他门的聚合规则），两者都在 code 里。
  const unavailable = healthyFacts({
    windowRuntime: [
      {
        hostId: "codex",
        status: "observed",
        issue: null,
        windows: [{ windowId: WINDOW_A, status: "stale" }],
      },
      { hostId: "claude-code", status: "unavailable", issue: "runtime-missing", windows: [] },
    ],
  });
  deepEqual(verdictOf(unavailable, "window-runtime-projection"), [
    "fail",
    `codex:${WINDOW_A}:stale,claude-code:runtime-missing`,
  ]);
  deepEqual(
    verdictOf(
      healthyFacts({
        windowRuntime: [
          { hostId: "claude-code", status: "unavailable", issue: "runtime-missing", windows: [] },
        ],
      }),
      "window-runtime-projection",
    ),
    ["unavailable", "claude-code:runtime-missing"],
  );
});
