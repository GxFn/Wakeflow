import { deepEqual, equal, ok } from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { isWakeflowErrorCode } from "../../src/contracts/vocabulary/wakeflow-error-code.js";
import { LEGACY_ERROR_CODE_FAMILIES } from "../../src/kernel/legacy-error-families.js";

const SOURCE_ROOT = path.join(process.cwd(), "src");
// 声明可能被格式器折成两行（`readonly code =\n    "…"`），所以等号后允许任意空白（§13.171：foundation 出豁免时
// 发现 retirement 模块的旧码就因此漏在表外）。
const LEGACY_CODE_DECLARATION = /readonly code =\s*"(wakeflow-[a-z0-9-]+)"/gu;

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "generated") files.push(...sourceFiles(absolute));
    } else if (entry.name.endsWith(".ts")) files.push(absolute);
  }
  return files;
}

test("旧错误码家族表与源码里的旧错误类集合完全一致，每个值都是封闭码（§13.166 批次 1）", () => {
  const declared = new Set<string>();
  for (const file of sourceFiles(SOURCE_ROOT)) {
    for (const match of readFileSync(file, "utf8").matchAll(LEGACY_CODE_DECLARATION)) {
      declared.add(match[1] ?? "");
    }
  }
  ok(declared.size > 100, "the inventory scan found the legacy error classes");
  deepEqual([...Object.keys(LEGACY_ERROR_CODE_FAMILIES)].sort(), [...declared].sort());
  for (const [code, family] of Object.entries(LEGACY_ERROR_CODE_FAMILIES)) {
    ok(isWakeflowErrorCode(family), `${code} maps to a closed code`);
  }
  equal(LEGACY_ERROR_CODE_FAMILIES["wakeflow-rooted-exclusive-file-lock"], "io-failure");
  equal(LEGACY_ERROR_CODE_FAMILIES["wakeflow-demand-aggregate-state"], "precondition-failed");
  equal(LEGACY_ERROR_CODE_FAMILIES["wakeflow-json-value"], "unexpected");
});
