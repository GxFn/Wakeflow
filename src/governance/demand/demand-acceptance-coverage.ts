import type { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import { readStrictTextFile } from "../../foundation/filesystem/strict-text-file.js";
import { parseByteCount } from "../../foundation/numeric/byte-count.js";
import { fail } from "../../kernel/error.js";
import { parseAcceptanceCriteria } from "../../kernel/requirement-acceptance.js";
import { ledgerAuthorityMemberRef } from "../ledger/ledger-authority-paths.js";
import { LedgerAuthorityStore } from "../ledger/ledger-authority-store.js";
import { DemandEventSourcingRepository } from "./event-sourcing/demand-event-sourcing-repository.js";
import type { LoadedDemandEventSourcingRootAuthority } from "./event-sourcing/demand-event-sourcing-root-authority.js";
import { currentTestTargetsOf } from "./model/demand-aggregate-state.js";

const MAXIMUM_BYTES = parseByteCount(4 * 1024 * 1024);

/** 从不可变需求与已接受目标派生覆盖，不改变聚合或旧状态摘要。 */
export async function readDemandAcceptanceCoverage(
  demandRoot: RootedDirectory,
  ledgerRoot: RootedDirectory,
  loaded: Readonly<LoadedDemandEventSourcingRootAuthority>,
  signal?: AbortSignal,
) {
  const options = signal === undefined ? {} : { signal };
  const record = await new LedgerAuthorityStore(ledgerRoot).loadRequirement(loaded.identity.source.requirementId, options);
  if (record.recordDigest !== loaded.identity.source.recordDigest) fail("precondition-failed", "requirement-record-drift", "$coverage");
  const document = record.documents.find((entry) => entry.role === "requirement");
  if (document === undefined) fail("precondition-failed", "requirement-member-missing", "$coverage");
  const text = await readStrictTextFile(ledgerRoot, ledgerAuthorityMemberRef(record.record, document.path), { maximumBytes: MAXIMUM_BYTES, ...options });
  if (text.digest !== document.digest) fail("precondition-failed", "requirement-member-drift", "$coverage");
  const criteria = parseAcceptanceCriteria(text.text);
  const implemented = new Set<string>();
  const tested = new Set<string>();
  const state = loaded.aggregate.state;
  const targets = [
    ...state.targetTasks.filter((target) => target.workType !== "test" && target.phase === "accepted"),
    ...currentTestTargetsOf(state).filter((target) => target.phase === "test-accepted"),
  ];
  const repository = new DemandEventSourcingRepository(demandRoot);
  for (const target of targets) {
    const planned = await repository.findTargetTaskPlannedEvent(target.taskPackageId, options);
    if (planned === null) fail("precondition-failed", "coverage-task-package-missing", "$coverage");
    const task = planned.event.data.taskPackage;
    const references = task.workType === "test" ? task.testContract.steps : task.acceptanceAnchors;
    for (const { requirementRef } of references) {
      if (requirementRef.recordDigest !== record.recordDigest || requirementRef.sectionAnchor !== "acceptance-criteria") {
        fail("precondition-failed", "coverage-reference-drift", "$coverage");
      }
      (task.workType === "test" ? tested : implemented).add(requirementRef.itemId);
    }
  }
  const required = loaded.authority.testingDecision.mode === "real-environment" ? tested : implemented;
  return Object.freeze({
    total: criteria.length,
    implementationCovered: Object.freeze(criteria.filter((criterion) => implemented.has(criterion.itemId)).map((criterion) => criterion.itemId)),
    testCovered: Object.freeze(criteria.filter((criterion) => tested.has(criterion.itemId)).map((criterion) => criterion.itemId)),
    uncovered: Object.freeze(criteria.filter((criterion) => !required.has(criterion.itemId)).map((criterion) => criterion.itemId)),
  });
}
