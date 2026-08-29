import {
  computeCanonicalJsonSha256Digest,
} from "../../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../../foundation/crypto/sha256.js";
import {
  DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS,
  DEMAND_EVENT_SOURCING_EVENT_TYPES,
  DEMAND_EVENT_SOURCING_SUPPORTED_EVENT_VERSIONS,
} from "./demand-event-sourcing-event-version-codec.js";
import {
  DEMAND_EVENT_SOURCING_CURRENT_STATE_MODEL_VERSION,
  DEMAND_EVENT_SOURCING_SUPPORTED_STATE_MODEL_VERSIONS,
} from "./demand-event-sourcing-state-version.js";

/**
 * 快照与当前事件、状态版本支持矩阵的稳定兼容摘要。
 *
 * 新增或移除任何受支持的历史版本、改变当前写入版本或状态模型支持范围，都会改变
 * 该摘要，使旧快照回退到完整重放。该摘要不是事件权威事实。
 */
export function computeDemandEventSourcingVersionCompatibilityDigest(): Sha256Digest {
  return computeCanonicalJsonSha256Digest({
    eventFamilies: DEMAND_EVENT_SOURCING_EVENT_TYPES.map((eventType) => ({
      eventType,
      currentVersion: DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS[eventType],
      supportedVersions:
        DEMAND_EVENT_SOURCING_SUPPORTED_EVENT_VERSIONS[eventType],
    })),
    stateModel: {
      currentVersion: DEMAND_EVENT_SOURCING_CURRENT_STATE_MODEL_VERSION,
      supportedVersions: DEMAND_EVENT_SOURCING_SUPPORTED_STATE_MODEL_VERSIONS,
    },
  });
}
