import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";

import {
  assembleHelperAsset,
  checkHelperAssets,
  HELPER_ASSET_DEFINITIONS,
  HelperAssetCodegenError,
  renderHelperAssetModule,
} from "../../tooling/codegen/helper-assets.js";

/**
 * 级别 5（制品与发布）：Claude Code 助手的装配器与它的生成模块。
 *
 * 助手源文件按片段共用、发布出去却是自包含脚本，中间只有这一步内联。它不是通用打包器：只接受一套收窄的
 * 写法，其余报错。这里钉三件事——提交的生成模块与当前源文件没有漂移；装配的次序与 ESM 的求值顺序一致、
 * 导入合并成每个模块一条、片段的 `export` 去掉；收窄之外的写法逐条被拒绝而不是被猜。
 */

function reader(files: Readonly<Record<string, string>>): (file: string) => string {
  return (file) => {
    const text = files[file];
    if (text === undefined) throw new Error(`no such source: ${file}`);
    return text;
  };
}

function rejects(files: Readonly<Record<string, string>>, message: RegExp): void {
  throws(
    () => assembleHelperAsset(reader(files), "entry.mjs"),
    (error: unknown) =>
      error instanceof HelperAssetCodegenError &&
      error.code === "wakeflow-helper-assets-source" &&
      message.test(error.message),
  );
}

test("提交的生成模块与当前源文件一致：两个助手从入口加共用片段装配，状态栏脚本是单个入口", () => {
  const result = checkHelperAssets(process.cwd());
  equal(result.mode, "check");
  deepEqual(
    result.helpers.map((helper) => helper.entry),
    HELPER_ASSET_DEFINITIONS.map(
      (definition) => `src/hosts/claude-code/assets/${definition.entry}`,
    ),
  );
  const byEntry = new Map(result.helpers.map((helper) => [helper.entry.split("/").at(-1), helper]));
  for (const entry of ["tmux.mjs", "desktop.mjs"]) {
    const helper = byEntry.get(entry);
    ok(helper !== undefined && helper.sources > 1, `${entry} inlines shared fragments`);
    ok(helper.tokens > 0, `${entry} carries build tokens for the runtime to fill`);
    ok(helper.lines > 1000);
  }
  const statusline = byEntry.get("statusline.mjs");
  ok(statusline !== undefined);
  equal(statusline.sources, 1);
  equal(statusline.tokens, 2);
});

test("装配：入口的文件头在最前，node: 导入合并成每个模块一条，片段按导入序的后序各出现一次，export 去掉", () => {
  const assembled = assembleHelperAsset(
    reader({
      "entry.mjs": [
        "#!/usr/bin/env node",
        "// header line",
        'import { readFileSync } from "node:fs";',
        'import path from "node:path";',
        'import { second } from "./shared/second.mjs";',
        'import { first, FIRST_LIMIT } from "./shared/first.mjs";',
        "",
        "const VALUE = __WAKEFLOW_SAMPLE_VALUE__;",
        "function main() {",
        "  return [first(), second(), FIRST_LIMIT, VALUE, readFileSync, path];",
        "}",
        "",
        "main();",
        "",
      ].join("\n"),
      "shared/first.mjs": [
        "// first fragment",
        'import { closeSync, readFileSync } from "node:fs";',
        "",
        "export const FIRST_LIMIT = __WAKEFLOW_OTHER_VALUE__;",
        "const INTERNAL = 1;",
        "",
        "export function first() {",
        "  return [INTERNAL, closeSync, readFileSync];",
        "}",
        "",
      ].join("\n"),
      "shared/second.mjs": [
        'import { createHash } from "node:crypto";',
        'import { first } from "./first.mjs";',
        "",
        "export function second() {",
        "  return [first(), createHash];",
        "}",
        "",
      ].join("\n"),
    }),
    "entry.mjs",
  );
  equal(
    assembled.template,
    [
      "#!/usr/bin/env node",
      "// header line",
      'import { createHash } from "node:crypto";',
      'import { closeSync, readFileSync } from "node:fs";',
      'import path from "node:path";',
      "",
      "// first fragment",
      "const FIRST_LIMIT = __WAKEFLOW_OTHER_VALUE__;",
      "const INTERNAL = 1;",
      "",
      "function first() {",
      "  return [INTERNAL, closeSync, readFileSync];",
      "}",
      "",
      "function second() {",
      "  return [first(), createHash];",
      "}",
      "",
      "const VALUE = __WAKEFLOW_SAMPLE_VALUE__;",
      "function main() {",
      "  return [first(), second(), FIRST_LIMIT, VALUE, readFileSync, path];",
      "}",
      "",
      "main();",
      "",
    ].join("\n"),
  );
  // second 导入 first：first 先于 second，尽管入口先写了 second。
  deepEqual(assembled.sources, ["shared/first.mjs", "shared/second.mjs", "entry.mjs"]);
  deepEqual(assembled.tokens, ["__WAKEFLOW_OTHER_VALUE__", "__WAKEFLOW_SAMPLE_VALUE__"]);
});

test("生成模块按行写出模板：逐行的字符串字面量拼回去就是模板本身，记号清单随之导出", () => {
  const template = 'line "one"\n\tline \\two ＠ 🙂\nconst X = __WAKEFLOW_SAMPLE_VALUE__;\n';
  const rendered = renderHelperAssetModule(
    { entry: "entry.mjs", constantPrefix: "SAMPLE_HELPER", output: "sample.generated.ts" },
    { template, tokens: ["__WAKEFLOW_SAMPLE_VALUE__"], sources: ["entry.mjs"] },
  );
  ok(
    rendered.includes(
      'export const SAMPLE_HELPER_TOKENS = [\n  "__WAKEFLOW_SAMPLE_VALUE__",\n] as const;',
    ),
  );
  const body = rendered.slice(
    rendered.indexOf("export const SAMPLE_HELPER_TEMPLATE: string = [\n") +
      "export const SAMPLE_HELPER_TEMPLATE: string = [\n".length,
    rendered.lastIndexOf('].join("\\n");'),
  );
  const lines = body
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line.trim().replace(/,$/u, "")) as string);
  equal(lines.join("\n"), template);
});

test("收窄之外的写法被拒绝：别名、默认导入片段、副作用导入、动态导入、导出清单、入口导出、语句之后的导入", () => {
  const entry = (lines: readonly string[]): string => `${lines.join("\n")}\n`;
  rejects(
    { "entry.mjs": entry(['import { a as b } from "node:fs";', "b();"]) },
    /import binding must be a plain name/u,
  );
  rejects(
    {
      "entry.mjs": entry(['import fragment from "./shared/a.mjs";', "fragment();"]),
      "shared/a.mjs": "export function a() {}\n",
    },
    /fragments have no default export/u,
  );
  rejects({ "entry.mjs": entry(['import "node:fs";', "run();"]) }, /unsupported import form/u);
  rejects(
    { "entry.mjs": entry(['import * as fs from "node:fs";', "fs.x();"]) },
    /unsupported import form/u,
  );
  rejects(
    { "entry.mjs": entry(['const fs = await import("node:fs");', "fs.x();"]) },
    /dynamic imports are not supported/u,
  );
  rejects(
    { "entry.mjs": entry(['import { x } from "left-pad";', "x();"]) },
    /unsupported import source/u,
  );
  rejects(
    { "entry.mjs": entry(['import { x } from "../outside.mjs";', "x();"]) },
    /import leaves the source root/u,
  );
  rejects(
    {
      "entry.mjs": entry(['import { a } from "./shared/a.mjs";', "a();"]),
      "shared/a.mjs": "function a() {}\nexport { a };\n",
    },
    /only top-level declarations may be exported/u,
  );
  rejects(
    {
      "entry.mjs": entry(['import { a } from "./shared/a.mjs";', "a();"]),
      "shared/a.mjs": "export const a = 1,\n  b = 2;\n",
    },
    /export one name per statement/u,
  );
  rejects(
    { "entry.mjs": entry(["export function main() {}", "main();"]) },
    /a helper entry exports nothing/u,
  );
  rejects(
    {
      "entry.mjs": entry([
        'import { a } from "./shared/a.mjs";',
        "const early = 1;",
        'import path from "node:path";',
        "a(early, path);",
      ]),
      "shared/a.mjs": "export function a() {}\n",
    },
    /imports must come before any other statement/u,
  );
});

test("片段之间的循环、两个默认名、缺文件与 CRLF 被拒绝", () => {
  rejects(
    {
      "entry.mjs": 'import { a } from "./shared/a.mjs";\na();\n',
      "shared/a.mjs": 'import { b } from "./b.mjs";\nexport function a() {\n  return b;\n}\n',
      "shared/b.mjs": 'import { a } from "./a.mjs";\nexport function b() {\n  return a;\n}\n',
    },
    /import each other in a cycle/u,
  );
  rejects(
    {
      "entry.mjs": 'import path from "node:path";\nimport { a } from "./shared/a.mjs";\na(path);\n',
      "shared/a.mjs":
        'import nodePath from "node:path";\nexport function a() {\n  return nodePath;\n}\n',
    },
    /imported under two default names/u,
  );
  rejects(
    { "entry.mjs": 'import { a } from "./shared/missing.mjs";\na();\n' },
    /source file cannot be read/u,
  );
  rejects({ "entry.mjs": "const a = 1;\r\nrun(a);\r\n" }, /LF line endings/u);
});
