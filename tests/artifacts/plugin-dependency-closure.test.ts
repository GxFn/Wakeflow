import { deepEqual, equal, match, ok, throws } from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import {
  collectVendoredFiles,
  resolveRuntimeDependencyClosure,
} from "../../tooling/artifacts/plugin-dependency-closure.js";

/**
 * 运行时依赖闭包（§13.101 D5）在一次性仓库上核对：锁文件 v3 的传递求解、已装版本核对，以及
 * 五种拒绝——未安装、开发依赖、工作区链接、版本漂移、嵌套安装；文件复制剪掉类型、source map
 * 与 Markdown，保留 LICENSE 与 `package.json`。真实仓库的闭包由 `plugin-artifacts.test.ts` 覆盖。
 */

const INTEGRITY =
  "sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";

interface FixturePackage {
  readonly name: string;
  readonly version: string;
  readonly installedVersion?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly dev?: boolean;
  readonly link?: boolean;
  readonly nested?: boolean;
  readonly files?: Readonly<Record<string, string>>;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** 一个带 `package-lock.json` 与 `node_modules/` 的一次性仓库根。 */
function repositoryFixture(t: TestContext, packages: readonly FixturePackage[]): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "wakeflow-dependency-closure-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const lockPackages: Record<string, unknown> = { "": { name: "fixture", version: "0.0.0" } };
  for (const entry of packages) {
    lockPackages[`node_modules/${entry.name}`] = entry.link
      ? { resolved: "plugins/linked", link: true }
      : {
          version: entry.version,
          resolved: `https://registry.invalid/${entry.name}/-/${entry.name}-${entry.version}.tgz`,
          integrity: INTEGRITY,
          ...(entry.dev === true ? { dev: true } : {}),
          ...(entry.dependencies === undefined ? {} : { dependencies: entry.dependencies }),
        };
    const packageRoot = path.join(root, "node_modules", entry.name);
    if (entry.link) {
      mkdirSync(path.join(root, "plugins", "linked"), { recursive: true });
      mkdirSync(path.dirname(packageRoot), { recursive: true });
      symlinkSync(path.join(root, "plugins", "linked"), packageRoot);
      continue;
    }
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(
      path.join(packageRoot, "package.json"),
      json({ name: entry.name, version: entry.installedVersion ?? entry.version }),
    );
    for (const [relative, content] of Object.entries(entry.files ?? {})) {
      mkdirSync(path.dirname(path.join(packageRoot, relative)), { recursive: true });
      writeFileSync(path.join(packageRoot, relative), content);
    }
    if (entry.nested) {
      mkdirSync(path.join(packageRoot, "node_modules", "inner"), { recursive: true });
      writeFileSync(path.join(packageRoot, "node_modules", "inner", "package.json"), "{}\n");
    }
  }
  writeFileSync(
    path.join(root, "package-lock.json"),
    json({ name: "fixture", version: "0.0.0", lockfileVersion: 3, packages: lockPackages }),
  );
  return root;
}

function expectClosureErrorCode(code: string): (error: unknown) => true {
  return (error: unknown): true => {
    ok(error instanceof Error, "抛出的必须是 Error");
    equal(error.name, "PluginDependencyClosureError");
    equal((error as { readonly code?: unknown }).code, code);
    return true;
  };
}

test("传递闭包按锁文件求解：直接包展开为已排序的精确版本集合，每个包记下完整性与依赖名", (t) => {
  const root = repositoryFixture(t, [
    { name: "alpha", version: "1.2.3", dependencies: { beta: "^2.0.0", "@scope/gamma": "1.0.0" } },
    { name: "beta", version: "2.5.0", dependencies: { "@scope/gamma": "1.0.0" } },
    { name: "@scope/gamma", version: "1.0.0" },
    { name: "unrelated", version: "9.9.9" },
  ]);
  const closure = resolveRuntimeDependencyClosure(root, ["alpha"]);
  deepEqual(
    closure.map((entry) => `${entry.name}@${entry.version}`),
    ["@scope/gamma@1.0.0", "alpha@1.2.3", "beta@2.5.0"],
  );
  deepEqual(closure.find((entry) => entry.name === "alpha")?.dependencies, [
    "@scope/gamma",
    "beta",
  ]);
  for (const entry of closure) match(entry.integrity, /^sha512-/u);
});

test("未安装、开发依赖、工作区链接、版本漂移与嵌套安装各以稳定错误码拒绝", (t) => {
  throws(
    () => resolveRuntimeDependencyClosure(repositoryFixture(t, []), ["ghost"]),
    expectClosureErrorCode("wakeflow-artifact-dependency-missing"),
  );
  throws(
    () =>
      resolveRuntimeDependencyClosure(
        repositoryFixture(t, [{ name: "only-dev", version: "1.0.0", dev: true }]),
        ["only-dev"],
      ),
    expectClosureErrorCode("wakeflow-artifact-dependency-dev"),
  );
  throws(
    () =>
      resolveRuntimeDependencyClosure(
        repositoryFixture(t, [{ name: "linked", version: "0.0.0", link: true }]),
        ["linked"],
      ),
    expectClosureErrorCode("wakeflow-artifact-dependency-link"),
  );
  throws(
    () =>
      resolveRuntimeDependencyClosure(
        repositoryFixture(t, [{ name: "drifted", version: "1.0.0", installedVersion: "1.0.1" }]),
        ["drifted"],
      ),
    expectClosureErrorCode("wakeflow-artifact-dependency-drift"),
  );
  throws(
    () =>
      resolveRuntimeDependencyClosure(
        repositoryFixture(t, [
          { name: "alpha", version: "1.0.0", dependencies: { beta: "1.0.0" } },
        ]),
        ["alpha"],
      ),
    expectClosureErrorCode("wakeflow-artifact-dependency-missing"),
  );
  const nested = repositoryFixture(t, [{ name: "nested", version: "1.0.0", nested: true }]);
  throws(
    () => collectVendoredFiles(nested, resolveRuntimeDependencyClosure(nested, ["nested"])),
    expectClosureErrorCode("wakeflow-artifact-dependency-nested"),
  );
});

test("复制运行时文件：剪掉 .ts/.mts/.cts/.map/.md 与隐藏文件，保留 LICENSE 与 package.json，路径排序", (t) => {
  const root = repositoryFixture(t, [
    {
      name: "shaped",
      version: "1.0.0",
      files: {
        "dist/index.js": "export {};\n",
        "dist/index.d.ts": "export {};\n",
        "dist/index.js.map": "{}\n",
        "dist/index.mjs": "export {};\n",
        "README.md": "# shaped\n",
        LICENSE: "MIT\n",
        ".npmignore": "x\n",
        "src/index.ts": "export {};\n",
      },
    },
  ]);
  const files = collectVendoredFiles(root, resolveRuntimeDependencyClosure(root, ["shaped"]));
  deepEqual(
    files.map((file) => file.path),
    [
      "node_modules/shaped/LICENSE",
      "node_modules/shaped/dist/index.js",
      "node_modules/shaped/dist/index.mjs",
      "node_modules/shaped/package.json",
    ],
  );
  equal(files[0]?.bytes.toString("utf8"), "MIT\n");
});
