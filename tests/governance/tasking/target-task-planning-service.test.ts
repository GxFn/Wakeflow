import { equal, rejects } from "node:assert/strict";
import {
  existsSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  parseWakeflowConfigV3,
} from "../../../src/configuration/wakeflow-config-v3.js";
import {
  renderWakeflowConfigV3,
} from "../../../src/configuration/wakeflow-config-v3-document.js";
import {
  RootedDirectory,
} from "../../../src/foundation/filesystem/rooted-directory.js";
import {
  DemandEventSourcingRepository,
} from "../../../src/governance/demand/event-sourcing/demand-event-sourcing-repository.js";
import {
  demandFinalRootRef,
} from "../../../src/governance/demand/publication/demand-publication-paths.js";
import {
  parseTaskPackage,
  renderTaskPackage,
} from "../../../src/governance/tasking/task-package.js";
import {
  taskPackageProjectionRef,
} from "../../../src/governance/tasking/task-package-projection-paths.js";
import {
  TargetTaskPlanningService,
  TargetTaskPlanningServiceError,
} from "../../../src/governance/tasking/target-task-planning-service.js";
import {
  createMinimalWakeflowConfigV3,
} from "../../configuration/wakeflow-config-v3.fixture.js";
import {
  cleanupTargetTaskPlanningWorkspaceFixture,
  createTargetTaskPlanningWorkspaceFixture,
  planningUuidFactory,
  PLANNING_DEMAND_ID,
  PLANNING_RECORDED_AT,
} from "./target-task-planning-service.fixture.js";

async function streamRevision(workspacePath: string): Promise<number> {
  const demandRootPath = path.join(
    workspacePath,
    ...demandFinalRootRef(PLANNING_DEMAND_ID).split("/"),
  );
  const root = await RootedDirectory.open(demandRootPath);
  try {
    return (await new DemandEventSourcingRepository(root).audit())
      .aggregate.streamRevision;
  } finally {
    await root.close();
  }
}

function rewriteConfig(workspacePath: string, displayName: string): void {
  const value = createMinimalWakeflowConfigV3();
  const program = value.program as Record<string, unknown>;
  program.displayName = displayName;
  writeFileSync(
    path.join(workspacePath, "wakeflow.config.json"),
    renderWakeflowConfigV3(parseWakeflowConfigV3(value)),
    { mode: 0o644 },
  );
}

function projectionPath(
  workspacePath: string,
  taskPackageId: string,
): string {
  return path.join(
    workspacePath,
    ...demandFinalRootRef(PLANNING_DEMAND_ID).split("/"),
    ...taskPackageProjectionRef(taskPackageId).split("/"),
  );
}

test("Planning preview is read-only and Apply is commit/projection idempotent", async () => {
  const fixture = await createTargetTaskPlanningWorkspaceFixture();
  try {
    const service = new TargetTaskPlanningService(fixture.workspaceRoot);
    const preview = await service.preview(fixture.request, {
      clock: () => PLANNING_RECORDED_AT,
      uuidFactory: planningUuidFactory(),
    });
    const targetPath = projectionPath(
      fixture.workspacePath,
      preview.plan.taskPackage.taskPackageId,
    );
    equal(await streamRevision(fixture.workspacePath), 1);
    equal(existsSync(targetPath), false);

    const applied = await service.apply(preview.plan, preview.planDigest);
    equal(applied.disposition, "committed");
    equal(applied.commandResult.aggregate.streamRevision, 2);
    equal(applied.projection.disposition, "created");
    equal(existsSync(targetPath), true);

    const replayed = await service.apply(preview.plan, preview.planDigest);
    equal(replayed.disposition, "idempotent");
    equal(replayed.projection.disposition, "current");
    equal(await streamRevision(fixture.workspacePath), 2);

    rewriteConfig(fixture.workspacePath, "Reconfigured Program");
    rmSync(targetPath);
    const repaired = await service.apply(preview.plan, preview.planDigest);
    equal(repaired.disposition, "idempotent");
    equal(repaired.projection.disposition, "created");
    equal(await streamRevision(fixture.workspacePath), 2);
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
  }
});

test("concurrent Apply converges through one event commit and exact retry", async () => {
  const fixture = await createTargetTaskPlanningWorkspaceFixture();
  try {
    const service = new TargetTaskPlanningService(fixture.workspaceRoot);
    const preview = await service.preview(fixture.request, {
      clock: () => PLANNING_RECORDED_AT,
      uuidFactory: planningUuidFactory(),
    });
    const settled = await Promise.allSettled([
      service.apply(preview.plan, preview.planDigest),
      service.apply(preview.plan, preview.planDigest),
    ]);
    equal(settled.some((entry) => (
      entry.status === "fulfilled" && entry.value.disposition === "committed"
    )), true);
    for (const entry of settled) {
      if (entry.status === "fulfilled") continue;
      equal(
        entry.reason instanceof TargetTaskPlanningServiceError
        && entry.reason.eventAuthority === "current",
        true,
      );
    }
    equal(
      (await service.apply(preview.plan, preview.planDigest)).disposition,
      "idempotent",
    );
    equal(await streamRevision(fixture.workspacePath), 2);
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
  }
});

test("Planning Apply rejects Config drift before the event commit", async () => {
  const fixture = await createTargetTaskPlanningWorkspaceFixture();
  try {
    const service = new TargetTaskPlanningService(fixture.workspaceRoot);
    const preview = await service.preview(fixture.request, {
      clock: () => PLANNING_RECORDED_AT,
      uuidFactory: planningUuidFactory(),
    });
    rewriteConfig(fixture.workspacePath, "Stale Planning Preview");

    await rejects(
      service.apply(preview.plan, preview.planDigest),
      (error: unknown) => (
        error instanceof TargetTaskPlanningServiceError
        && error.reason === "plan"
        && error.eventAuthority === "unchanged"
      ),
    );
    equal(await streamRevision(fixture.workspacePath), 1);
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
  }
});

test("Planning preview resolves only current Authority members and exact product topology", async () => {
  const fixture = await createTargetTaskPlanningWorkspaceFixture();
  try {
    const service = new TargetTaskPlanningService(fixture.workspaceRoot);
    await rejects(
      service.preview({
        ...fixture.request,
        taskPackage: {
          ...fixture.request.taskPackage,
          selectedAuthorityMemberRefs: ["requirements/foreign/member.md"],
        },
      }),
      (error: unknown) => (
        error instanceof TargetTaskPlanningServiceError
        && error.reason === "reference"
      ),
    );
    await rejects(
      service.preview({
        ...fixture.request,
        taskPackage: {
          ...fixture.request.taskPackage,
          assignment: {
            ...fixture.request.taskPackage.assignment,
            windowId: "window_77777777-7777-4777-8777-777777777777",
          },
        },
      }),
      (error: unknown) => (
        error instanceof TargetTaskPlanningServiceError
        && error.reason === "topology"
      ),
    );
    equal(await streamRevision(fixture.workspacePath), 1);
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
  }
});

test("Planning reports current event authority when projection conflicts and retry repairs it", async () => {
  const fixture = await createTargetTaskPlanningWorkspaceFixture();
  try {
    const service = new TargetTaskPlanningService(fixture.workspaceRoot);
    const preview = await service.preview(fixture.request, {
      clock: () => PLANNING_RECORDED_AT,
      uuidFactory: planningUuidFactory(),
    });
    const targetPath = projectionPath(
      fixture.workspacePath,
      preview.plan.taskPackage.taskPackageId,
    );
    const conflict = parseTaskPackage({
      ...preview.plan.taskPackage,
      objective: "与事件计划不同的已有投影",
    });
    writeFileSync(targetPath, renderTaskPackage(conflict), { mode: 0o600 });

    await rejects(
      service.apply(preview.plan, preview.planDigest),
      (error: unknown) => (
        error instanceof TargetTaskPlanningServiceError
        && error.reason === "projection"
        && error.eventAuthority === "current"
      ),
    );
    equal(await streamRevision(fixture.workspacePath), 2);

    rmSync(targetPath);
    const recovered = await service.apply(preview.plan, preview.planDigest);
    equal(recovered.disposition, "idempotent");
    equal(recovered.projection.disposition, "created");
    equal(await streamRevision(fixture.workspacePath), 2);
  } finally {
    await cleanupTargetTaskPlanningWorkspaceFixture(fixture);
  }
});
