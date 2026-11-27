import { equal, ok } from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import { scanPrivacyText } from "../../src/kernel/privacy-scan.js";
import { modelTestOptions } from "../../tooling/testing/model-options.js";
import { persistModelCounterexample } from "../support/model-counterexample.js";

interface Model {
  credential: boolean;
  opaque: boolean;
}
interface Real {
  text: string;
}
// 路径与 UUID 两种操作随它们的规则一起删掉了（ADR-0031）：`plain` 留着，证明这类文本不产生命中也不遮住凭证。
type Operation = "credential" | "format" | "opaque" | "plain" | "reset";
const syntheticSecret = "synthetic-property-value";

/** The model knows only which hazards were introduced, never the scanner's regexes or offsets. */
class TextCommand implements fc.Command<Model, Real> {
  readonly operation: Operation;
  readonly position: number;
  constructor(operation: Operation, position: number) {
    this.operation = operation;
    this.position = position;
  }
  check(): boolean {
    return true;
  }
  toString(): string {
    return `${this.operation}(${this.position})`;
  }
  run(model: Model, real: Real): void {
    switch (this.operation) {
      case "credential":
        real.text += `\nPASSWORD=${syntheticSecret}\n`;
        model.credential = true;
        break;
      case "format": {
        const position = this.position % (real.text.length + 1);
        real.text = `${real.text.slice(0, position)}\u001b[31m${real.text.slice(position)}\u001b[0m`;
        break;
      }
      case "opaque":
        real.text = `\u0000${real.text}`;
        model.opaque = true;
        break;
      case "plain":
        real.text +=
          "\n/private/fixture.txt and unknown_demand_cccccccc-cccc-4ccc-8ccc-cccccccccccc\n";
        break;
      case "reset":
        real.text = "";
        model.credential = false;
        model.opaque = false;
        break;
    }
    const result = scanPrivacyText(real.text);
    // §13.161 B9-5：opaque 不是漏掉凭证的借口。
    if (model.credential) ok(result.findings.some((f) => f.kind === "credential-assignment"));
    else equal(result.findings.length, 0);
    if (model.opaque) equal(result.opaque, true);
    equal(JSON.stringify(result).includes(syntheticSecret), false);
    for (const finding of result.findings)
      ok(finding.line >= 1 && finding.column >= 1 && finding.length > 0);
  }
}

const options = modelTestOptions(process.env);
test(`privacy command model: seed=${options.seed}, runs=${options.numRuns}`, (t) => {
  t.diagnostic(
    JSON.stringify({
      ...options,
      technique: "pure-stateful-model",
      durability: "not-applicable",
      maxCommands: 24,
    }),
  );
  const command = fc
    .tuple(
      fc.constantFrom<Operation>("credential", "format", "opaque", "plain", "reset"),
      fc.nat({ max: 2048 }),
    )
    .map(([operation, position]) => new TextCommand(operation, position));
  try {
    fc.assert(
      fc.property(
        fc.commands([command], {
          maxCommands: 24,
          ...(options.replayPath === undefined ? {} : { replayPath: options.replayPath }),
        }),
        (commands) => {
          fc.modelRun(
            () => ({
              model: { credential: false, opaque: false },
              real: { text: "" },
            }),
            commands,
          );
        },
      ),
      {
        seed: options.seed,
        numRuns: options.numRuns,
        ...(options.path === undefined ? {} : { path: options.path }),
      },
    );
  } catch (error: unknown) {
    // 反例落盘到 .build/model/，带本次 seed；回放用 WAKEFLOW_MODEL_SEED 与 WAKEFLOW_MODEL_PATH。
    const file = persistModelCounterexample(process.cwd(), "privacy-command-model", options, error);
    if (file !== null) t.diagnostic(`counterexample persisted: ${file}`);
    throw error;
  }
});
