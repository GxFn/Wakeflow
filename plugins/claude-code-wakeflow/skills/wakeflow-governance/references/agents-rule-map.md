# CLAUDE.md Rule Map

This map records how Wakeflow root `CLAUDE.md` rules are organized after the
2026-06-08 optimization pass. On this host, Claude Code auto-loads `CLAUDE.md`
from the working directory, so it is the per-window rules file. This map is a
governance reference, not an additional authority layer. If this file and
`CLAUDE.md` differ, `CLAUDE.md` wins.

## Hard Gates That Must Stay In CLAUDE.md

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
| 22-51 | Natural language interpretation and managed-workspace orientation were valid, but the prose repeated the same "do not replace user intent" idea and mixed Wakeflow source identity with workspace entry sync. | Condensed prose interpretation into ordered gate steps; moved Wakeflow identity to file introduction and kept workspace entry sync as a distinct orientation rule. |
| 53-134 | Stop Card had good coverage but many bullets overlapped: authority vs evidence vs loop drift vs dispatch drift. A narrow sourceRef warning was too incident-shaped for a reusable file. | Grouped stops by failure type; generalized sourceRef/source-location into diagnostic metadata and metric misuse; kept all hard stop meanings. |
| 136-176 | Controller identity and repository roles repeated role boundaries in two adjacent sections. | Merged into `Role Map`; preserved controller, Product, Design, Test, Wakeflow, and host-agent responsibilities. |
| 178-203 | Twelve decision questions were useful but over-specified and partially duplicated Stop Card / Confirmation Gates. | Condensed to seven questions that preserve goal, gap, partition, evidence, confirmation, TODO/Test/dependency, and identity checks. |
| 205-234 | Task partitions were already the right abstraction and should not be hidden in a skill. | Kept in CLAUDE.md with tighter wording. |
| 236-254 | Confirmation rules duplicated suggestion-promotion and scope-change checks. | Merged into fewer confirmation gates while preserving delete/replace/downgrade/phase-order checks. |
| 256-284 | Testing and acceptance rules were necessary but repeated Test-only language and split thin-implementation handling. | Kept acceptance floor; merged thin-implementation checks; kept detailed mechanics in `testing-validation.md`. |
| 286-342 | Dispatch/TODO/automation rules are central hard boundaries, but some command details were mixed with transport authority rules. | Kept direct-thread, compact prompt, controller-return, thread-id, and retired-route rules; clarified that scripts create state but do not replace acceptance. |
| 344-363 | Workspace ledger rules are standing boundaries but detailed placement belongs in the ledger reference. | Kept concise placement and privacy rules; pointer remains `wakeflow-ledgers.md`. |
| 365-378 | Requirement-to-wave rules protect against thin phases and premature dispatch. | Kept as standing phase-order rules. |
| 380-391 | Script rules mixed automation behavior with verification command discipline. | Renamed section to `Scripts And Verification`; dispatch behavior stays in dispatch section, script command floor remains here. |
| 393-415 | Standard dispatch prompt is useful only as a compact prompt shape. | Kept compact prompt and kept wave-specific details out of CLAUDE.md. |
| 417-454 | Skill layering was correct but lacked a durable migration reference. | Kept layering rules and added this rule map to the reference map. |
| 456-475 | Cross-repo cleanup and compatibility rules are broad enough and protect destructive work. | Kept with wording unchanged except surrounding structure. |
| 477-500 | Technical stack and verification rules are target-repo safety floors. | Kept; detailed commands remain only as verification triggers. |

## Migration Summary

| Previous area | Decision | Current owner |
| --- | --- | --- |
| First Rule, Natural Language Gate, and Correct Order | Merged into one ordered entry gate. | `CLAUDE.md#Gate Flow` and `CLAUDE.md#Highest Stop Card` |
| Individual Stop Card bullets for script output, backfill, status, and templates | Kept and grouped by authority, evidence, loop drift, dispatch drift, and rule governance. | `CLAUDE.md#Highest Stop Card` |
| Narrow sourceRef/source-location warning | Generalized to diagnostic metadata, source-location notes, labels, scores, and metrics. | `CLAUDE.md#Stop For Loop Or Implementation Drift` |
| Duplicate thin-interface, empty-shell, static mock, and scaffold warnings | Merged into one goal-replacement / thin-delivery stop rule and one acceptance rule. | `CLAUDE.md#Highest Stop Card` and `CLAUDE.md#Testing And Acceptance` |
| Controller Identity and Repository Roles | Merged into the role map. | `CLAUDE.md#Role Map` |
| Twelve-item Decision Checklist | Condensed into seven decision questions while preserving goal, gap, evidence, confirmation, TODO, Test, and identity checks. | `CLAUDE.md#Decision Questions` |
| Task Partitions | Kept as the primary flow classifier, with wording tightened. | `CLAUDE.md#Task Partitions` |
| Confirmation Gates | Merged duplicate scope/phase/completion-definition checks. | `CLAUDE.md#Confirmation Gates` |
| Testing and Acceptance Boundaries | Kept, with duplicate Test-only wording removed and acceptance floor preserved. | `CLAUDE.md#Testing And Acceptance`; details in `testing-validation.md` |
| Dispatch, TODO, and Automation Boundaries | Kept, preserving compact prompt, real thread id (Claude Code session id), controller-return, and no target-to-target hop rules. | `CLAUDE.md#Dispatch, TODO, And Automation`; details in `wakeflow-delivery.md` and `window-dispatch.md` |
| Workspace Governance and Ledgers | Kept, with operational placement delegated to the ledger reference. | `CLAUDE.md#Workspace Governance And Ledgers`; details in `wakeflow-ledgers.md` |
| Requirement-To-Wave Flow | Kept as standing scope/phase-order rule. | `CLAUDE.md#Requirement-To-Wave Flow` |
| Scripts And Automation | Split into dispatch behavior and script verification. | `CLAUDE.md#Dispatch, TODO, And Automation`, `CLAUDE.md#Scripts And Verification`, and `script-pipeline.md` |
| Standard Dispatch Prompt | Kept as compact prompt template only. | `CLAUDE.md#Standard Dispatch Prompt`; examples in `window-dispatch.md` |
| Skill Layers and reference map | Kept and extended with this migration map. | `CLAUDE.md#Skill And Rule Layers` |
| Cross-repository integration and deletion | Kept because it protects multi-repo cleanup and compatibility decisions. | `CLAUDE.md#Cross-Repository Integration, Deletion, And Compatibility Cleanup` and `phased-migration.md` |
| Technical stack and verification | Kept because these are target-repo safety floors. | `CLAUDE.md#Technical Stack And Verification` |

## Optimization Notes

- Rules that blocked known recurring failures stayed in `CLAUDE.md`.
- Operation sequences, examples, and script-specific details stay in skills and
  references.
- Product-specific names, historical incident labels, and one-repository
  artifacts should not appear in generic CLAUDE.md text.
- A narrow rule should become generic when the same failure can happen in many
  workflows; it should move to a skill/reference when it only describes command
  order or troubleshooting.
