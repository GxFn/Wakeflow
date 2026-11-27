/**
 * Wakeflow 的层与层级表（ADR-0013 决定 A，补记二）：`.dependency-cruiser.cjs` 由它生成方向规则，
 * `tooling/architecture/check-dependencies.ts` 拿它核对 `src/` 下的实际目录。改层或改层级只改这里。
 *
 * LAYER_IMPORTS：每层可以引用的层（含自己）。entrypoints 是组合根，可以引用一切，不在表里设限。
 * capabilities 与 hosts 并列在 application 之上：宿主只实现 workspace 定义的端口，不取得 governance、
 * application 与 capabilities。
 *
 * SLICE_LEVELS：一层之内的切片层级，自下而上。一个切片只引用更低层级的切片，同一层级的切片互不引用；
 * "(root)" 是直接放在层目录下的文件；只放 JSON 的目录（`contracts/schemas`）不是切片。新切片必须先进
 * 这张表（check-dependencies 核对表与目录一致）；kernel、configuration、entrypoints 只有一个切片，
 * capabilities 与 hosts 的切片互不引用，都不需要层级。
 * 依据是实际的导入：Demand 事件携带的记录种类在 demand 之下，读写 Demand 根的在 demand 里，发布证据
 * 这个操作在 demand 之上，读遍整个 Demand 状态的读模型在最上。
 */

const LAYER_IMPORTS = Object.freeze({
  foundation: ["foundation"],
  contracts: ["foundation", "contracts"],
  kernel: ["foundation", "contracts", "kernel"],
  configuration: ["foundation", "contracts", "kernel", "configuration"],
  governance: ["foundation", "contracts", "kernel", "configuration", "governance"],
  workspace: ["foundation", "contracts", "kernel", "configuration", "governance", "workspace"],
  application: [
    "foundation",
    "contracts",
    "kernel",
    "configuration",
    "governance",
    "workspace",
    "application",
  ],
  capabilities: [
    "foundation",
    "contracts",
    "kernel",
    "configuration",
    "governance",
    "workspace",
    "application",
    "capabilities",
  ],
  hosts: ["foundation", "contracts", "kernel", "configuration", "workspace", "hosts"],
  entrypoints: null,
});

const SLICE_LEVELS = Object.freeze({
  contracts: [["generated"], ["identity", "vocabulary"]],
  foundation: [
    ["error", "node"],
    ["numeric", "text", "time"],
    ["data"],
    ["crypto", "event-sourcing", "resource", "schema"],
    ["identity"],
    ["filesystem"],
    ["artifact", "git"],
  ],
  governance: [
    ["ledger", "pod"],
    ["evidence", "lifecycle", "tasking"],
    ["testing"],
    ["delivery"],
    ["result"],
    ["review"],
    ["demand"],
    ["evidence-publication"],
    ["controller", "observation"],
  ],
  workspace: [
    ["(root)"],
    ["active-projection", "host-runtime", "managed-integration", "window-runtime"],
    ["support"],
    ["maintenance"],
  ],
  application: [["observation"]],
});

module.exports = { LAYER_IMPORTS, SLICE_LEVELS };
