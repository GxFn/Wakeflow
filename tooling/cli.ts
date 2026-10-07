import path from "node:path";
import { CaptureError } from "./capture/io.js";
import { prepareCapture } from "./capture/plan.js";
import { inspectCapture, runCapture } from "./capture/run.js";
import { collectDiagnosticBundle, inspectDiagnosticBundle } from "./diagnostics/bundle.js";
import {
  inspectArtifactInstallation,
  inspectDevelopmentEnvironment,
} from "./diagnostics/doctor.js";
import { exportDiagnosticSummary, inspectDiagnosticSummary } from "./diagnostics/public-summary.js";
import { inspectWorkspace } from "./diagnostics/workspace.js";
import { LabError } from "./lab/inventory.js";
import { createLab, disposeLab, inspectLab, runLab } from "./lab/lab.js";
import { BUSINESS_SCENARIOS, type BusinessScenario } from "./lab/workflow-context.js";
import { recordLiveAttempt } from "./live/attempts.js";
import { LiveError } from "./live/contracts.js";
import { verifyLiveEvidence } from "./live/evidence.js";
import { planLiveProject } from "./live/plan.js";
import { captureHostReceipt } from "./live/receipt.js";
import { listFaultSuites, runFaultSuite } from "./testing/fault-suites.js";
import { proposeTestDurations } from "./testing/test-duration-report.js";
import { exportCiVerification, verifyCiBundle } from "./verification/export-ci.js";
import { type VerificationProfile, verifyRepository } from "./verification/verify.js";
import { isMainModule } from "./main-module.js";

const HELP = `Wakeflow maintainer tools (run from the repository root)

npm run wf -- verify quick --files tests/path.test.ts [--concurrency N]
npm run wf -- verify gate [--concurrency N]
npm run wf -- verify artifact
npm run wf -- timings export --receipt .build/verification/run-ID/receipt.json
npm run wf -- doctor env
npm run wf -- doctor artifact --candidate DIR [--installed DIR] [--runtime-report FILE]
npm run wf -- doctor workspace --root WORKSPACE --candidate ARTIFACT_DIR
npm run wf -- doctor collect --root WORKSPACE --candidate ARTIFACT_DIR [--files WORKSPACE_RELATIVE_FILE ...]
npm run wf -- doctor inspect --id DIAGNOSTIC_ID
npm run wf -- doctor inspect --input EXPORTED_SUMMARY_JSON
npm run wf -- doctor export --id DIAGNOSTIC_ID
npm run wf -- lab create --dir NEW_DISPOSABLE_DIR --candidate ARTIFACT_DIR
npm run wf -- lab inspect --id LAB_ID
npm run wf -- lab run --id LAB_ID
npm run wf -- lab run --scenario single-product|dual-product|worktree --dir NEW_DISPOSABLE_DIR --candidate ARTIFACT_DIR
npm run wf -- lab dispose --id LAB_ID --preview
npm run wf -- lab dispose --id LAB_ID --plan-digest DIGEST
npm run wf -- fault list
npm run wf -- fault run --suite NAME_OR_all [--concurrency N]
npm run wf -- live plan --root WORKSPACE --candidate ARTIFACT --projects PROJECTS_JSON --host-id HOST_ID
npm run wf -- live attempt --id PLAN_ID --window WINDOW_ID
npm run wf -- live verify --id PLAN_ID --evidence EVIDENCE_JSON
npm run wf -- live receipt --request REQUEST_JSON --input RAW_TOOL_RETURN_JSON
npm run wf -- capture prepare --input SELECTION_JSON
npm run wf -- capture run --id CAPTURE_ID --step ts-N
npm run wf -- capture inspect --id CAPTURE_ID
npm run wf -- ci export --summary VERIFICATION_SUMMARY_JSON
npm run wf -- ci verify --bundle EXPORTED_REPORT_DIRECTORY

Verification writes private receipts under .build/verification/. It never rebuilds plugins/ implicitly.
Doctor reads only. Imported runtime reports are unverified; no command installs, trusts or activates a plugin.
Lab creates synthetic dual-product fixtures, never host chats/projects. Evidence survives disposal.
Business scenarios allocate a NEW root, run fixed fixtures, then seal ownership. Failure retains the root without automatic disposal; no resume or inventory adoption.
Live records plans, attempts and imported receipts. Imported evidence cannot establish native-host acceptance.
Doctor collection stores explicit private files and projected stdio observations; export writes a separate allowlisted summary, never uploads or repairs a workspace.
Capture freezes imported test contracts and explicit commands. Run executes one declared step once; it never decides test acceptance, retries or imports evidence.
`;

class UsageError extends Error {}
function invalid(): never {
  throw new UsageError("Invalid command arguments.");
}

function flags(args: readonly string[]): Map<string, string[]> {
  const values = new Map<string, string[]>();
  for (let i = 0; i < args.length; ) {
    const key = args[i++];
    if (
      key === undefined ||
      ![
        "--files",
        "--concurrency",
        "--candidate",
        "--installed",
        "--runtime-report",
        "--receipt",
        "--dir",
        "--id",
        "--scenario",
        "--preview",
        "--plan-digest",
        "--suite",
        "--root",
        "--projects",
        "--host-id",
        "--window",
        "--evidence",
        "--summary",
        "--bundle",
        "--input",
        "--request",
        "--step",
      ].includes(key) ||
      values.has(key)
    )
      invalid();
    const collected: string[] = [];
    while (i < args.length && !args[i]?.startsWith("--")) collected.push(args[i++] ?? "");
    if (
      key === "--preview"
        ? collected.length !== 0
        : collected.length === 0 || (key !== "--files" && collected.length !== 1)
    )
      invalid();
    values.set(key, collected);
  }
  return values;
}

function runLabCommand(
  action: string | undefined,
  options: Map<string, string[]>,
  root: string,
  signal?: AbortSignal,
) {
  if (action === "run" && options.has("--scenario")) {
    const scenario = options.get("--scenario")?.[0];
    const directory = options.get("--dir")?.[0];
    const candidate = options.get("--candidate")?.[0];
    if (
      options.size !== 3 ||
      directory === undefined ||
      candidate === undefined ||
      !BUSINESS_SCENARIOS.some((name) => name === scenario)
    )
      invalid();
    return createLab(
      root,
      path.resolve(root, directory),
      path.resolve(root, candidate),
      signal,
      scenario as BusinessScenario,
    );
  }
  if (action === "create") {
    const directory = options.get("--dir")?.[0];
    const candidate = options.get("--candidate")?.[0];
    if (options.size !== 2 || directory === undefined || candidate === undefined) invalid();
    return createLab(root, path.resolve(root, directory), path.resolve(root, candidate), signal);
  }
  const id = options.get("--id")?.[0];
  if (id === undefined) invalid();
  if (action === "dispose") {
    const digest = options.get("--plan-digest")?.[0];
    if (options.size !== 2 || options.has("--preview") === (digest !== undefined)) invalid();
    return disposeLab(root, id, digest);
  }
  if (options.size !== 1) invalid();
  if (action === "inspect") return inspectLab(root, id);
  if (action === "run") return runLab(root, id, signal);
  invalid();
}

function runFaultCommand(
  action: string | undefined,
  options: Map<string, string[]>,
  root: string,
  signal?: AbortSignal,
) {
  if (action === "list") {
    if (options.size !== 0) invalid();
    return listFaultSuites();
  }
  const suite = options.get("--suite")?.[0];
  if (
    action !== "run" ||
    suite === undefined ||
    [...options.keys()].some((key) => key !== "--suite" && key !== "--concurrency")
  )
    invalid();
  if (suite !== "all" && !listFaultSuites().suites.some((entry) => entry.name === suite)) invalid();
  return runFaultSuite(root, suite, options.get("--concurrency")?.[0], signal);
}

function runDoctorCommand(
  action: string | undefined,
  options: Map<string, string[]>,
  root: string,
  signal?: AbortSignal,
) {
  if (action === "collect") {
    const workspace = options.get("--root")?.[0];
    const candidate = options.get("--candidate")?.[0];
    if (
      workspace === undefined ||
      candidate === undefined ||
      [...options.keys()].some((key) => !["--root", "--candidate", "--files"].includes(key))
    )
      invalid();
    return collectDiagnosticBundle(
      root,
      path.resolve(root, workspace),
      path.resolve(root, candidate),
      options.get("--files") ?? [],
      signal,
    );
  }
  if (action === "inspect") {
    const id = options.get("--id")?.[0];
    const input = options.get("--input")?.[0];
    if (options.size !== 1 || (id === undefined) === (input === undefined)) invalid();
    return id === undefined
      ? inspectDiagnosticSummary(path.resolve(root, input ?? ""))
      : inspectDiagnosticBundle(root, id);
  }
  if (action === "export") {
    const id = options.get("--id")?.[0];
    if (options.size !== 1 || id === undefined) invalid();
    return exportDiagnosticSummary(root, id);
  }
  if (action === "workspace") {
    const workspace = options.get("--root")?.[0];
    const candidate = options.get("--candidate")?.[0];
    if (options.size !== 2 || workspace === undefined || candidate === undefined) invalid();
    return inspectWorkspace(path.resolve(root, workspace), path.resolve(root, candidate), signal);
  }
  if (action === "env") {
    if (options.size !== 0) invalid();
    return inspectDevelopmentEnvironment(root);
  }
  if (
    action !== "artifact" ||
    [...options.keys()].some(
      (key) => !["--candidate", "--installed", "--runtime-report"].includes(key),
    )
  )
    invalid();
  const candidate = options.get("--candidate")?.[0];
  if (candidate === undefined) invalid();
  const installed = options.get("--installed")?.[0];
  const runtimeReport = options.get("--runtime-report")?.[0];
  return inspectArtifactInstallation({
    candidate: path.resolve(root, candidate),
    ...(installed === undefined ? {} : { installed: path.resolve(root, installed) }),
    ...(runtimeReport === undefined ? {} : { runtimeReport: path.resolve(root, runtimeReport) }),
  });
}

function runLiveCommand(
  action: string | undefined,
  options: Map<string, string[]>,
  root: string,
  signal?: AbortSignal,
) {
  if (action === "receipt") {
    const input = options.get("--input")?.[0];
    const request = options.get("--request")?.[0];
    if (options.size !== 2 || input === undefined || request === undefined) invalid();
    return captureHostReceipt(root, path.resolve(root, request), path.resolve(root, input));
  }
  if (action === "plan") {
    const workspace = options.get("--root")?.[0];
    const candidate = options.get("--candidate")?.[0];
    const projects = options.get("--projects")?.[0];
    const hostId = options.get("--host-id")?.[0];
    if (
      options.size !== 4 ||
      workspace === undefined ||
      candidate === undefined ||
      projects === undefined ||
      hostId === undefined
    )
      invalid();
    return planLiveProject(
      root,
      path.resolve(root, workspace),
      path.resolve(root, candidate),
      path.resolve(root, projects),
      hostId,
      signal,
    );
  }
  const id = options.get("--id")?.[0];
  if (id === undefined || options.size !== 2) invalid();
  if (action === "attempt") {
    const window = options.get("--window")?.[0];
    if (window === undefined) invalid();
    return recordLiveAttempt(root, id, window, signal);
  }
  const evidence = options.get("--evidence")?.[0];
  if (action !== "verify" || evidence === undefined) invalid();
  return verifyLiveEvidence(root, id, path.resolve(root, evidence));
}

function runCaptureCommand(
  action: string | undefined,
  options: Map<string, string[]>,
  root: string,
  signal?: AbortSignal,
) {
  if (action === "prepare") {
    const input = options.get("--input")?.[0];
    if (options.size !== 1 || input === undefined) invalid();
    return prepareCapture(root, path.resolve(root, input));
  }
  const id = options.get("--id")?.[0];
  if (id === undefined) invalid();
  if (action === "inspect" && options.size === 1) return inspectCapture(root, id);
  const step = options.get("--step")?.[0];
  if (action !== "run" || options.size !== 2 || step === undefined) invalid();
  return runCapture(root, id, step, signal);
}

function runCiCommand(action: string | undefined, options: Map<string, string[]>, root: string) {
  const bundle = options.get("--bundle")?.[0];
  if (action === "verify") {
    if (options.size !== 1 || bundle === undefined) invalid();
    return verifyCiBundle(path.resolve(root, bundle));
  }
  const summary = options.get("--summary")?.[0];
  if (action !== "export" || options.size !== 1 || summary === undefined) invalid();
  return exportCiVerification(root, path.resolve(root, summary));
}

export async function runToolingCli(args: readonly string[], root: string, signal?: AbortSignal) {
  const [command, action, ...rest] = args;
  const options = flags(rest);
  if (command === "capture") return runCaptureCommand(action, options, root, signal);
  if (command === "live") return runLiveCommand(action, options, root, signal);
  if (command === "ci") return runCiCommand(action, options, root);
  if (command === "lab") return runLabCommand(action, options, root, signal);
  if (command === "fault") return runFaultCommand(action, options, root, signal);
  if (command === "verify") {
    if (action !== "quick" && action !== "gate" && action !== "artifact") invalid();
    if ([...options.keys()].some((key) => key !== "--files" && key !== "--concurrency")) invalid();
    const files = options.get("--files") ?? [];
    if ((action === "quick") !== files.length > 0) invalid();
    if (action === "artifact" && options.has("--concurrency")) invalid();
    const concurrency = options.get("--concurrency")?.[0];
    return verifyRepository(root, {
      profile: action as VerificationProfile,
      files,
      ...(concurrency === undefined ? {} : { concurrency }),
      ...(signal === undefined ? {} : { signal }),
    });
  }
  if (command === "timings") {
    const receipt = options.get("--receipt")?.[0];
    if (action !== "export" || options.size !== 1 || receipt === undefined) invalid();
    return {
      kind: "WakeflowTestDurationProposal",
      schemaVersion: 1,
      status: "passed" as const,
      table: proposeTestDurations(root, path.resolve(root, receipt)),
      changesApplied: false,
    };
  }
  if (command === "doctor") return runDoctorCommand(action, options, root, signal);
  invalid();
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help")) process.stdout.write(HELP);
  else {
    const controller = new AbortController();
    const abort = () => controller.abort();
    process.once("SIGINT", abort);
    process.once("SIGTERM", abort);
    try {
      const result = await runToolingCli(args, process.cwd(), controller.signal);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exitCode =
        "exitCode" in result
          ? result.exitCode
          : result.status === "passed"
            ? 0
            : result.status === "failed"
              ? 1
              : 2;
    } catch (error: unknown) {
      process.stdout.write(
        `${JSON.stringify({
          kind: "WakeflowToolingError",
          schemaVersion: 1,
          status: "unavailable",
          code:
            error instanceof UsageError
              ? "invalid-arguments"
              : error instanceof LabError ||
                  error instanceof LiveError ||
                  error instanceof CaptureError
                ? error.code
                : "tooling-input-or-execution-unavailable",
        })}\n`,
      );
      process.stderr.write(
        "wakeflow tooling: check arguments and repository inputs; use --help for supported commands.\n",
      );
      process.exitCode = 2;
    } finally {
      process.removeListener("SIGINT", abort);
      process.removeListener("SIGTERM", abort);
    }
  }
}
