# AGENTS Rule Map

This map records how Wakeflow root `AGENTS.md` rules are organized after the
2026-06-08 optimization pass. It is a governance reference, not an additional
authority layer. If this file and `AGENTS.md` differ, `AGENTS.md` wins.

## Hard Gates That Must Stay In AGENTS.md

- Gate conclusion and Stop Card discipline.
- Controller think-first and no keyword-reflex execution gate.
- Machine envelope evidence-first rule.
- User decision and scope promotion gates.
- Controller/Product/Design/Test role boundaries.
- Test boundary and acceptance floor.
- Direct-thread, thread-id, target-result, and controller-return boundaries.
- Repository protection, cross-repo deletion, compatibility cleanup, and
  verification floor.

## Line-Range Review

| Old lines | Review | Optimization |
| --- | --- | --- |
| 3-20 | First Rule, machine envelope gate, and unattended stop were all hard gates, but split the same entry discipline across three paragraphs. | Merged into `Gate Flow`; kept envelope evidence-first and unattended completion stop as separate rules inside that flow. |
| 22-51 | Natural language interpretation and managed-workspace orientation were valid, but the prose repeated the same “do not replace user intent” idea and mixed Wakeflow source identity with workspace entry sync. | Condensed prose interpretation into ordered gate steps; moved Wakeflow identity to file introduction and kept workspace entry sync as a distinct orientation rule. |
| 53-134 | Stop Card had good coverage but many bullets overlapped: authority vs evidence vs loop drift vs dispatch drift. A narrow sourceRef warning was too incident-shaped for a reusable file. | Grouped stops by failure type; generalized sourceRef/source-location into diagnostic metadata and metric misuse; kept all hard stop meanings. |
| 136-176 | Controller identity and repository roles repeated role boundaries in two adjacent sections. | Merged into `Role Map`; preserved controller, Product, Design, Test, Wakeflow, and host-agent responsibilities. |
| 178-203 | Twelve decision questions were useful but over-specified and partially duplicated Stop Card / Confirmation Gates. | Condensed to seven questions that preserve goal, gap, partition, evidence, confirmation, TODO/Test/dependency, and identity checks. |
| 205-234 | Task partitions were already the right abstraction and should not be hidden in a skill. | Kept in AGENTS with tighter wording. |
| 236-254 | Confirmation rules duplicated suggestion-promotion and scope-change checks. | Merged into fewer confirmation gates while preserving delete/replace/downgrade/phase-order checks. |
| 256-284 | Testing and acceptance rules were necessary but repeated Test-only language and split thin-implementation handling. | Kept acceptance floor; merged thin-implementation checks; kept detailed mechanics in `testing-validation.md`. |
| 286-342 | Dispatch/TODO/automation rules are central hard boundaries, but some command details were mixed with transport authority rules. | Kept direct-thread, compact prompt, controller-return, thread-id, and retired-route rules; clarified that scripts create state but do not replace acceptance. |
| 344-363 | Workspace ledger rules are standing boundaries but detailed placement belongs in the ledger reference. | Kept concise placement and privacy rules; pointer remains `wakeflow-ledgers.md`. |
| 365-378 | Requirement-to-wave rules protect against thin phases and premature dispatch. | Kept as standing phase-order rules. |
| 380-391 | Script rules mixed automation behavior with verification command discipline. | Renamed section to `Scripts And Verification`; dispatch behavior stays in dispatch section, script command floor remains here. |
| 393-415 | Standard dispatch prompt is useful only as a compact prompt shape. | Kept compact prompt and kept wave-specific details out of AGENTS. |
| 417-454 | Skill layering was correct but lacked a durable migration reference. | Kept layering rules and added this rule map to the reference map. |
| 456-475 | Cross-repo cleanup and compatibility rules are broad enough and protect destructive work. | Kept with wording unchanged except surrounding structure. |
| 477-500 | Technical stack and verification rules are target-repo safety floors. | Kept; detailed commands remain only as verification triggers. |

## Migration Summary

| Previous area | Decision | Current owner |
| --- | --- | --- |
| First Rule, Natural Language Gate, and Correct Order | Merged into one ordered entry gate. | `AGENTS.md#Gate Flow` and `AGENTS.md#Highest Stop Card` |
| Individual Stop Card bullets for script output, backfill, status, and templates | Kept and grouped by authority, evidence, loop drift, dispatch drift, and rule governance. | `AGENTS.md#Highest Stop Card` |
| Narrow sourceRef/source-location warning | Generalized to diagnostic metadata, source-location notes, labels, scores, and metrics. | `AGENTS.md#Stop For Loop Or Implementation Drift` |
| Duplicate thin-interface, empty-shell, static mock, and scaffold warnings | Merged into one goal-replacement / thin-delivery stop rule and one acceptance rule. | `AGENTS.md#Highest Stop Card` and `AGENTS.md#Testing And Acceptance` |
| Controller Identity and Repository Roles | Merged into the role map. | `AGENTS.md#Role Map` |
| Twelve-item Decision Checklist | Condensed into seven decision questions while preserving goal, gap, evidence, confirmation, TODO, Test, and identity checks. | `AGENTS.md#Decision Questions` |
| Task Partitions | Kept as the primary flow classifier, with wording tightened. | `AGENTS.md#Task Partitions` |
| Confirmation Gates | Merged duplicate scope/phase/completion-definition checks. | `AGENTS.md#Confirmation Gates` |
| Testing and Acceptance Boundaries | Kept, with duplicate Test-only wording removed and acceptance floor preserved. | `AGENTS.md#Testing And Acceptance`; details in `testing-validation.md` |
| Dispatch, TODO, and Automation Boundaries | Kept, preserving compact prompt, real thread id, controller-return, and no target-to-target hop rules. | `AGENTS.md#Dispatch, TODO, And Automation`; details in `wakeflow-delivery.md` and `window-dispatch.md` |
| Workspace Governance and Ledgers | Kept, with operational placement delegated to the ledger reference. | `AGENTS.md#Workspace Governance And Ledgers`; details in `wakeflow-ledgers.md` |
| Requirement-To-Wave Flow | Kept as standing scope/phase-order rule. | `AGENTS.md#Requirement-To-Wave Flow` |
| Scripts And Automation | Split into dispatch behavior and script verification. | `AGENTS.md#Dispatch, TODO, And Automation`, `AGENTS.md#Scripts And Verification`, and `script-pipeline.md` |
| Standard Dispatch Prompt | Kept as compact prompt template only. | `AGENTS.md#Standard Dispatch Prompt`; examples in `window-dispatch.md` |
| Skill Layers and reference map | Kept and extended with this migration map. | `AGENTS.md#Skill And Rule Layers` |
| Cross-repository integration and deletion | Kept because it protects multi-repo cleanup and compatibility decisions. | `AGENTS.md#Cross-Repository Integration, Deletion, And Compatibility Cleanup` and `phased-migration.md` |
| Technical stack and verification | Kept because these are target-repo safety floors. | `AGENTS.md#Technical Stack And Verification` |

## Optimization Notes

- Rules that blocked known recurring failures stayed in `AGENTS.md`.
- Operation sequences, examples, and script-specific details stay in skills and
  references.
- Product-specific names, historical incident labels, and one-repository
  artifacts should not appear in generic AGENTS text.
- A narrow rule should become generic when the same failure can happen in many
  workflows; it should move to a skill/reference when it only describes command
  order or troubleshooting.

## Lightening pass (2026-06-19)

Six operational sections in `AGENTS.md` were condensed to pointers, with their
hard rules kept inline and the operational detail left to the owning references:

- Task Partitions -> `skills/wakeflow-governance/SKILL.md` (flow catalog).
- Standard Dispatch Prompt -> `references/window-dispatch.md` (copyable template).
- Requirement-To-Wave Flow -> `references/window-dispatch.md` (wave/package detail).
- Workspace Governance And Ledgers -> `references/wakeflow-ledgers.md`.
- Scripts And Verification -> `references/script-pipeline.md`.
- Dispatch, TODO, And Automation -> `references/wakeflow-delivery.md` +
  `skills/wakeflow-controller/` + `skills/wakeflow-target/` (envelope fields,
  host-thread send mechanics, keep-live, review flow).

Kept verbatim: Highest Stop Card, Confirmation Gates, Gate Flow, Role Map, the
acceptance floor, the cross-repo deletion rules, and the Technical-Stack verify
lines (the last are setup-render transform targets — do not remove them).

Already enforced by code/tooling (prose kept as a one-line gate, not re-described):
- "real thread ids only in `.wakeflow-local/`" — register-thread + the P1-0
  redaction guard enforce it.
- "use the MCP surface, do not call scripts directly" — the installed-workspace
  setup transform rewrites script paths into the MCP wording.
- "run verification after a wave" — `wakeflow_verify` is an MCP tool; setup
  rewrites the prose into the installed-workspace MCP wording.
