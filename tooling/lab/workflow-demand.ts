import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sha256 } from "../verification/files.js";
import {
  assertLab,
  previewApply,
  readLabConfig,
  recordAt,
  textAt,
  type WorkflowContext,
} from "./workflow-context.js";

export async function publishLabDemand(context: WorkflowContext) {
  const config = readLabConfig(context.root);
  const design = config.topology.supportSurfaces.find((surface) => surface.capability === "design");
  const origin = config.topology.windows.find(
    (window) => window.role === "design" && window.podId === context.podId,
  );
  assertLab(design && origin, "lab-design-missing");
  const products = context.windows.filter((window) => window.role === "product");
  const mode = context.scenario === "single-product" ? "controller-only" : "real-environment";
  const drafts = path.resolve(context.root, design.path, "drafts");
  mkdirSync(drafts, { recursive: true });
  const confirmedAt = new Date().toISOString();
  writeFileSync(
    path.join(drafts, "lab-requirement.md"),
    `# Disposable arithmetic fixture\n\n## 目标\n\n验证固定合成产品的求和函数与 Wakeflow 公共业务链。\n\n## 完成定义\n\n每个产品返回正确计数与总和，证据经独立复算后归档。\n\n## 非目标\n\n不运行真实宿主、不操作真实产品、不提供通用自动验收。\n\n## 验收标准\n\n${products.map((product, index) => `- AC-${index + 1} ${product.repositoryName} 的 summarize 返回固定样本的正确计数和总和。`).join("\n")}\n\n## 用户确认\n\n本次调用仅授权内置可丢弃合成测试；确认时间 ${confirmedAt}。\n`,
    { flag: "wx", mode: 0o600 },
  );
  writeFileSync(
    path.join(drafts, "lab-landing.md"),
    `# Disposable fixture landing\n\n## 已核实的代码事实\n\n新建合成仓库仅有 README；本场景生成 summarize.mjs，不含真实产品代码。\n\n## 落地方案与影响范围\n\n仅在每个已分配的合成检出写 summarize.mjs 与 verification.json。\n\n## 测试决策\n\n${mode}：Node 实际执行固定样本，Controller 再次执行并核对证据摘要。\n\n## 测试环境\n\n本次新建实验目录、当前 Node、已核验生成制品；宿主记录由测试驱动合成，不是原生会话。\n`,
    { flag: "wx", mode: 0o600 },
  );
  const published = await previewApply(context, "wakeflow_publish_requirement", {
    action: "publish",
    package: {
      designSurfaceId: design.surfaceId,
      originWindowId: origin.windowId,
      title: `Synthetic ${context.scenario} workflow`,
      demandType: "requirement",
      priority: "P2",
      testingDecision: {
        mode,
        summary:
          "Run arithmetic checks in the disposable fixture; synthetic host observations only.",
      },
      taskPlanReview: "controller",
      requirementPath: "drafts/lab-requirement.md",
      landingPath: "drafts/lab-landing.md",
      confirmation: { confirmedAt },
    },
  });
  assertLab(
    published.disposition === "published" && recordAt(published, "package").status === "pending",
    "lab-requirement-not-published",
  );
  context.requirementId = textAt(published, "package", "requirementId");
  const board = await context.call("wakeflow_inspect_board", {
    root: context.root,
    view: "package",
    requirementId: context.requirementId,
  });
  context.recordDigest = textAt(board, "package", "recordDigest");
  context.members = ["requirement.md", "landing.md"].map(
    (name) => `requirements/${context.requirementId}/${name}`,
  );
  const created = await previewApply(context, "wakeflow_create_demand", {
    requirementId: context.requirementId,
    podId: context.podId,
    demand: {
      title: `Synthetic ${context.scenario}`,
      goal: "Implement and independently check the fixed arithmetic fixture.",
      completionDefinition: "All approved arithmetic anchors pass and the demand is archived.",
    },
  });
  context.demandId = textAt(created, "publication", "demandId");
  assertLab(
    textAt(created, "publication", "claim", "requirementId") === context.requirementId,
    "lab-requirement-claim-mismatch",
  );
  context.acts.push("requirement-published-and-claimed");
}

export async function completeLabDemand(context: WorkflowContext) {
  const completed = await previewApply(context, "wakeflow_complete_demand", {
    demandId: context.demandId,
  });
  assertLab(
    completed.disposition === "completed" && recordAt(completed, "package").status === "archived",
    "lab-demand-not-archived",
  );
  const archiveRef = textAt(completed, "archive", "archiveRef");
  assertLab(
    !archiveRef.split("/").includes("..") && !path.isAbsolute(archiveRef),
    "lab-archive-outside-ledger",
  );
  const manifest = path.join(context.labRoot, "ledger", archiveRef, "manifest.json");
  assertLab(existsSync(manifest), "lab-archive-manifest-missing");
  const manifestDigest = sha256(readFileSync(manifest));
  const status = await context.call("wakeflow_status", {
    root: context.root,
    demandId: context.demandId,
  });
  assertLab(
    status.route === null && recordAt(status, "archive").outcome === "completed",
    "lab-archive-readback-failed",
  );
  const board = await context.call("wakeflow_inspect_board", {
    root: context.root,
    view: "package",
    requirementId: context.requirementId,
  });
  assertLab(recordAt(board, "package").status === "archived", "lab-board-not-archived");
  const recovered = await context.call("wakeflow_complete_demand", {
    root: context.root,
    mode: "recover",
    operationId: context.demandId,
  });
  assertLab(
    recovered.disposition === "recovered" &&
      textAt(recovered, "terminalEvent", "eventId") ===
        textAt(completed, "terminalEvent", "eventId"),
    "lab-archive-recovery-mismatch",
  );
  assertLab(
    sha256(readFileSync(manifest)) === manifestDigest,
    "lab-archive-recovery-changed-manifest",
  );
  context.acts.push("demand-completed-and-archived", "archive-recovery-idempotent");
  return {
    demandId: context.demandId,
    requirementId: context.requirementId,
    archiveRef,
    manifestDigest,
  };
}
