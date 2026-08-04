export const wakeflowRuleIds = Object.freeze({
  identity: "WF-IDENTITY",
  repositoryBoundary: "WF-REPOSITORY-BOUNDARY",
  stateAuthority: "WF-STATE-AUTHORITY",
  demandFreeze: "WF-DEMAND-FREEZE",
  testGate: "WF-TEST-GATE",
  destructiveReleaseGate: "WF-DESTRUCTIVE-RELEASE-GATE",
  skillRouting: "WF-SKILL-ROUTING",
});

function rule(id, heading, body) {
  return `<!-- wakeflow:rule:${id} -->\n## ${heading}\n\n${body.trim()}`;
}

function list(lines) {
  return lines.filter(Boolean).map((line) => `- ${line}`).join("\n");
}

export function renderRootWorkspaceMemory({
  workspaceName,
  hostName,
  generatedBanner,
  usageBanner = "",
  configPath,
  activeIndex,
  activeStatus,
  currentDir,
  requirementDir,
  goalStageDir,
  workspaceLedgerDir,
  archiveDir,
  controllerWindow,
  designWindow,
  testWindow,
}) {
  const sections = [
    `# ${workspaceName} Agent Instructions`,
    generatedBanner,
    usageBanner,
    rule(wakeflowRuleIds.identity, "Identity and first read", list([
      `This is the \`${controllerWindow}\` total-control workspace on ${hostName}. Total control owns cross-repository sequencing and final acceptance; it does not replace product-repository responsibility windows.`,
      `Read \`${configPath}\`, \`${activeIndex}\`, and \`${activeStatus}\` before acting. For active work, then read the selected state root under \`${currentDir}/<demand-key>/\` and its task packages.`,
      `A user prompt wakes the workflow; it does not override the frozen demand, task package, repository rules, or current state.`,
    ])),
    rule(wakeflowRuleIds.repositoryBoundary, "Repository boundary", list([
      "Total control may inspect all registered repositories and validate returned work, but product implementation belongs to the assigned responsibility window and repository.",
      "Dispatch only bounded task packages. Do not silently edit a product repository to bypass a missing or failed child-window result.",
      "Controller-created demands are allowed, but they use the same requirement-authority contract as Design-created demands.",
    ])),
    rule(wakeflowRuleIds.stateAuthority, "State and document authority", list([
      "`controller-events.jsonl` is the state-transition record; `wakeflow-state.json` is its current snapshot. Markdown status, progress text, prompts, and Agent claims are projections only.",
      `Requirement definitions belong in \`${requirementDir}/<demand-key>/\`; goal/stage decisions belong in \`${goalStageDir}/\`; long-lived workspace records belong in \`${workspaceLedgerDir}/\`.`,
      `Use the matching window ledger only for responsibility-window history. Archive output belongs in \`${archiveDir}/\`; host identities, transport, and runtime evidence remain local runtime facts.`,
      "Use Wakeflow capabilities for state changes. Do not hand-edit state JSON, event history, delivery records, or host registries.",
    ])),
    rule(wakeflowRuleIds.demandFreeze, "Demand freeze gate", list([
      `\`${designWindow}\` drafts are discussion artifacts, not execution authority. Promote confirmed demand-defining files to \`${requirementDir}/<demand-key>/\` before freezing anchors.`,
      "Do not create implementation task packages until objective, scope, non-goals, acceptance, validation, and repository ownership are anchored by the demand authority.",
      "If redesign is needed, preserve the original authority and record an explicit decision/delta; do not silently rewrite the original requirement.",
      "Stop when authority is missing, stale, contradictory, or points to a draft/non-canonical location.",
    ])),
    rule(wakeflowRuleIds.testGate, "Controller validation and Test gate", list([
      "Total control independently validates functional completeness and correctness before acceptance; child-window completion claims and evidence references are review inputs, not acceptance.",
      `Use \`${testWindow}\` only after the implementation chain is controller-accepted and an anchored test objective exists. Test explores real-environment boundary and hidden failures; it must not invent product goals or replace controller acceptance.`,
    ])),
    rule(wakeflowRuleIds.destructiveReleaseGate, "Destructive and release gate", list([
      "Do not reset, revert, delete user work, rewrite history, mutate unrelated repositories, or bypass a blocked workflow unless the user explicitly authorizes that action.",
      "Commit, push, tag, publish, release, cache refresh, and destructive cleanup require explicit user authorization and remain separate from ordinary workflow completion.",
    ])),
    rule(wakeflowRuleIds.skillRouting, "Skill routing", list([
      "Use `wakeflow-controller` for delivery/review/accept/rework/complete/archive decisions and `wakeflow-governance` for setup, intake, document placement, window coverage, Pod intent, and workspace verification.",
      "Responsibility windows use `wakeflow-target`; implementation/rework also loads `wakeflow-target-craft`. Design and Test use their local skill maps for method, not for changing authority or scope.",
      "Detailed Pod, transport, readback, archive, retry, and host-operation sequences live in the matching Skill/reference. Do not reconstruct them from this memory file.",
    ])),
  ];
  return sections.filter(Boolean).join("\n\n");
}

export function renderResponsibilityAccessCard({
  coordinates,
  identityLines,
  boundaryLines,
  stateLines,
  freezeLines,
  testLines,
  destructiveLines,
  skillLines,
  documentLines,
}) {
  return [
    "## Workspace Access Card",
    "This managed block provides stable identity and authority boundaries. Detailed execution procedure comes from the assigned task package and matching Wakeflow Skills.",
    `### Coordinates\n\n${list(coordinates)}`,
    rule(wakeflowRuleIds.identity, "Identity and first read", list(identityLines)),
    rule(wakeflowRuleIds.repositoryBoundary, "Repository boundary", list(boundaryLines)),
    rule(wakeflowRuleIds.stateAuthority, "State authority", list(stateLines)),
    rule(wakeflowRuleIds.demandFreeze, "Demand freeze gate", list(freezeLines)),
    rule(wakeflowRuleIds.testGate, "Test gate", list(testLines)),
    rule(wakeflowRuleIds.destructiveReleaseGate, "Destructive and release gate", list(destructiveLines)),
    rule(wakeflowRuleIds.skillRouting, "Skill routing", list(skillLines)),
    `## Document destinations\n\n${list(documentLines)}`,
  ].join("\n\n");
}

export function renderInternalRoleMemory({
  role,
  hostName,
  parentMemory,
  activeIndex,
  activeStatus,
  currentDir,
  requirementDir,
  goalStageDir,
  windowLedger,
  testExchange,
}) {
  if (role !== "design" && role !== "test") {
    throw new Error(`Unsupported Wakeflow internal role: ${role}`);
  }
  const design = role === "design";
  const title = design ? "Design Window Instructions" : "Test Window Instructions";
  const roleName = design ? "Design" : "Test";
  const identity = design
    ? [
        `This is the ${roleName} responsibility window on ${hostName}. Clarify and design requirements; do not implement product code, accept delivery, or control workflow state.`,
        `Read this file, \`${parentMemory}\`, \`${activeIndex}\`, and \`${activeStatus}\` first. Then read the relevant local Skill and the explicitly selected demand/state material under \`${currentDir}/\`.`,
      ]
    : [
        `This is the ${roleName} responsibility window on ${hostName}. Test only an anchored, controller-accepted implementation objective; do not own product acceptance or implementation.`,
        `Read this file, \`${parentMemory}\`, \`${activeIndex}\`, \`${activeStatus}\`, \`${testExchange}\`, and the assigned test package first. Then load the smallest matching local Test Skill.`,
      ];
  const boundary = design
    ? [
        "Work in Design conversation and Design-local drafts only. Do not edit product repositories or dispatch implementation work.",
        "A Design handoff proposes a confirmed requirement to total control; it is not itself a state transition or task package.",
      ]
    : [
        "Run only the authorized real-environment test boundary. Do not repair product code, expand to unrelated tools, or turn a local test plan into a new product requirement.",
        "Report discovered failures and evidence to total control; total control decides acceptance, rework, or a new demand.",
      ];
  const state = [
    "`controller-events.jsonl` and `wakeflow-state.json` are controller-owned facts. Local notes, prompts, and Agent claims are not workflow state.",
    `Write responsibility-window history only to \`${windowLedger}/\`; never use it as demand authority.`,
  ];
  const freeze = design
    ? [
        "Drafts stay under `docs/current/`. They are not executable and must not be frozen from that location.",
        `After user confirmation, promote demand-defining files to \`${requirementDir}/<demand-key>/\`. Goal/stage decisions belong in \`${goalStageDir}/\`; total control then freezes authority and creates work.`,
        "Keep the original objective, boundaries, non-goals, acceptance, validation intent, and repository ownership explicit. Stop if confirmation or ownership is unresolved.",
      ]
    : [
        `The test objective and expected behavior must trace to frozen demand authority under \`${requirementDir}/<demand-key>/\` and the assigned test package.`,
        "Do not invent targets, strengthen requirements, or let an internal test plan replace the original objective. Stop on missing, stale, or contradictory anchors.",
      ];
  const testGate = design
    ? ["Design records the intended validation boundary; it does not execute Test work or declare controller acceptance."]
    : ["Start only after total control has validated and accepted the implementation chain. Test looks for environmental, integration, and hidden boundary failures beyond that acceptance baseline."];
  const destructive = [
    "Do not modify product code, tracked workflow state, Git history, live data, or unrelated repositories.",
    "Commit, push, tag, release, publish, cache refresh, destructive cleanup, and scope expansion require explicit user/controller authorization.",
  ];
  const skills = design
    ? [
        "Read `skills/README.md`; use the smallest matching skill for clarification, option planning, requirement design, slicing, or handoff.",
        "Skills define the method. They do not authorize file writes, state changes, dispatch, or scope expansion.",
      ]
    : [
        "Read `skills/README.md`; use the smallest matching skill for strategy, triage, regression, evidence review, or progressive-chain validation.",
        "Skills define the test method. They do not authorize new requirements, product fixes, controller acceptance, or scope expansion.",
      ];
  return [
    `# ${title}`,
    rule(wakeflowRuleIds.identity, "Identity and first read", list(identity)),
    rule(wakeflowRuleIds.repositoryBoundary, "Repository boundary", list(boundary)),
    rule(wakeflowRuleIds.stateAuthority, "State and write authority", list(state)),
    rule(wakeflowRuleIds.demandFreeze, "Demand authority", list(freeze)),
    rule(wakeflowRuleIds.testGate, "Test gate", list(testGate)),
    rule(wakeflowRuleIds.destructiveReleaseGate, "Destructive and release gate", list(destructive)),
    rule(wakeflowRuleIds.skillRouting, "Skill routing", list(skills)),
  ].join("\n\n");
}
