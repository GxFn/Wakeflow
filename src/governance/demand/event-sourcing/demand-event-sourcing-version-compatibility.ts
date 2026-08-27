import {
  computeCanonicalJsonSha256Digest,
} from "../../../foundation/crypto/canonical-json-sha256.js";
import type { Sha256Digest } from "../../../foundation/crypto/sha256.js";
import type { JsonValue } from "../../../foundation/data/json-value.js";
import {
  DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS,
  DEMAND_EVENT_SOURCING_SUPPORTED_EVENT_VERSIONS,
} from "./demand-event-sourcing-event-version-codec.js";
import {
  DEMAND_EVENT_SOURCING_CURRENT_STATE_MODEL_VERSION,
  DEMAND_EVENT_SOURCING_SUPPORTED_STATE_MODEL_VERSIONS,
} from "./demand-event-sourcing-state-version.js";

/**
 * Snapshot 与当前 Event/State version support matrix 的稳定兼容摘要。
 *
 * 新增或移除任一受支持历史版本、改变 current writer version 或 state-model support
 * 都会改变该摘要，使旧 Snapshot 回退 full replay；摘要不是事件 authority。
 */
export function computeDemandEventSourcingVersionCompatibilityDigest(): Sha256Digest {
  return computeCanonicalJsonSha256Digest({
    eventFamilies: [
      {
        eventType: "lifecycle.demand-cancelled",
        currentVersion: DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS[
          "lifecycle.demand-cancelled"
        ],
        supportedVersions: DEMAND_EVENT_SOURCING_SUPPORTED_EVENT_VERSIONS[
          "lifecycle.demand-cancelled"
        ],
      },
      {
        eventType: "publication.demand-published",
        currentVersion: DEMAND_EVENT_SOURCING_CURRENT_EVENT_VERSIONS[
          "publication.demand-published"
        ],
        supportedVersions: DEMAND_EVENT_SOURCING_SUPPORTED_EVENT_VERSIONS[
          "publication.demand-published"
        ],
      },
    ],
    stateModel: {
      currentVersion: DEMAND_EVENT_SOURCING_CURRENT_STATE_MODEL_VERSION,
      supportedVersions: DEMAND_EVENT_SOURCING_SUPPORTED_STATE_MODEL_VERSIONS,
    },
  } as unknown as JsonValue);
}
