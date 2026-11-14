import { deepEqual, equal, ok } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * 级别 4（维护者工具）：认知复杂度的允许清单只减不增（open-items L2，gate-log §13.245）。
 *
 * `biome.json` 里有一份按文件的清单，清单里的文件不受复杂度上限约束——它是把整目录豁免改成逐文件登记时
 * 留下的欠账，拆一个函数、撤一个文件。这里钉两件事：清单里的每个文件都还在（批 8 清出六条指向已删除
 * 文件的条目，它们在那里放了几个月）；条数不超过登记的数字。拆分让某个文件不再超限时，把它从清单里
 * 撤掉并把这里的数字降下来；新文件不进清单，超限就拆。
 */

const ALLOWLIST_CEILING = 106;

interface BiomeOverride {
  readonly includes?: readonly string[];
  readonly linter?: {
    readonly rules?: {
      readonly complexity?: { readonly noExcessiveCognitiveComplexity?: unknown };
    };
  };
}

test("复杂度允许清单：每个文件都存在，条数不超过登记的上限（open-items L2）", () => {
  const config = JSON.parse(readFileSync("biome.json", "utf8")) as {
    readonly overrides: readonly BiomeOverride[];
  };
  const exemptions = config.overrides.filter(
    (override) => override.linter?.rules?.complexity?.noExcessiveCognitiveComplexity === "off",
  );
  equal(exemptions.length, 1, "one allowlist, not several");
  const files = exemptions[0]?.includes ?? [];
  ok(files.length > 0);
  deepEqual(
    files.filter((file) => file.includes("*")),
    [],
    "the allowlist names files, never patterns",
  );
  deepEqual(
    files.filter((file) => !existsSync(file)),
    [],
    "entries for files that no longer exist",
  );
  equal(new Set(files).size, files.length, "no duplicate entries");
  equal(
    files.length,
    ALLOWLIST_CEILING,
    "the allowlist changed: lower the ceiling after a split, never raise it for new code",
  );
});
