import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import { readStrictTextFile } from "../../foundation/filesystem/strict-text-file.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { fail } from "../../kernel/error.js";
import {
  acceptanceCriterionLabel,
  parseAcceptanceCriteria,
} from "../../kernel/requirement-acceptance.js";
import { ledgerAuthorityMemberRef } from "../ledger/ledger-authority-paths.js";
import { LedgerAuthorityStore } from "../ledger/ledger-authority-store.js";
import { DemandEventSourcingRepository } from "./event-sourcing/demand-event-sourcing-repository.js";
import type { LoadedDemandEventSourcingRootAuthority } from "./event-sourcing/demand-event-sourcing-root-authority.js";
import { currentTestTargetsOf } from "./model/demand-aggregate-state.js";

const MAXIMUM_BYTES = parseByteCount(4 * 1024 * 1024);

interface CoveragePackage {
  /** 源需求为 null，并入的 supplement 包为它的 requirementId。 */
  readonly requirementId: string | null;
  readonly recordDigest: string;
  readonly itemIds: readonly string[];
}

/** 一份需求包记录的验收条目：记录摘要与成员摘要都要和谱系对上。 */
async function coveragePackage(
  store: LedgerAuthorityStore,
  ledgerRoot: RootedDirectory,
  lineage: Readonly<{ readonly requirementId: string; readonly recordDigest: string }>,
  requirementId: string | null,
  options: { readonly signal?: AbortSignal },
): Promise<CoveragePackage> {
  const record = await store.loadRequirement(lineage.requirementId, options);
  if (record.recordDigest !== lineage.recordDigest)
    fail("precondition-failed", "requirement-record-drift", "$coverage");
  const document = record.documents.find((entry) => entry.role === "requirement");
  if (document === undefined)
    fail("precondition-failed", "requirement-member-missing", "$coverage");
  const text = await readStrictTextFile(
    ledgerRoot,
    ledgerAuthorityMemberRef(record.record, document.path),
    { maximumBytes: MAXIMUM_BYTES, ...options },
  );
  if (text.digest !== document.digest)
    fail("precondition-failed", "requirement-member-drift", "$coverage");
  return Object.freeze({
    requirementId,
    recordDigest: record.recordDigest,
    itemIds: Object.freeze(parseAcceptanceCriteria(text.text).map((entry) => entry.itemId)),
  });
}

/**
 * 从不可变需求与已接受目标派生覆盖，不改变聚合或旧状态摘要。验收全集是源需求的条目加上历次
 * requirement-supplement 续接并入的 supplement 包的条目（Q7 裁决）；引用按记录摘要认包，supplement 包的条目
 * 写作 `<requirementId>/ac-N`。
 */
export async function readDemandAcceptanceCoverage(
  demandRoot: RootedDirectory,
  ledgerRoot: RootedDirectory,
  loaded: Readonly<LoadedDemandEventSourcingRootAuthority>,
  signal?: AbortSignal,
) {
  const options = signal === undefined ? {} : { signal };
  const store = new LedgerAuthorityStore(ledgerRoot);
  const state = loaded.aggregate.state;
  const packages = [
    await coveragePackage(store, ledgerRoot, loaded.identity.source, null, options),
  ];
  for (const supplement of state.supplements ?? []) {
    packages.push(
      await coveragePackage(store, ledgerRoot, supplement, supplement.requirementId, options),
    );
  }
  const implemented = new Set<string>();
  const tested = new Set<string>();
  const targets = [
    ...state.targetTasks.filter(
      (target) => target.workType !== "test" && target.phase === "accepted",
    ),
    ...currentTestTargetsOf(state).filter((target) => target.phase === "test-accepted"),
  ];
  const repository = new DemandEventSourcingRepository(demandRoot);
  for (const target of targets) {
    const planned = await repository.findTargetTaskPlannedEvent(target.taskPackageId, options);
    if (planned === null) fail("precondition-failed", "coverage-task-package-missing", "$coverage");
    const task = planned.event.data.taskPackage;
    const references = task.workType === "test" ? task.testContract.steps : task.acceptanceAnchors;
    for (const { requirementRef } of references) {
      const referenced = packages.find(
        (entry) => entry.recordDigest === requirementRef.recordDigest,
      );
      if (referenced === undefined || requirementRef.sectionAnchor !== "acceptance-criteria") {
        fail("precondition-failed", "coverage-reference-drift", "$coverage");
      }
      (task.workType === "test" ? tested : implemented).add(
        acceptanceCriterionLabel(referenced.requirementId, requirementRef.itemId),
      );
    }
  }
  const required =
    loaded.authority.testingDecision.mode === "real-environment" ? tested : implemented;
  const criteria = packages.flatMap((entry) =>
    entry.itemIds.map((itemId) => acceptanceCriterionLabel(entry.requirementId, itemId)),
  );
  return Object.freeze({
    total: criteria.length,
    implementationCovered: Object.freeze(criteria.filter((label) => implemented.has(label))),
    testCovered: Object.freeze(criteria.filter((label) => tested.has(label))),
    uncovered: Object.freeze(criteria.filter((label) => !required.has(label))),
  });
}
