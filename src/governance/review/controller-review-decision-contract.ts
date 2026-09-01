import type { WakeflowDurableId } from "../../contracts/identity/wakeflow-durable-id.js";
import type { Sha256Digest } from "../../foundation/crypto/sha256.js";
import type { UtcInstant } from "../../foundation/time/utc-instant.js";
import type { DemandEventStreamRevision } from "../demand/event-sourcing/demand-event-stream-position.js";
import type { TargetResultOutcome } from "../result/target-result-report-contract.js";

/** 两类Controller Review Decision共享的最小、无I/O审查词汇。 */

export type ControllerIndependentCheckOutcome =
  "passed" | "failed" | "inconclusive";

export interface ControllerIndependentReviewCheck {
  readonly checkId: string;
  readonly method: string;
  readonly outcome: ControllerIndependentCheckOutcome;
  readonly observation: string;
}

/** Decision绑定的精确Review Snapshot与TargetResult并发基线。 */
export interface ControllerReviewedTargetResult {
  readonly snapshotDigest: Sha256Digest;
  readonly reviewUnitDigest: Sha256Digest;
  readonly stateDigest: Sha256Digest;
  readonly streamRevision: DemandEventStreamRevision;
  readonly taskPackageId: WakeflowDurableId<"task-package">;
  readonly taskPackageDigest: Sha256Digest;
  readonly targetResultId: WakeflowDurableId<"target-result">;
  readonly targetResultDigest: Sha256Digest;
  readonly targetResultOutcome: TargetResultOutcome;
  readonly targetResultReportedAt: UtcInstant;
}
