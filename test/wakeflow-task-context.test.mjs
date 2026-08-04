#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runSync } from "../plugins/codex-wakeflow/lib/wakeflow-process.mjs";
import { handlers, tools } from "../plugins/codex-wakeflow/lib/wakeflow-mcp-tools.mjs";
import {
  taskPackageDigest,
  taskPackageReadiness,
} from "../core/scripts/lib/wakeflow-task-package.mjs";
import { createWindowRuntime } from "../core/scripts/lib/wakeflow-window-runtime.mjs";

const pluginRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../plugins/codex-wakeflow");
const stateScript = path.join(pluginRoot, "scripts/wakeflow-state.mjs");
const deliveryScript = path.join(pluginRoot, "scripts/wakeflow-delivery.mjs");

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function run(script, root, args) {
  return runSync(process.execPath, [script, ...args, "--root", root, "--json"], {
    cwd: root,
    encoding: "utf8",
  });
}

function parseOk(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function makeFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-task-context-"));
  writeFileSync(path.join(root, "AGENTS.md"), "# Workspace instructions\n");
  for (const repository of ["product", "bad-target"]) {
    mkdirSync(path.join(root, repository), { recursive: true });
    writeFileSync(path.join(root, repository, "AGENTS.md"), `# ${repository}\n`);
  }
  mkdirSync(path.join(root, "docs"), { recursive: true });
  writeFileSync(
    path.join(root, "docs/requirement.md"),
    [
      "# Requirement",
      "",
      "## Goal",
      "",
      "Keep the public behavior stable while fixing the confirmed defect.",
      "",
      "## Completion",
      "",
      "The regression and focused validation pass.",
      "",
    ].join("\n"),
  );
  writeJson(path.join(root, "wakeflow.config.json"), {
    workspaceName: "Task Context Fixture",
    controllerWindow: "Controller",
    projectLedgerRoot: "wakeflow-ledger",
    repositories: [
      { windowName: "Controller", path: ".", role: "controller" },
      { windowName: "Product", path: "product", role: "product" },
      { windowName: "BadTarget", path: "bad-target", role: "product" },
    ],
  });
  const initialized = parseOk(run(stateScript, root, [
    "init",
    "--demand-key", "CTX-1",
    "--title", "Task context",
    "--write",
  ]));
  return { root, stateRoot: initialized.stateRoot };
}

function fullContextArgs(overrides = {}) {
  const context = {
    workType: "implementation",
    objective: "Fix the confirmed public-entry defect without widening product scope.",
    contextSummary: [
      "The controller reproduced the defect through the public entry.",
      "The target owns only the Product repository implementation.",
    ],
    requirementRefs: [
      { ref: "docs/requirement.md#goal", role: "goal" },
      { ref: "docs/requirement.md#completion", role: "completion" },
    ],
    boundaries: {
      inScope: ["Product public-entry implementation and its focused regression."],
      outOfScope: ["Other repositories and release work."],
      forbidden: ["Do not replace the confirmed requirement with a new design."],
    },
    completionExpectations: [
      "The focused regression fails before the fix and passes after it.",
      "The repository validation for changed code passes.",
      "The target result cites the exact regression evidence.",
    ],
    dependsOnTaskIds: [],
    commitExpectation: "leave-uncommitted",
    acceptanceAnchors: [{
      id: "AC-CTX-1",
      claim: "The public entry preserves the confirmed behavior.",
      probe: "Run the focused public-entry regression before and after the change.",
      expected: "It fails before the implementation and passes after it.",
    }],
    ...overrides,
  };
  return [
    "--work-type", context.workType,
    "--objective", context.objective,
    "--context-summary", JSON.stringify(context.contextSummary),
    "--requirement-refs", JSON.stringify(context.requirementRefs),
    "--boundaries", JSON.stringify(context.boundaries),
    "--completion-expectations", JSON.stringify(context.completionExpectations),
    "--depends-on-task-ids", JSON.stringify(context.dependsOnTaskIds),
    "--commit-expectation", context.commitExpectation,
    ...(context.acceptanceAnchors
      ? ["--acceptance-anchors", JSON.stringify(context.acceptanceAnchors)]
      : []),
  ];
}

test("core target prompt keeps one priority context and one critical boundary with navigation", () => {
  const workspaceRoot = "/tmp/wakeflow-prompt-workspace";
  const stateRoot = path.join(workspaceRoot, ".wakeflow-active/current/CTX-1");
  const repositoryRoot = path.join(workspaceRoot, "product");
  const runtime = createWindowRuntime({
    workspaceRoot,
    fail(message) {
      throw new Error(message);
    },
  });
  const prompt = runtime.formatTargetPrompt({
    targetWindow: "Product",
    taskId: "CTX-T1",
    dispatchGroup: "CTX-G1",
    stateRef: {
      stateRoot: ".wakeflow-active/current/CTX-1",
      taskPackageId: "CTX-P1",
      stateRevision: 4,
    },
    taskBriefing: {
      objective: "Fix the confirmed defect without widening scope.",
      completionExpectations: ["The regression passes.", "Repository validation passes.", "Evidence is cited."],
      contextSummary: ["The controller reproduced the defect.", "A lower-priority implementation note."],
      requirementRefs: [
          { role: "completion", ref: "docs/requirement.md#completion", resolvedRef: `${workspaceRoot}/docs/requirement.md#completion` },
          { role: "goal", ref: "docs/requirement.md#goal", resolvedRef: `${workspaceRoot}/docs/requirement.md#goal` },
      ],
      boundaries: {
        inScope: ["Product implementation."],
        outOfScope: ["Release work."],
        forbidden: ["Do not redesign the confirmed requirement.", "Do not touch another repository."],
      },
      requiredSkills: ["skills/wakeflow-target/SKILL.md"],
      workspaceRoot,
      repositoryRoot,
      stateRoot,
      taskPackageRef: path.join(stateRoot, "task-packages/CTX-P1.json"),
    },
  });

  assert.match(prompt, /Priority context: The controller reproduced the defect\./);
  assert.doesNotMatch(prompt, /A lower-priority implementation note\./);
  assert.match(prompt, /Critical boundary \[forbidden\]: Do not redesign the confirmed requirement\./);
  assert.doesNotMatch(prompt, /Do not touch another repository\./);
  assert.doesNotMatch(prompt, /Product implementation\./);
  assert.doesNotMatch(prompt, /Release work\./);
  assert.match(prompt, new RegExp(`Workspace instructions: ${workspaceRoot}/AGENTS\\.md`));
  assert.match(prompt, new RegExp(`Current state root: ${stateRoot}`));
  assert.match(prompt, /Requirement background entry .*\[goal\]: .*#goal/);
  assert.doesNotMatch(prompt, /Requirement background entry .*\[completion\]/);
  assert.ok(
    prompt.split("\n").filter(Boolean).length <= 33,
    "the core wakeup prompt stays compact while surfacing only priority navigation",
  );
});

test("core target prompt falls back from forbidden to out-of-scope and then in-scope", () => {
  const workspaceRoot = "/tmp/wakeflow-prompt-boundary";
  const runtime = createWindowRuntime({
    workspaceRoot,
    fail(message) {
      throw new Error(message);
    },
  });
  const base = {
    targetWindow: "Product",
    taskId: "CTX-T1",
    dispatchGroup: "CTX-G1",
    stateRef: {
      stateRoot: ".wakeflow-active/current/CTX-1",
      taskPackageId: "CTX-P1",
      stateRevision: 4,
    },
  };
  const outOfScopePrompt = runtime.formatTargetPrompt({
    ...base,
    taskBriefing: {
      objective: "Keep scope stable.",
      boundaries: { inScope: ["Product implementation."], outOfScope: ["Release work."], forbidden: [] },
    },
  });
  assert.match(outOfScopePrompt, /Critical boundary \[outOfScope\]: Release work\./);
  assert.doesNotMatch(outOfScopePrompt, /Critical boundary \[inScope\]/);

  const inScopePrompt = runtime.formatTargetPrompt({
    ...base,
    taskBriefing: {
      objective: "Keep scope stable.",
      boundaries: { inScope: ["Product implementation."], outOfScope: [], forbidden: [] },
    },
  });
  assert.match(inScopePrompt, /Critical boundary \[inScope\]: Product implementation\./);
});

test("full-context package is the dispatch authority and target prepare is preview-first", () => {
  const { root, stateRoot } = makeFixture();
  try {
    const added = parseOk(run(stateScript, root, [
      "add-task-package",
      "--state-root", stateRoot,
      "--task-package-id", "CTX-P1",
      "--summary", "Repair the confirmed defect",
      "--target-window", "Product",
      "--target-task-id", "CTX-T1",
      ...fullContextArgs(),
      "--write",
    ]));
    assert.equal(added.wrote, true);

    const packageFile = path.join(root, stateRoot, "task-packages/CTX-P1.json");
    const taskPackage = JSON.parse(readFileSync(packageFile, "utf8"));
    assert.equal(taskPackage.contextVersion, 1);
    assert.equal(taskPackage.objective, "Fix the confirmed public-entry defect without widening product scope.");
    assert.equal(taskPackage.requirementRefs[0].ref, "docs/requirement.md#goal");
    assert.equal(taskPackage.contextSummary.length, 2);
    assert.equal(taskPackage.completionExpectations.length, 3);
    assert.equal(taskPackage.boundaries.forbidden.length, 1);
    assert.deepEqual(taskPackage.dependsOnTaskIds, []);

    parseOk(run(deliveryScript, root, [
      "register-thread",
      "--window", "Product",
      "--thread-id", "0192fac-product-initial",
      "--write",
    ]));

    const preview = parseOk(run(deliveryScript, root, [
      "prepare-dispatch-from-state",
      "--state-root", stateRoot,
      "--target-task-id", "CTX-T1",
      "--group", "CTX-G1",
    ]));
    assert.equal(preview.preview, true);
    assert.equal(preview.wrote, false);
    assert.equal(preview.readiness.ready, true);
    assert.equal(preview.readiness.mode, "full-context");
    assert.equal(preview.packet.resultContract, "target-result-envelope-v2");
    assert.match(preview.previewDigest, /^[a-f0-9]{64}$/);
    assert.equal(preview.taskBriefing.taskPackageRef, packageFile);
    assert.equal(preview.taskBriefing.repositoryRoot, path.join(root, "product"));
    assert.match(preview.packet.prompt, /Current objective \(the task package is authoritative\):/);
    assert.match(preview.packet.prompt, /Completion focus \(full criteria are in the task package\):/);
    assert.match(preview.packet.prompt, /The focused regression fails before the fix and passes after it\./);
    assert.match(preview.packet.prompt, /The repository validation for changed code passes\./);
    assert.doesNotMatch(preview.packet.prompt, /The target result cites the exact regression evidence\./);
    assert.match(preview.packet.prompt, /Task package \(complete task context\): .*CTX-P1\.json/);
    assert.match(preview.packet.prompt, /Requirement background entry \(full anchors are in the task package\) \[goal\]: .*\/docs\/requirement\.md#goal/);
    assert.doesNotMatch(preview.packet.prompt, /Requirement background entry .*\[completion\]/);
    assert.match(preview.packet.prompt, /Required execution Skills[\s\S]*wakeflow-target-craft\/SKILL\.md/);
    assert.match(preview.packet.prompt, /Identity \(full boundaries are in the task package\):/);
    assert.match(preview.packet.prompt, /Only working repository: .*\/product/);
    assert.match(preview.packet.prompt, /Priority context: The controller reproduced the defect through the public entry\./);
    assert.doesNotMatch(preview.packet.prompt, /The target owns only the Product repository implementation\./);
    assert.match(preview.packet.prompt, /Critical boundary \[forbidden\]: Do not replace the confirmed requirement with a new design\./);
    assert.doesNotMatch(preview.packet.prompt, /Product public-entry implementation and its focused regression\./);
    assert.doesNotMatch(preview.packet.prompt, /Other repositories and release work\./);
    assert.match(preview.packet.prompt, new RegExp(`Workspace instructions: ${root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/AGENTS\\.md`));
    assert.match(preview.packet.prompt, /Current state root: .*\/\.wakeflow-active\/current\/CTX-1/);
    assert.doesNotMatch(preview.packet.prompt, /Leave this task's changes uncommitted/);
    assert.doesNotMatch(preview.packet.prompt, /Authority by purpose:/);
    assert.doesNotMatch(preview.packet.prompt, /\nVariables:/);
    assert.ok(
      preview.packet.prompt.split("\n").filter(Boolean).length <= 33,
      "the wakeup prompt stays compact while the package retains complete context",
    );

    const override = run(deliveryScript, root, [
      "prepare-dispatch-from-state",
      "--state-root", stateRoot,
      "--target-task-id", "CTX-T1",
      "--group", "CTX-G1",
      "--objective", "Replace the package objective",
    ]);
    assert.notEqual(override.status, 0);
    assert.match(override.stdout, /full-context task packages own objective/);

    const originalPackage = readFileSync(packageFile, "utf8");
    writeJson(packageFile, {
      ...taskPackage,
      objective: "A task-package edit that the controller has not previewed.",
    });
    const changedAfterPreview = run(deliveryScript, root, [
      "prepare-dispatch-from-state",
      "--state-root", stateRoot,
      "--target-task-id", "CTX-T1",
      "--group", "CTX-G1",
      "--expected-preview-digest", preview.previewDigest,
      "--write",
    ]);
    assert.notEqual(changedAfterPreview.status, 0);
    assert.match(changedAfterPreview.stdout, /changed after preview/);
    writeFileSync(packageFile, originalPackage);

    const configFile = path.join(root, "wakeflow.config.json");
    const originalConfig = readFileSync(configFile, "utf8");
    const changedConfig = JSON.parse(originalConfig);
    changedConfig.repositories.find((item) => item.windowName === "Product").path = "bad-target";
    writeJson(configFile, changedConfig);
    const changedRepositoryAfterPreview = run(deliveryScript, root, [
      "prepare-dispatch-from-state",
      "--state-root", stateRoot,
      "--target-task-id", "CTX-T1",
      "--group", "CTX-G1",
      "--expected-preview-digest", preview.previewDigest,
      "--write",
    ]);
    assert.notEqual(changedRepositoryAfterPreview.status, 0);
    assert.match(changedRepositoryAfterPreview.stdout, /changed after preview/);
    writeFileSync(configFile, originalConfig);

    parseOk(run(deliveryScript, root, [
      "register-thread",
      "--window", "Product",
      "--thread-id", "0192fac-product-rebound",
      "--write",
    ]));
    const staleBindingPreview = run(deliveryScript, root, [
      "prepare-dispatch-from-state",
      "--state-root", stateRoot,
      "--target-task-id", "CTX-T1",
      "--group", "CTX-G1",
      "--expected-preview-digest", preview.previewDigest,
      "--write",
    ]);
    assert.notEqual(staleBindingPreview.status, 0);
    assert.match(staleBindingPreview.stdout, /changed after preview/);

    const reboundPreview = parseOk(run(deliveryScript, root, [
      "prepare-dispatch-from-state",
      "--state-root", stateRoot,
      "--target-task-id", "CTX-T1",
      "--group", "CTX-G1",
    ]));
    assert.notEqual(reboundPreview.previewDigest, preview.previewDigest);

    const applied = parseOk(run(deliveryScript, root, [
      "prepare-dispatch-from-state",
      "--state-root", stateRoot,
      "--target-task-id", "CTX-T1",
      "--group", "CTX-G1",
      "--expected-preview-digest", reboundPreview.previewDigest,
      "--write",
    ]));
    assert.equal(applied.preview, false);
    assert.equal(applied.wrote, true);
    assert.equal(applied.packet.prompt, reboundPreview.packet.prompt);
    assert.equal(applied.packet.taskPackageDigest, reboundPreview.readiness.taskPackageDigest);
    assert.equal(existsSync(path.join(root, applied.packetFile)), true);
    assert.equal(existsSync(path.join(root, applied.deliveryFile)), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readiness fails closed on missing requirement anchors and unaccepted dependencies", () => {
  const { root, stateRoot } = makeFixture();
  try {
    const state = {
      targetTasks: [
        { targetTaskId: "UPSTREAM", status: "sent" },
        { targetTaskId: "DOWNSTREAM", status: "pending" },
      ],
    };
    const targetTask = state.targetTasks[1];
    const packageRecord = {
      taskPackageId: "DOWNSTREAM-PKG",
      demandKey: "CTX-1",
      summary: "Downstream",
      contextVersion: 1,
      workType: "documentation",
      objective: "Document the accepted upstream contract.",
      contextSummary: ["The document depends on the accepted upstream shape."],
      requirementRefs: [{ ref: "docs/requirement.md#goal", role: "goal" }],
      boundaries: { inScope: ["Contract docs."], outOfScope: [], forbidden: [] },
      completionExpectations: ["The contract document matches the accepted upstream result."],
      dependsOnTaskIds: ["UPSTREAM"],
      commitExpectation: "leave-uncommitted",
      targetTasks: [],
    };
    const blocked = taskPackageReadiness({
      taskPackage: packageRecord,
      state,
      targetTask,
      workspaceRoot: root,
      repositoryRoot: path.join(root, "product"),
    });
    assert.equal(blocked.ready, false);
    assert.match(blocked.errors.join("\n"), /dependency target task is not accepted: UPSTREAM:sent/);

    state.targetTasks[0].status = "accepted";
    const ready = taskPackageReadiness({
      taskPackage: packageRecord,
      state,
      targetTask,
      workspaceRoot: root,
      repositoryRoot: path.join(root, "product"),
    });
    assert.equal(ready.ready, true);

    packageRecord.requirementRefs = [{ ref: "docs/requirement.md#completion", role: "completion" }];
    const missingGoal = taskPackageReadiness({
      taskPackage: packageRecord,
      state,
      targetTask,
      workspaceRoot: root,
      repositoryRoot: path.join(root, "product"),
    });
    assert.equal(missingGoal.ready, false);
    assert.match(missingGoal.errors.join("\n"), /requirementRefs must include at least one role=goal entry/);

    packageRecord.requirementRefs = [{ ref: "docs/requirement.md#missing-section", role: "goal" }];
    const missingAnchor = taskPackageReadiness({
      taskPackage: packageRecord,
      state,
      targetTask,
      workspaceRoot: root,
      repositoryRoot: path.join(root, "product"),
    });
    assert.equal(missingAnchor.ready, false);
    assert.match(missingAnchor.errors.join("\n"), /requirement reference section was not found/);

    const legacy = taskPackageReadiness({
      taskPackage: {
        taskPackageId: "LEGACY",
        demandKey: "CTX-1",
        summary: "Legacy task package",
        sourceRef: "docs/requirement.md#completion",
      },
      state,
      targetTask,
      workspaceRoot: root,
      repositoryRoot: path.join(root, "product"),
    });
    assert.equal(legacy.ready, true);
    assert.equal(legacy.mode, "legacy-compatible");

    const missingImplementationAnchors = run(stateScript, root, [
      "add-task-package",
      "--state-root", stateRoot,
      "--task-package-id", "NO-ANCHOR",
      "--summary", "Missing anchor",
      "--target-window", "BadTarget",
      "--target-task-id", "NO-ANCHOR-T1",
      ...fullContextArgs({ acceptanceAnchors: null }),
      "--write",
    ]);
    assert.notEqual(missingImplementationAnchors.status, 0);
    assert.match(missingImplementationAnchors.stdout, /implementation task packages require at least one controller-authored acceptanceAnchor/);

    const stateBeforeBadRef = JSON.parse(readFileSync(path.join(root, stateRoot, "wakeflow-state.json"), "utf8"));
    const missingRequirementAnchor = run(stateScript, root, [
      "add-task-package",
      "--state-root", stateRoot,
      "--task-package-id", "NO-REF-ANCHOR",
      "--summary", "Missing requirement section",
      "--target-window", "Product",
      "--target-task-id", "NO-REF-ANCHOR-T1",
      ...fullContextArgs({
        workType: "research",
        requirementRefs: [{ ref: "docs/requirement.md", role: "goal" }],
      }),
      "--write",
    ]);
    assert.notEqual(missingRequirementAnchor.status, 0);
    assert.match(missingRequirementAnchor.stdout, /role=goal must name a document section with #anchor/);
    assert.equal(
      existsSync(path.join(root, stateRoot, "task-packages/NO-REF-ANCHOR.json")),
      false,
      "invalid static requirement anchors must fail before creating an immutable task package",
    );
    assert.equal(
      JSON.parse(readFileSync(path.join(root, stateRoot, "wakeflow-state.json"), "utf8")).revision,
      stateBeforeBadRef.revision,
      "invalid task-package context must not advance controller state",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("task-package creation rejects requirement refs that escape through traversal or symlinks", () => {
  const { root, stateRoot } = makeFixture();
  const outside = mkdtempSync(path.join(os.tmpdir(), "wakeflow-task-context-outside-"));
  try {
    const outsideRequirement = path.join(outside, "requirement.md");
    writeFileSync(outsideRequirement, "# External Requirement\n\n## Goal\n\nOutside the workspace.\n");
    const relativeEscape = `${path.relative(root, outsideRequirement).split(path.sep).join("/")}#goal`;
    const stateFile = path.join(root, stateRoot, "wakeflow-state.json");
    const initialRevision = JSON.parse(readFileSync(stateFile, "utf8")).revision;

    const traversal = run(stateScript, root, [
      "add-task-package",
      "--state-root", stateRoot,
      "--task-package-id", "ESCAPE-P1",
      "--summary", "Traversal escape",
      "--target-window", "Product",
      "--target-task-id", "ESCAPE-T1",
      ...fullContextArgs({
        workType: "research",
        requirementRefs: [{ ref: relativeEscape, role: "goal" }],
      }),
      "--write",
    ]);
    assert.notEqual(traversal.status, 0);
    assert.match(traversal.stdout, /must stay inside the workspace root/);
    assert.equal(existsSync(path.join(root, stateRoot, "task-packages/ESCAPE-P1.json")), false);
    assert.equal(JSON.parse(readFileSync(stateFile, "utf8")).revision, initialRevision);

    symlinkSync(outsideRequirement, path.join(root, "docs/external-requirement.md"));
    const symlinkEscape = run(stateScript, root, [
      "add-task-package",
      "--state-root", stateRoot,
      "--task-package-id", "SYMLINK-P1",
      "--summary", "Symlink escape",
      "--target-window", "Product",
      "--target-task-id", "SYMLINK-T1",
      ...fullContextArgs({
        workType: "research",
        requirementRefs: [{ ref: "docs/external-requirement.md#goal", role: "goal" }],
      }),
      "--write",
    ]);
    assert.notEqual(symlinkEscape.status, 0);
    assert.match(symlinkEscape.stdout, /resolves outside the workspace root/);
    assert.equal(existsSync(path.join(root, stateRoot, "task-packages/SYMLINK-P1.json")), false);
    assert.equal(JSON.parse(readFileSync(stateFile, "utf8")).revision, initialRevision);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("MCP surface requires structured task context and exposes target apply", () => {
  const addTask = tools.find((tool) => tool.name === "wakeflow_add_task");
  const continueDemand = tools.find((tool) => tool.name === "wakeflow_continue_demand");
  const createDemand = tools.find((tool) => tool.name === "wakeflow_create_demand");
  const prepare = tools.find((tool) => tool.name === "wakeflow_prepare_delivery");
  for (const field of [
    "workType",
    "objective",
    "contextSummary",
    "requirementRefs",
    "boundaries",
    "completionExpectations",
    "commitExpectation",
  ]) {
    assert.ok(addTask.inputSchema.required.includes(field), `wakeflow_add_task requires ${field}`);
    assert.ok(continueDemand.inputSchema.required.includes(field), `wakeflow_continue_demand requires ${field}`);
    assert.ok(createDemand.inputSchema.properties.taskPackages.items.required.includes(field), `wakeflow_create_demand taskPackages require ${field}`);
  }
  assert.equal(addTask.inputSchema.properties.replacesTargetTaskId.type, "string");
  assert.equal(prepare.inputSchema.properties.apply.type, "boolean");
  assert.equal(prepare.inputSchema.properties.expectedPreviewDigest.type, "string");
  assert.equal(prepare.inputSchema.properties.objective, undefined);
  assert.match(prepare.inputSchema.properties.humanContextRef.description, /controller-return only/);
  assert.throws(
    () => handlers.wakeflow_add_task({
      stateRoot: ".wakeflow-active/current/CTX",
      taskId: "CTX-T1",
      targetWindow: "Product",
      summary: "Missing full context",
    }),
    /requires complete task context/,
  );
  assert.throws(
    () => handlers.wakeflow_prepare_delivery({
      direction: "target",
      stateRoot: ".wakeflow-active/current/CTX",
      taskId: "CTX-T1",
      apply: true,
    }),
    /apply=true requires expectedPreviewDigest/,
  );
});

test("replacement lineage changes the authoritative task package digest", () => {
  const base = {
    taskPackageId: "PKG-NEW",
    demandKey: "D",
    summary: "replacement",
    contextVersion: 1,
    workType: "implementation",
    objective: "Replace the redesigned implementation.",
    contextSummary: ["The controller decided redesign."],
    requirementRefs: [{ ref: "docs/requirement.md#goal", role: "goal" }],
    boundaries: { inScope: ["product"], outOfScope: [], forbidden: [] },
    completionExpectations: ["replacement verified"],
    dependsOnTaskIds: [],
    commitExpectation: "leave-uncommitted",
    acceptanceAnchors: [{ id: "AC-1", claim: "works", probe: "probe", expected: "green" }],
  };
  assert.notEqual(
    taskPackageDigest(base),
    taskPackageDigest({ ...base, replacesTargetTaskId: "TASK-OLD" }),
    "replacement identity is part of dispatch freshness authority",
  );
});

test("replacement readiness rejects non-implementation or legacy packages", (t) => {
  const { root } = makeFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const oldTask = {
    targetTaskId: "TASK-OLD",
    taskPackageId: "PKG-OLD",
    targetWindow: "Product",
    status: "needs-rework",
    reviewDecision: "redesign",
    replacedByTargetTaskId: "TASK-NEW",
  };
  const targetTask = {
    targetTaskId: "TASK-NEW",
    taskPackageId: "PKG-NEW",
    targetWindow: "Product",
    status: "pending",
    replacesTargetTaskId: "TASK-OLD",
  };
  const state = { targetTasks: [oldTask, targetTask] };
  const researchPackage = {
    taskPackageId: "PKG-NEW",
    demandKey: "D",
    summary: "Research is not a replacement.",
    contextVersion: 1,
    workType: "research",
    objective: "Inspect the redesigned implementation.",
    contextSummary: ["The prior task was redesigned."],
    requirementRefs: [{ ref: "docs/requirement.md#goal", role: "goal" }],
    boundaries: { inScope: ["inspection"], outOfScope: [], forbidden: ["implementation"] },
    completionExpectations: ["Return findings."],
    dependsOnTaskIds: [],
    commitExpectation: "leave-uncommitted",
    replacesTargetTaskId: "TASK-OLD",
  };
  const researchReadiness = taskPackageReadiness({
    taskPackage: researchPackage,
    state,
    targetTask,
    workspaceRoot: root,
    repositoryRoot: path.join(root, "product"),
  });
  assert.equal(researchReadiness.ready, false);
  assert.match(researchReadiness.errors.join("\n"), /full-context implementation/);

  const legacyReadiness = taskPackageReadiness({
    taskPackage: {
      taskPackageId: "PKG-NEW",
      demandKey: "D",
      summary: "Legacy replacement.",
      replacesTargetTaskId: "TASK-OLD",
    },
    state,
    targetTask,
    workspaceRoot: root,
    repositoryRoot: path.join(root, "product"),
  });
  assert.equal(legacyReadiness.ready, false);
  assert.match(legacyReadiness.errors.join("\n"), /full-context implementation/);
});
