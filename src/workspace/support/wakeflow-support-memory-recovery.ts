import {
  recoverDurableAtomicFileStagesForTargets,
  DurableAtomicFileStageRecoveryError,
} from "../../foundation/filesystem/durable-atomic-file-stage-recovery.js";
import { RootedDirectory } from "../../foundation/filesystem/rooted-directory.js";
import {
  assertWakeflowSupportMemoryPublicationNotAborted,
  failWakeflowSupportMemoryPublication as fail,
  parseWakeflowSupportMemoryPublicationOptions,
  parseWakeflowSupportMemoryPublicationRequest,
  type WakeflowSupportMemoryPublicationOptions,
  type WakeflowSupportMemoryPublicationRequest,
  type WakeflowSupportMemoryRecoveryReceipt,
} from "./wakeflow-support-memory-publication-contract.js";
import {
  publishWakeflowSupportMemory,
} from "./wakeflow-support-memory-publication.js";

/**
 * Wakeflow Workspace / Support：whole-file memory 原子 stage 的显式恢复。
 *
 * 本 owner 只检查当前 Support 根内与宿主 instruction filename 精确匹配的 stage；活动
 * 或未知 owner 保留现场。安全 stage 结算后重新进入普通无锁 CAS 发布，未知整文件仍由
 * inspection 拒绝。
 */
export async function recoverWakeflowSupportMemory(
  workspaceRoot: RootedDirectory,
  supportRoot: RootedDirectory,
  requestValue: WakeflowSupportMemoryPublicationRequest,
  optionsValue?: WakeflowSupportMemoryPublicationOptions,
): Promise<Readonly<WakeflowSupportMemoryRecoveryReceipt>> {
  const request = parseWakeflowSupportMemoryPublicationRequest(requestValue);
  const options = parseWakeflowSupportMemoryPublicationOptions(optionsValue);
  assertWakeflowSupportMemoryPublicationNotAborted(options.signal);
  let stageRecovery;
  try {
    stageRecovery = await recoverDurableAtomicFileStagesForTargets(
      supportRoot,
      Object.freeze([request.profile.instructionFileName]),
      options.signal === undefined ? undefined : { signal: options.signal },
    );
  } catch (error: unknown) {
    if (error instanceof DurableAtomicFileStageRecoveryError) {
      if (error.reason === "aborted") fail("aborted", "$signal");
      fail("recovery-required", "$stages");
    }
    throw error;
  }
  if (
    stageRecovery.activeStageCount !== 0
    || stageRecovery.unknownStageCount !== 0
  ) {
    fail("recovery-required", "$stages");
  }
  const publication = await publishWakeflowSupportMemory(
    workspaceRoot,
    supportRoot,
    {
      currentConfig: request.currentConfig,
      expectedCurrentConfigDigest: request.currentConfigDigest,
      desiredConfig: request.desiredConfig,
      expectedDesiredConfigDigest: request.desiredConfigDigest,
      profile: request.profile,
      expectedCatalogDigest: request.catalog.catalogDigest,
      surfaceId: request.surfaceId,
    },
    options.signal === undefined ? undefined : { signal: options.signal },
  );
  return Object.freeze({
    disposition: "recovered",
    stageRecovery,
    publication,
  });
}

export type {
  WakeflowSupportMemoryRecoveryReceipt,
} from "./wakeflow-support-memory-publication-contract.js";
