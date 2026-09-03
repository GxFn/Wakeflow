import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { renderWakeflowConfigV3 } from "../../../src/configuration/wakeflow-config-v3-document.js";
import { parseWakeflowConfigV3 } from "../../../src/configuration/wakeflow-config-v3.js";
import { RootedDirectory } from "../../../src/foundation/filesystem/rooted-directory.js";
import { parseUtcInstant } from "../../../src/foundation/time/utc-instant.js";
import { LedgerAuthorityStore } from "../../../src/governance/ledger/ledger-authority-store.js";
import { createMinimalWakeflowConfigV3 } from "../../configuration/wakeflow-config-v3.fixture.js";

export const DESIGN_SURFACE_ID =
  "surface_33333333-3333-4333-8333-333333333333";
export const TEST_SURFACE_ID =
  "surface_44444444-4444-4444-8444-444444444444";
export const REQUIREMENT_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const CONFIRMATION_UUID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const DEMAND_UUID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const RECORDED_AT = parseUtcInstant("2026-09-02T22:00:00.000Z");
export const ORIGINAL_PLAN_PATH = "authority/original-plan.md";
export const REQUIREMENT_DESIGN_PATH = "authority/requirement-design.md";
export const CONFIRMATION_PATH = "decisions/goal-stage.md";
export const ORIGINAL_PLAN_TEXT = "# Original plan\n";
export const REQUIREMENT_DESIGN_TEXT = "# Requirement design\n";
export const CONFIRMATION_TEXT = "# Confirmed goal and stage\n";

export interface LedgerAuthorityPublicationFixture {
  readonly fixtureRoot: string;
  readonly workspacePath: string;
  readonly ledgerPath: string;
  readonly designPath: string;
  readonly workspaceRoot: RootedDirectory;
}

/** Planning、Payload与后续Application测试共用的最小真实Workspace。 */
export async function createLedgerAuthorityPublicationFixture(): Promise<
  Readonly<LedgerAuthorityPublicationFixture>
> {
  const fixtureRoot = mkdtempSync(
    path.join(os.tmpdir(), "wakeflow-ledger-authority-publication-"),
  );
  const workspacePath = path.join(fixtureRoot, "Workspace");
  const ledgerPath = path.join(fixtureRoot, "wakeflow-ledger");
  const designPath = path.join(workspacePath, "Design");
  for (const directory of [
    workspacePath,
    ledgerPath,
    path.join(fixtureRoot, "ProductA"),
    designPath,
    path.join(designPath, "authority"),
    path.join(designPath, "decisions"),
    path.join(workspacePath, "Test"),
  ]) {
    mkdirSync(directory, { mode: 0o755 });
  }
  const config = parseWakeflowConfigV3(createMinimalWakeflowConfigV3());
  writeFileSync(
    path.join(workspacePath, "wakeflow.config.json"),
    renderWakeflowConfigV3(config),
    { mode: 0o644 },
  );
  writeFileSync(
    path.join(designPath, ORIGINAL_PLAN_PATH),
    ORIGINAL_PLAN_TEXT,
    { mode: 0o644 },
  );
  writeFileSync(
    path.join(designPath, REQUIREMENT_DESIGN_PATH),
    REQUIREMENT_DESIGN_TEXT,
    { mode: 0o644 },
  );
  writeFileSync(
    path.join(designPath, CONFIRMATION_PATH),
    CONFIRMATION_TEXT,
    { mode: 0o644 },
  );

  const ledgerRoot = await RootedDirectory.open(ledgerPath);
  try {
    await new LedgerAuthorityStore(ledgerRoot).initialize({
      freshLedger: true,
    });
  } finally {
    await ledgerRoot.close();
  }
  return Object.freeze({
    fixtureRoot,
    workspacePath,
    ledgerPath,
    designPath,
    workspaceRoot: await RootedDirectory.open(workspacePath),
  });
}

export async function cleanupLedgerAuthorityPublicationFixture(
  fixture: Readonly<LedgerAuthorityPublicationFixture>,
): Promise<void> {
  await fixture.workspaceRoot.close();
  rmSync(fixture.fixtureRoot, { recursive: true, force: true });
}

export function requirementPublicationInput(
  designSurfaceId = DESIGN_SURFACE_ID,
  requirementDesignPath = REQUIREMENT_DESIGN_PATH,
) {
  return {
    title: "Publish confirmed requirement authority",
    designSurfaceId,
    documents: [
      { role: "requirement-design", path: requirementDesignPath },
      { role: "original-plan", path: ORIGINAL_PLAN_PATH },
    ],
  };
}

export function confirmationPublicationInput() {
  return {
    title: "Publish confirmed goal and stage",
    designSurfaceId: DESIGN_SURFACE_ID,
    documents: [{ role: "goal-stage-decision", path: CONFIRMATION_PATH }],
  };
}

export function ledgerAuthorityPublicationUuidFactory(
  values: readonly string[],
  calls: { value: number },
  beforeReturn?: (index: number) => void,
) {
  return () => {
    const index = calls.value;
    const value = values[index];
    calls.value += 1;
    beforeReturn?.(index);
    if (value === undefined) throw new Error("Unexpected UUID allocation.");
    return value;
  };
}

export function ledgerAuthorityPublicationContents(
  fixture: Readonly<LedgerAuthorityPublicationFixture>,
) {
  return Object.freeze({
    requirements: readdirSync(path.join(fixture.ledgerPath, "requirements")),
    confirmations: readdirSync(path.join(fixture.ledgerPath, "confirmations")),
    transactions: readdirSync(path.join(fixture.ledgerPath, "transactions")),
  });
}
