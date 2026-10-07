import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { payloadTexts } from "../../../src/capabilities/demand/archive.js";
import { payloadPrivacyBlockers } from "../../../src/capabilities/demand/decide.js";
import { computeSha256Digest } from "../../../src/foundation/crypto/sha256.js";
import { parsePortableResourcePath } from "../../../src/foundation/filesystem/portable-resource-path.js";

function file(resourcePath: string, bytes: Uint8Array) {
  return {
    resourcePath: parsePortableResourcePath(resourcePath),
    bytes,
    digest: computeSha256Digest(bytes),
  };
}

test("归档负载里夹着二进制字节的文件仍按宽松解码做凭证扫描（§13.161 B9-3）", () => {
  const secret = "synthetic".repeat(3);
  const binary = Buffer.concat([
    Buffer.from([0xff, 0xfe, 0x00]),
    Buffer.from(`\nTOKEN=${secret}\n`),
  ]);
  const texts = payloadTexts([
    file("artifacts/a.bin", binary),
    file("artifacts/b.md", Buffer.from("plain\n")),
  ]);
  equal(texts.length, 2);
  equal(texts[0]?.text.includes(`TOKEN=${secret}`), true);
  deepEqual(payloadPrivacyBlockers(texts), [
    "payload-privacy:artifacts/a.bin:2:credential-assignment",
  ]);
});
