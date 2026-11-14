import { deepEqual, ok } from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

/**
 * 级别 4（维护者工具）：宿主专属知识在宿主层之外的清点（open-items L6，gate-log §13.245）。
 *
 * 依赖方向的检查只看 import：切片不引用 `src/hosts`，架构门就是绿的。可宿主的知识不靠 import 也渗得
 * 进来——tmux 的坐标与 pane、Codex 的线程、桌面会话、以宿主命名的配置键。这里把它们在 `src/hosts` 与
 * `src/contracts`（公共合同的词汇本来就点名观察种类）之外的每一处出现数出来，钉成一张清单：清单之外的
 * 文件出现这些词即失败；清单之内的文件多了要说明为什么、少了要把数字降下来。它不要求今天就搬走——
 * endpoint 切片按公共合同的观察种类分派，这是合同的一部分；它保证的是这类知识不再悄悄扩散，并且写明
 * 每一处为什么在那里。注释不计，只数代码。
 */

const VOCABULARY =
  /tmux|\bpanes?\b|codex-thread|desktop-session|create_thread|"claude-code"|"codex"/giu;

const INVENTORY: Readonly<Record<string, readonly [count: number, why: string]>> = Object.freeze({
  // 公共合同的观察种类（tmux-panes、codex-thread、desktop-session）由 endpoint 切片分派：合同词汇。
  "src/capabilities/endpoint/contract.ts": [3, "wire observation kinds"],
  "src/capabilities/endpoint/decide.ts": [27, "decisions over the wire observation kinds"],
  "src/capabilities/endpoint/service.ts": [33, "dispatch on the wire observation kinds"],
  // 两份纯函数模块：定位记录的两种形状与 tmux pane 的存活分类。搬到宿主 profile 之后是 L6 的余项。
  "src/capabilities/endpoint/locator-store.ts": [27, "locator records per transport"],
  "src/capabilities/endpoint/pane-classification.ts": [33, "tmux pane liveness classification"],
  "src/capabilities/delivery/prompt.ts": [1, "prompt text names the host action"],
  // 配置文档的 hosts 段以宿主标识为键：配置合同。
  "src/configuration/wakeflow-config-document.ts": [13, "config keys under hosts"],
  // 组合根：每个制品在这里固定自己的宿主，本来就该点名。
  "src/entrypoints/claude-code-wakeflow-maintenance.ts": [1, "composition root"],
  "src/entrypoints/claude-code-wakeflow-mcp.ts": [14, "composition root"],
  "src/entrypoints/codex-wakeflow-maintenance.ts": [1, "composition root"],
  "src/entrypoints/codex-wakeflow-mcp.ts": [8, "composition root"],
  "src/entrypoints/wakeflow-hook-observer.ts": [11, "shared observer entry keyed by --host"],
  "src/workspace/wakeflow-legacy-residue-scan.ts": [1, "0.9.x residue kinds"],
  "src/workspace/workspace-host-resource-profile.ts": [14, "the host profile contract itself"],
});

function sourceFiles(directory: string, out: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "generated") sourceFiles(absolute, out);
    } else if (entry.name.endsWith(".ts")) out.push(absolute);
  }
  return out;
}

/** 去掉块注释与行注释：清点的是代码里的词，不是解释它的文字。 */
function codeOnly(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/(^|[^:"'`])\/\/[^\n]*/gu, "$1");
}

test("宿主专属词汇在宿主层与合同层之外只出现在清单点名的文件里，次数与清单一致（open-items L6）", () => {
  const root = path.join(process.cwd(), "src");
  const actual: Record<string, number> = {};
  for (const file of sourceFiles(root).sort()) {
    const relative = path.relative(process.cwd(), file).split(path.sep).join("/");
    if (relative.startsWith("src/hosts/") || relative.startsWith("src/contracts/")) continue;
    const count = codeOnly(readFileSync(file, "utf8")).match(VOCABULARY)?.length ?? 0;
    if (count > 0) actual[relative] = count;
  }
  ok(Object.keys(actual).length > 0, "the scan found the known sites");
  deepEqual(
    actual,
    Object.fromEntries(Object.entries(INVENTORY).map(([file, [count]]) => [file, count])),
    "host-specific vocabulary moved: update the inventory with the reason, or move the knowledge into src/hosts",
  );
});
