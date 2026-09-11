import { computeSha256Digest, type Sha256Digest } from "../../foundation/crypto/sha256.js";
import { renderDeterministicJsonDocument } from "../../foundation/data/deterministic-json-document.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
import type {
  ManagedEvidenceCommitSource,
  ManagedEvidenceLinkSource,
  ManagedEvidenceObservationSource,
} from "./managed-evidence-source-selection.js";

/**
 * Wakeflow Governance / Evidence：引用类来源的 payload 投影（切片 8 D2）。
 *
 * `observation`、`link`、`commit` 不复制外部字节；记录的 `payload/content` 是来源投影
 * 本身的确定性 JSON 文档，由 Manifest 的来源字段完整重建，因此 stage 物化与恢复都不需要
 * 再读原始来源。文档与 Manifest 来源同一份事实，记录可以像复制类记录一样被引用与归档。
 */

export type ManagedEvidenceReferenceSource =
  | Readonly<ManagedEvidenceObservationSource>
  | Readonly<ManagedEvidenceLinkSource>
  | Readonly<ManagedEvidenceCommitSource>;

const PROJECTION_KIND = "wakeflow-managed-evidence-source-projection" as const;
const PROJECTION_VERSION = 1 as const;

export interface ManagedEvidenceSourceProjectionBytes {
  readonly bytes: Uint8Array;
  readonly byteCount: number;
  readonly digest: Sha256Digest;
}

export function renderManagedEvidenceSourceProjection(
  source: ManagedEvidenceReferenceSource,
): string {
  return renderDeterministicJsonDocument(
    { artifactKind: PROJECTION_KIND, schemaVersion: PROJECTION_VERSION, source },
    "$projection",
  );
}

export function encodeManagedEvidenceSourceProjection(
  source: ManagedEvidenceReferenceSource,
): Readonly<ManagedEvidenceSourceProjectionBytes> {
  const bytes = encodeUtf8(renderManagedEvidenceSourceProjection(source), "$projection");
  return Object.freeze({
    bytes,
    byteCount: bytes.byteLength,
    digest: computeSha256Digest(bytes),
  });
}
