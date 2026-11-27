import type { Sha256Digest } from "../../../foundation/crypto/sha256.js";
import { ModuleError } from "../../../foundation/error/module-error.js";
import type { DeterministicJsonFileResult } from "../../../foundation/filesystem/deterministic-json-file.js";
import type { PortableResourcePath } from "../../../foundation/filesystem/portable-resource-path.js";
import type { RequirementClaimState } from "../../../kernel/requirement-board.js";
import type { LoadedDemandEventSourcingRootAuthority } from "../event-sourcing/demand-event-sourcing-root-authority.js";
import type { DemandEventSourcingPublicationTransaction } from "./demand-event-sourcing-publication-transaction.js";

/** Demand 事件溯源发布流程的稳定公共合同和错误词汇。 */

export const DEMAND_EVENT_SOURCING_PUBLICATION_DIRECTORY_MODE = 0o700;
export const DEMAND_EVENT_SOURCING_PUBLICATION_FILE_MODE = 0o600;
export const DEMAND_EVENT_SOURCING_PUBLICATION_LOCK_TIMEOUT_MILLISECONDS = 10_000;

/**
 * 一次Publication调用结束或失败后，对该exact transaction业务权威状态的最强证明。
 *
 * `recoverable`要求存在可重读且与计划完全一致的sidecar；它表示应显式前向恢复，
 * 不承诺恢复不会再遇到外部冲突。`unknown`禁止调用方把失败解释为安全重试或成功。
 */
export type DemandEventSourcingPublicationEffectAuthority =
  | "unchanged"
  | "recoverable"
  | "current"
  | "unknown";

/** 发布完成后需求包在看板上的 `claimed` 状态及其摘要（修订 2）。 */
export interface DemandEventSourcingPublicationClaimResult {
  readonly state: RequirementClaimState;
  readonly digest: Sha256Digest;
}

export interface DemandEventSourcingPublicationResult {
  readonly publicationAuthority: "current";
  readonly wroteDemandRoot: boolean;
  readonly demandId: DemandEventSourcingPublicationTransaction["demandId"];
  readonly rootRef: PortableResourcePath;
  readonly claim: Readonly<DemandEventSourcingPublicationClaimResult>;
  readonly loaded: Readonly<LoadedDemandEventSourcingRootAuthority>;
}

export interface StoredDemandEventSourcingPublicationTransaction {
  readonly transaction: Readonly<DemandEventSourcingPublicationTransaction>;
  readonly source: Readonly<DeterministicJsonFileResult>;
}

export type DemandEventSourcingPublicationServiceErrorReason =
  | "root-scope"
  | "authority"
  | "package-not-found"
  | "cas-mismatch"
  | "capacity"
  | "conflict"
  | "not-found"
  | "recovery-required"
  | "lock-timeout"
  | "lock-unsafe"
  | "operation-failure";

export class DemandEventSourcingPublicationServiceError extends ModuleError<DemandEventSourcingPublicationServiceErrorReason> {
  static override readonly code = "wakeflow-demand-event-sourcing-publication-service";
  readonly publicationAuthority: DemandEventSourcingPublicationEffectAuthority;

  constructor(
    reason: DemandEventSourcingPublicationServiceErrorReason,
    path: string,
    publicationAuthority: DemandEventSourcingPublicationEffectAuthority = "unknown",
    options?: ErrorOptions,
  ) {
    super(reason, path, options);
    this.publicationAuthority = publicationAuthority;
  }
}

export function failDemandEventSourcingPublication(
  reason: DemandEventSourcingPublicationServiceErrorReason,
  path: string,
  publicationAuthority: DemandEventSourcingPublicationEffectAuthority = "unknown",
  cause?: unknown,
): never {
  throw new DemandEventSourcingPublicationServiceError(
    reason,
    path,
    publicationAuthority,
    cause === undefined ? undefined : { cause },
  );
}
