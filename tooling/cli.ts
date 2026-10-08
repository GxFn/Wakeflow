import path from "node:path";
import { CaptureError } from "./capture/io.js";
import { prepareCapture } from "./capture/plan.js";
import { inspectCapture, runCapture } from "./capture/run.js";
import { summarizeAtlasDrift } from "./atlas/drift.js";
import { BuildLockError } from "./build-lock.js";
import { collectDiagnosticBundle, inspectDiagnosticBundle } from "./diagnostics/bundle.js";
import { checkHandoff } from "./handoff/handoff.js";
import { reportChangeImpact } from "./impact/change-impact.js";
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
import { callArtifactTool, parseToolArguments } from "./mcp/call.js";
import { captureHostReceipt } from "./live/receipt.js";
import { planVersionBump } from "./release/bump-version.js";
import { refreshPluginCache } from "./release/cache-refresh.js";
import {
  applyTestDurations,
  scaffoldGateLogNode,
  scaffoldRequirement,
  scaffoldTest,
} from "./scaffold/scaffold.js";
import { listFaultSuites, runFaultSuite } from "./testing/fault-suites.js";
import { triageFlakyTests } from "./testing/flaky.js";
import { selectImpactedTests } from "./testing/impacted-tests.js";
import { proposeTestDurations } from "./testing/test-duration-report.js";
import { exportCiVerification, verifyCiBundle } from "./verification/export-ci.js";
import { terminateOwnedCommands } from "./verification/process.js";
import { type VerificationProfile, verifyRepository } from "./verification/verify.js";
import { isMainModule } from "./main-module.js";

const HELP = `Wakeflow maintainer tools (run from the repository root)

npm run wf -- verify quick --files tests/path.test.ts [--concurrency N]
npm run wf -- verify quick --changed [--since REF] [--concurrency N]
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
npm run wf -- impact tests [--since REF]
npm run wf -- impact report [--since REF]
npm run wf -- handoff [--no-artifacts]
npm run wf -- release bump --version X.Y.Z[-pre] [--apply]
npm run wf -- mcp call --candidate ARTIFACT_DIR --root WORKSPACE --tool wakeflow_status [--input JSON_FILE | --arguments JSON]
npm run wf -- cache refresh --host claude-code [--yes] [--installed DIR] [--cli PATH]
npm run wf -- test flaky --files tests/path.test.ts [...] --runs N
npm run wf -- atlas drift
npm run wf -- scaffold test --for src/path.ts [--apply]
npm run wf -- scaffold node --section 13.N --title TITLE [--apply]
npm run wf -- scaffold requirement (--root WORKSPACE | --design DIR) --name NAME --title TITLE [--apply]
npm run wf -- timings apply --receipt .build/verification/run-ID/receipt.json

Verification writes private receipts under .build/verification/. It never rebuilds plugins/ implicitly.
Doctor reads only. Imported runtime reports are unverified; no command installs, trusts or activates a plugin.
Lab creates synthetic dual-product fixtures, never host chats/projects. Evidence survives disposal.
Business scenarios allocate a NEW root, run fixed fixtures, then seal ownership. Failure retains the root without automatic disposal; no resume or inventory adoption.
Live records plans, attempts and imported receipts. Imported evidence cannot establish native-host acceptance.
Doctor collection stores explicit private files and projected stdio observations; export writes a separate allowlisted summary, never uploads or repairs a workspace.
Capture freezes imported test contracts and explicit commands. Run executes one declared step once; it never decides test acceptance, retries or imports evidence.
Impact lists the tests reached by a change set through static imports (tests) or classifies the whole change set by ownership with the commands to run next (report); both are focusing aids, never a substitute for the full gate.
Handoff runs the read-only pre-handoff checklist (whitespace, private content, build:check, docs pointers, Git state) and writes nothing.
Release bump edits only assets/release/version.json and the Claude marketplace entry; rebuilding, committing, tagging and cache refreshes stay separate actions.
Every verify, handoff build:check and \`npm run locked -- <command>\` holds the one repository build lock (.build/locks/build.lock).
Mcp call starts a new stdio process on a verified artifact copy and calls one public tool once; mutations are real, so use only disposable workspaces. It proves nothing about an existing chat's MCP.
Cache refresh runs the host CLI only with --yes (uninstall, then install) and compares the cache manifest with the committed artifact; windows still need a restart or resume.
Test flaky repeats one focused run N times under the build lock and never retries a failure away. Atlas drift only reads the map subproject's own check.
Scaffold writes a failing test skeleton, a gate-log section header or a Design draft pair (requirement.md and landing.md from the Design skill's own skeletons) only with --apply; timings apply rewrites the tracked duration table, which is a new repository input.
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
        "--changed",
        "--since",
        "--no-artifacts",
        "--version",
        "--apply",
        "--tool",
        "--arguments",
        "--host",
        "--yes",
        "--cli",
        "--runs",
        "--for",
        "--section",
        "--title",
        "--design",
        "--name",
      ].includes(key) ||
      values.has(key)
    )
      invalid();
    const collected: string[] = [];
    while (i < args.length && !args[i]?.startsWith("--")) collected.push(args[i++] ?? "");
    if (
      ["--preview", "--changed", "--no-artifacts", "--apply", "--yes"].includes(key)
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

function runVerifyCommand(
  action: string | undefined,
  options: Map<string, string[]>,
  root: string,
  signal?: AbortSignal,
) {
  if (action !== "quick" && action !== "gate" && action !== "artifact") invalid();
  if (
    [...options.keys()].some(
      (key) => !["--files", "--concurrency", "--changed", "--since"].includes(key),
    )
  )
    invalid();
  const files = options.get("--files") ?? [];
  const changed = options.has("--changed");
  if (action !== "quick" && (files.length > 0 || changed || options.has("--since"))) invalid();
  if (action === "quick" && files.length > 0 === changed) invalid();
  if (options.has("--since") && !changed) invalid();
  if (action === "artifact" && options.has("--concurrency")) invalid();
  const concurrency = options.get("--concurrency")?.[0];
  const since = options.get("--since")?.[0];
  return verifyRepository(root, {
    profile: action as VerificationProfile,
    files,
    ...(changed ? { changed: true } : {}),
    ...(since === undefined ? {} : { since }),
    ...(concurrency === undefined ? {} : { concurrency }),
    ...(signal === undefined ? {} : { signal }),
  });
}

function runImpactCommand(
  action: string | undefined,
  options: Map<string, string[]>,
  root: string,
) {
  if (
    (action !== "tests" && action !== "report") ||
    [...options.keys()].some((key) => key !== "--since")
  )
    invalid();
  const since = options.get("--since")?.[0];
  if (action === "report") return reportChangeImpact(root, since === undefined ? {} : { since });
  return {
    ...selectImpactedTests(root, since === undefined ? {} : { since }),
    status: "passed" as const,
  };
}

function runHandoffCommand(
  action: string | undefined,
  options: Map<string, string[]>,
  root: string,
  signal?: AbortSignal,
) {
  if (action !== undefined || [...options.keys()].some((key) => key !== "--no-artifacts"))
    invalid();
  return checkHandoff(root, {
    artifacts: !options.has("--no-artifacts"),
    ...(signal === undefined ? {} : { signal }),
  });
}

function runReleaseCommand(
  action: string | undefined,
  options: Map<string, string[]>,
  root: string,
) {
  const version = options.get("--version")?.[0];
  if (
    action !== "bump" ||
    version === undefined ||
    [...options.keys()].some((key) => key !== "--version" && key !== "--apply")
  )
    invalid();
  return planVersionBump(root, version, { apply: options.has("--apply") });
}

function runMcpCommand(
  action: string | undefined,
  options: Map<string, string[]>,
  root: string,
  signal?: AbortSignal,
) {
  const candidate = options.get("--candidate")?.[0];
  const workspace = options.get("--root")?.[0];
  const tool = options.get("--tool")?.[0];
  if (
    action !== "call" ||
    candidate === undefined ||
    workspace === undefined ||
    tool === undefined ||
    [...options.keys()].some(
      (key) => !["--candidate", "--root", "--tool", "--input", "--arguments"].includes(key),
    )
  )
    invalid();
  const file = options.get("--input")?.[0];
  const inline = options.get("--arguments")?.[0];
  return callArtifactTool(
    {
      candidate: path.resolve(root, candidate),
      workspace: path.resolve(root, workspace),
      tool,
      arguments: parseToolArguments(root, {
        ...(file === undefined ? {} : { file }),
        ...(inline === undefined ? {} : { inline }),
      }),
    },
    signal,
  );
}

function runCacheCommand(action: string | undefined, options: Map<string, string[]>, root: string) {
  const hostId = options.get("--host")?.[0];
  if (
    action !== "refresh" ||
    hostId === undefined ||
    [...options.keys()].some((key) => !["--host", "--yes", "--installed", "--cli"].includes(key))
  )
    invalid();
  const cli = options.get("--cli")?.[0];
  const installed = options.get("--installed")?.[0];
  return refreshPluginCache(root, {
    hostId,
    yes: options.has("--yes"),
    ...(cli === undefined ? {} : { cli: path.resolve(root, cli) }),
    ...(installed === undefined ? {} : { installed }),
  });
}

function runTestCommand(
  action: string | undefined,
  options: Map<string, string[]>,
  root: string,
  signal?: AbortSignal,
) {
  const files = options.get("--files");
  const runs = options.get("--runs")?.[0];
  if (
    action !== "flaky" ||
    files === undefined ||
    runs === undefined ||
    [...options.keys()].some((key) => key !== "--files" && key !== "--runs")
  )
    invalid();
  return triageFlakyTests(root, { files, runs, ...(signal === undefined ? {} : { signal }) });
}

function runAtlasCommand(action: string | undefined, options: Map<string, string[]>, root: string) {
  if (action !== "drift" || options.size !== 0) invalid();
  return summarizeAtlasDrift(root);
}

function runScaffoldCommand(
  action: string | undefined,
  options: Map<string, string[]>,
  root: string,
) {
  const apply = options.has("--apply");
  if (action === "test") {
    const target = options.get("--for")?.[0];
    if (
      target === undefined ||
      [...options.keys()].some((key) => key !== "--for" && key !== "--apply")
    )
      invalid();
    return scaffoldTest(root, { for: target, apply });
  }
  const title = options.get("--title")?.[0];
  if (action === "requirement") {
    const name = options.get("--name")?.[0];
    const workspace = options.get("--root")?.[0];
    const design = options.get("--design")?.[0];
    if (
      name === undefined ||
      title === undefined ||
      [...options.keys()].some(
        (key) => !["--root", "--design", "--name", "--title", "--apply"].includes(key),
      )
    )
      invalid();
    return scaffoldRequirement(root, {
      ...(workspace === undefined ? {} : { workspace: path.resolve(root, workspace) }),
      ...(design === undefined ? {} : { design: path.resolve(root, design) }),
      name,
      title,
      apply,
    });
  }
  const section = options.get("--section")?.[0];
  if (
    action !== "node" ||
    section === undefined ||
    title === undefined ||
    [...options.keys()].some((key) => !["--section", "--title", "--apply"].includes(key))
  )
    invalid();
  return scaffoldGateLogNode(root, { section, title, apply });
}

function runTimingsCommand(
  action: string | undefined,
  options: Map<string, string[]>,
  root: string,
) {
  const receipt = options.get("--receipt")?.[0];
  if ((action !== "export" && action !== "apply") || options.size !== 1 || receipt === undefined)
    invalid();
  if (action === "apply") return applyTestDurations(root, receipt);
  return {
    kind: "WakeflowTestDurationProposal",
    schemaVersion: 1,
    status: "passed" as const,
    table: proposeTestDurations(root, path.resolve(root, receipt)),
    changesApplied: false,
  };
}

type CommandHandler = (
  action: string | undefined,
  options: Map<string, string[]>,
  root: string,
  signal?: AbortSignal,
) => unknown;

const COMMANDS: Readonly<Record<string, CommandHandler>> = Object.freeze({
  capture: runCaptureCommand,
  live: runLiveCommand,
  ci: runCiCommand,
  lab: runLabCommand,
  fault: runFaultCommand,
  verify: runVerifyCommand,
  impact: runImpactCommand,
  handoff: runHandoffCommand,
  release: runReleaseCommand,
  timings: runTimingsCommand,
  doctor: runDoctorCommand,
  mcp: runMcpCommand,
  cache: runCacheCommand,
  test: runTestCommand,
  atlas: runAtlasCommand,
  scaffold: runScaffoldCommand,
});

export async function runToolingCli(args: readonly string[], root: string, signal?: AbortSignal) {
  const [command, second, ...rest] = args;
  const handler = command === undefined ? undefined : COMMANDS[command];
  if (handler === undefined) invalid();
  // 没有动作的命令（handoff）直接跟标志：第二个词以 `--` 开头时它属于选项，不是动作。
  const action = second?.startsWith("--") === true ? undefined : second;
  const options = flags(action === undefined && second !== undefined ? [second, ...rest] : rest);
  return (await handler(action, options, root, signal)) as Awaited<
    ReturnType<
      | typeof runCaptureCommand
      | typeof runLiveCommand
      | typeof runCiCommand
      | typeof runLabCommand
      | typeof runFaultCommand
      | typeof runVerifyCommand
      | typeof runImpactCommand
      | typeof runHandoffCommand
      | typeof runReleaseCommand
      | typeof runTimingsCommand
      | typeof runDoctorCommand
      | typeof runMcpCommand
      | typeof runCacheCommand
      | typeof runTestCommand
      | typeof runAtlasCommand
      | typeof runScaffoldCommand
    >
  >;
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help")) process.stdout.write(HELP);
  else {
    const controller = new AbortController();
    // 第一次信号取消并等待子进程结算；第二次信号立刻杀掉本进程派生的进程组再退出（T7-F5）。
    const abort = () => {
      if (controller.signal.aborted) {
        terminateOwnedCommands();
        process.exit(130);
      }
      controller.abort();
    };
    process.on("SIGINT", abort);
    process.on("SIGTERM", abort);
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
                  error instanceof CaptureError ||
                  error instanceof BuildLockError
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
