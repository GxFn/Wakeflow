import { computeSha256Digest } from "../../foundation/crypto/sha256.js";
import { renderDeterministicJsonDocument } from "../../foundation/data/deterministic-json-document.js";
import { encodeUtf8 } from "../../foundation/text/utf8.js";
const PROJECTION_KIND = "wakeflow-managed-evidence-source-projection";
const PROJECTION_VERSION = 1;
export function renderManagedEvidenceSourceProjection(source) {
    return renderDeterministicJsonDocument({ artifactKind: PROJECTION_KIND, schemaVersion: PROJECTION_VERSION, source }, "$projection");
}
export function encodeManagedEvidenceSourceProjection(source) {
    const bytes = encodeUtf8(renderManagedEvidenceSourceProjection(source), "$projection");
    return Object.freeze({
        bytes,
        byteCount: bytes.byteLength,
        digest: computeSha256Digest(bytes),
    });
}
