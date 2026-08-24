import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  inspectWakeflowLegacyOriginFixtureDirectory,
} from "../../tools/lib/wakeflow-legacy-origin-fixtures.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function loadWakeflowHistoricalArtifactIdentity({ host, originVersion = "0.9.6-70d79d72" }) {
  if (!new Set(["claude-code", "codex"]).has(host)) {
    throw new Error("historical artifact host must be claude-code or codex");
  }
  const matchedVersion = /^(\d+\.\d+\.\d+)-([a-f0-9]{8})$/u.exec(originVersion);
  if (!matchedVersion) {
    throw new Error("historical artifact originVersion must be an exact version and 8-character commit prefix");
  }
  // 通过完整origin inspector取得身份，避免测试辅助层绕过路径、链接、字节和manifest闭包。
  const { origin } = inspectWakeflowLegacyOriginFixtureDirectory({ fixtureRoot: path.join(
    repositoryRoot,
    "test/fixtures/legacy-origins",
    `${host}-${originVersion}`,
  ) });
  if (
    origin.source.host !== host
    || origin.source.artifactVersion !== matchedVersion[1]
    || !origin.source.commit.startsWith(matchedVersion[2])
  ) {
    throw new Error(`historical artifact digest mismatch for ${host}-${originVersion}`);
  }
  return deepFreeze({
    artifactDigest: origin.source.artifactDigest,
    manifest: origin.source.artifactManifest,
  });
}
