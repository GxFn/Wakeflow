import { createHash } from "node:crypto";
import path from "node:path";

const MAX_READABLE_CODEPOINTS = 48;

function shortHash(value) {
  return createHash("sha256")
    .update(String(value).normalize("NFC"))
    .digest("hex")
    .slice(0, 12);
}

function trimCodePoints(value, maximum = MAX_READABLE_CODEPOINTS) {
  return Array.from(value).slice(0, maximum).join("");
}

export function stableArtifactPart(value, { fallback = "item" } = {}) {
  const source = String(value ?? "").normalize("NFC").trim();
  const readable = trimCodePoints(source
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, ""));
  const prefix = readable && readable !== "." && readable !== ".." ? readable : fallback;
  const isLegacySafeAscii = /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(source)
    && source === prefix;
  return isLegacySafeAscii ? prefix : `${prefix}--${shortHash(source || fallback)}`;
}

export function demandArtifactNamespace(stateRef = {}) {
  const demandIdentity = stateRef?.demandKey
    || (stateRef?.stateRoot ? path.basename(String(stateRef.stateRoot)) : "");
  return demandIdentity ? stableArtifactPart(demandIdentity, { fallback: "demand" }) : "";
}

export function transportArtifactFileName(logicalId, stateRef = null) {
  const logical = stableArtifactPart(logicalId);
  const namespace = demandArtifactNamespace(stateRef);
  return `${namespace ? `${namespace}__` : ""}${logical}.json`;
}
