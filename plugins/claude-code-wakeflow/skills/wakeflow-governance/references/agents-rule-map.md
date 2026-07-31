# CLAUDE.md Rule Map

Claude Code auto-loads `CLAUDE.md` from the working directory. This file is a
navigation and maintenance map for the reusable Wakeflow rules, not an
additional authority layer. If wording differs, `CLAUDE.md` wins.

## Current Ownership

| Rule family | Current owner |
| --- | --- |
| Controller entry posture and evidence-first judgment | `CLAUDE.md#Controller Posture` |
| Controller, Product, Design, Test, Wakeflow, and host roles | `CLAUDE.md#Role Map` |
| Task classification and execution partition | `CLAUDE.md#Task Partitions` |
| Auto Claim limits | `CLAUDE.md#Auto-Claim Boundary` |
| Test boundary and acceptance floor | `CLAUDE.md#Testing And Acceptance` plus `testing-validation.md` |
| Dispatch, TODO, transport, result, Pod, and automation gates | `CLAUDE.md#Dispatch, TODO, And Automation` plus `wakeflow-delivery.md` and `wakeflow-controller/SKILL.md` |
| Workspace ledgers, local runtime, and privacy | `CLAUDE.md#Workspace Governance And Ledgers` plus `wakeflow-ledgers.md` |
| Requirement-to-wave planning | `CLAUDE.md#Requirement-To-Wave Flow` plus `window-dispatch.md` |
| Script maintenance and verification | `CLAUDE.md#Scripts And Verification` plus `script-pipeline.md` |
| Bounded target prompt semantics | `CLAUDE.md#Standard Dispatch Prompt`; exact template in `window-dispatch.md` |
| Rule/Skill/reference layering | `CLAUDE.md#Skill And Rule Layers` |
| Cross-repository integration and destructive boundaries | `CLAUDE.md#Cross-Repository Integration, Deletion, And Compatibility Cleanup` plus `phased-migration.md` |
| Repository technical safety floor | `CLAUDE.md#Technical Stack And Verification` |

## Historical Migration

The old reusable-template headings `Gate Flow`, `Highest Stop Card`,
`Decision Questions`, and `Confirmation Gates` were removed in 2026-06-21.
Operator-specific stop cards and decision rituals now belong to each installed
workspace's preserved `## Personal Operating Constraints`. They are not
current anchors in this reusable `CLAUDE.md`.

## Maintenance Rules

- Keep identity, authority, safety, and acceptance rules in `CLAUDE.md`.
- Keep command order, prompt examples, troubleshooting, and runtime detail in
  Skills/references.
- A prompt template must describe the generated runtime shape, not a historical
  compact form.
- Product-specific incidents and stale line-number maps do not belong here.
- When moving a hard rule, record its new current owner before deleting the old
  wording.
