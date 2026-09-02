import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { DemandEventSourcingPublicationApplicationService } from "../../../src/governance/demand/publication/demand-event-sourcing-publication-application-service.js";
import { DemandEventSourcingPublicationPlanningService } from "../../../src/governance/demand/publication/demand-event-sourcing-publication-planning-service.js";
import {
  cleanupDemandEventSourcingPublicationWorkspaceFixture,
  createDemandEventSourcingPublicationWorkspaceFixture,
  demandEventSourcingPublicationAuthoredDemand,
  demandEventSourcingPublicationUuidFactory,
  PUBLICATION_RECORDED_AT,
  PUBLICATION_TODO_ID,
  type DemandEventSourcingPublicationWorkspaceFixture,
} from "../demand/demand-event-sourcing-publication-service.fixture.js";

export const EVIDENCE_DEMAND_ID = "demand_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const EVIDENCE_REPOSITORY_ID =
  "repository_22222222-2222-4222-8222-222222222222";
export const EVIDENCE_DESIGN_SURFACE_ID =
  "surface_33333333-3333-4333-8333-333333333333";
export const EVIDENCE_CAPTURED_AT = parseUtcInstant("2026-09-01T21:00:00.000Z");

export interface ManagedEvidenceCapturePlanningWorkspaceFixture {
  readonly publication: Readonly<DemandEventSourcingPublicationWorkspaceFixture>;
  readonly repositoryRoot: string;
  readonly designRoot: string;
}

/** 创建一份active Demand及可捕获的repository tree与support file。 */
export async function createManagedEvidenceCapturePlanningWorkspaceFixture(): Promise<
  Readonly<ManagedEvidenceCapturePlanningWorkspaceFixture>
> {
  const publication =
    await createDemandEventSourcingPublicationWorkspaceFixture();
  try {
    const preview = await new DemandEventSourcingPublicationPlanningService(
      publication.workspaceRoot,
    ).preview(
      {
        todoId: PUBLICATION_TODO_ID,
        demand: demandEventSourcingPublicationAuthoredDemand({ mode: "main" }),
        authorityMembers: publication.requirementMembers,
      },
      {
        uuidFactory: demandEventSourcingPublicationUuidFactory(
          [
            "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          ],
          { value: 0 },
        ),
        clock: () => PUBLICATION_RECORDED_AT,
      },
    );
    await new DemandEventSourcingPublicationApplicationService(
      publication.workspaceRoot,
    ).apply(preview.plan, preview.planDigest);

    const repositoryRoot = path.join(publication.fixtureRoot, "ProductA");
    const designRoot = path.join(publication.workspacePath, "Design");
    mkdirSync(path.join(repositoryRoot, "artifacts/test-run/logs"), {
      recursive: true,
      mode: 0o755,
    });
    mkdirSync(path.join(repositoryRoot, "artifacts/test-run/screenshots"), {
      recursive: true,
      mode: 0o755,
    });
    writeFileSync(
      path.join(repositoryRoot, "artifacts/test-run/logs/report.txt"),
      "tests passed\n",
      { mode: 0o644 },
    );
    writeFileSync(
      path.join(repositoryRoot, "artifacts/test-run/screenshots/result.bin"),
      Uint8Array.from([0x00, 0xff, 0x01, 0x02]),
      { mode: 0o644 },
    );
    mkdirSync(path.join(designRoot, "reports"), {
      recursive: true,
      mode: 0o755,
    });
    writeFileSync(path.join(designRoot, "reports/result.txt"), "reviewed\n", {
      mode: 0o644,
    });
    return Object.freeze({ publication, repositoryRoot, designRoot });
  } catch (error: unknown) {
    await cleanupDemandEventSourcingPublicationWorkspaceFixture(publication);
    throw error;
  }
}

export async function cleanupManagedEvidenceCapturePlanningWorkspaceFixture(
  fixture: Readonly<ManagedEvidenceCapturePlanningWorkspaceFixture>,
): Promise<void> {
  await cleanupDemandEventSourcingPublicationWorkspaceFixture(
    fixture.publication,
  );
}
