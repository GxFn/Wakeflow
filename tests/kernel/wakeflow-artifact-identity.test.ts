import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";

import { computeSha256Digest } from "../../src/foundation/crypto/sha256.js";
import { encodeUtf8 } from "../../src/foundation/text/utf8.js";
import {
  compareWakeflowArtifactVersions,
  isWakeflowArtifactVersion,
  newestWakeflowArtifactVersion,
  parseWakeflowArtifactManifestIdentity,
} from "../../src/kernel/wakeflow-artifact-identity.js";

/**
 * 0 级纯逻辑：制品身份的版本轴（1.2 计划 §3.6 C6；open-items V6、W14）——版本文本的形状、主次补丁的
 * 数值序、一组会话里最高的版本，以及从 manifest 字节解析出摘要与 `version`。没有 I/O。
 */

test("版本文本是 主.次.补丁，可带预发布或构建后缀；前导零、缺段、v 前缀与别的类型都不是版本", () => {
  for (const version of [
    "0.0.0",
    "1.2.0",
    "10.20.30",
    "1.2.0-rc.1",
    "1.2.0+build.7",
    "1.2.0-beta+exp.sha.5114f85",
  ]) {
    equal(isWakeflowArtifactVersion(version), true, version);
  }
  for (const value of [
    "1.2",
    "v1.2.0",
    "01.2.0",
    "1.2.0.1",
    "1.2.0-",
    "1.2.0 ",
    "",
    `1.2.0-${"a".repeat(49)}`,
    120,
    null,
    undefined,
  ]) {
    equal(isWakeflowArtifactVersion(value), false, String(value));
  }
});

test("比较只看主、次、补丁的数值序：1.10.0 高于 1.9.9，后缀不参与，相等为 0，不合法的文本抛 TypeError", () => {
  equal(compareWakeflowArtifactVersions("1.10.0", "1.9.9"), 1);
  equal(compareWakeflowArtifactVersions("1.2.0", "2.0.0"), -1);
  equal(compareWakeflowArtifactVersions("1.2.10", "1.2.9"), 1);
  equal(compareWakeflowArtifactVersions("1.2.0-rc.1", "1.2.0"), 0);
  equal(compareWakeflowArtifactVersions("1.2.0", "1.2.0+build.7"), 0);
  throws(() => compareWakeflowArtifactVersions("1.2", "1.2.0"), TypeError);
});

test("newest 取可比版本里最高的一个；null 与不合法文本跳过；没有可比的版本为 null", () => {
  equal(newestWakeflowArtifactVersion([null, "1.2.0", "1.10.0", "bogus", "1.3.0"]), "1.10.0");
  equal(newestWakeflowArtifactVersion(["1.2.0-rc.1", "1.2.0"]), "1.2.0-rc.1");
  equal(newestWakeflowArtifactVersion([null, null]), null);
  equal(newestWakeflowArtifactVersion([]), null);
});

test("manifest 字节解析出摘要与 version：version 缺席、不是文本、形状不对、不是 JSON 对象或不是 UTF-8 时为 null，摘要照样有", () => {
  const bytes = encodeUtf8(
    JSON.stringify({ kind: "WakeflowPluginArtifactManifest", version: "1.2.0" }),
  );
  deepEqual(parseWakeflowArtifactManifestIdentity(bytes), {
    version: "1.2.0",
    manifestDigest: computeSha256Digest(bytes),
  });
  equal(parseWakeflowArtifactManifestIdentity(encodeUtf8('{"version":12}')).version, null);
  equal(parseWakeflowArtifactManifestIdentity(encodeUtf8('{"version":"v1"}')).version, null);
  equal(parseWakeflowArtifactManifestIdentity(encodeUtf8('{"kind":"x"}')).version, null);
  equal(parseWakeflowArtifactManifestIdentity(encodeUtf8('["1.2.0"]')).version, null);
  const plain = encodeUtf8("first");
  deepEqual(parseWakeflowArtifactManifestIdentity(plain), {
    version: null,
    manifestDigest: computeSha256Digest(plain),
  });
  equal(parseWakeflowArtifactManifestIdentity(new Uint8Array([0xff, 0xfe, 0x7b])).version, null);
});
