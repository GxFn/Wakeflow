# AGENTS Rule Map

This is a navigation and maintenance map for the reusable Wakeflow
`AGENTS.md`, not an additional authority layer. If wording differs,
`AGENTS.md` wins.

## Current Ownership

| Rule family | Current owner |
| --- | --- |
| Controller entry posture and evidence-first judgment | `AGENTS.md#Controller Posture` |
| Controller, Product, Design, Test, Wakeflow, and host roles | `AGENTS.md#Role Map` |
| Task classification and execution partition | `AGENTS.md#Task Partitions` |
| Auto Claim limits | `AGENTS.md#Auto-Claim Boundary` |
| Test boundary and acceptance floor | `AGENTS.md#Testing And Acceptance` plus `testing-validation.md` |
| Dispatch, TODO, transport, result, Pod, and automation gates | `AGENTS.md#Dispatch, TODO, And Automation` plus `wakeflow-delivery.md` and `wakeflow-controller/SKILL.md` |
| Workspace ledgers, local runtime, and privacy | `AGENTS.md#Workspace Governance And Ledgers` plus `wakeflow-ledgers.md` |
| Requirement-to-wave planning | `AGENTS.md#Requirement-To-Wave Flow` plus `window-dispatch.md` |
| Script maintenance and verification | `AGENTS.md#Scripts And Verification` plus `script-pipeline.md` |
| Bounded target prompt semantics | `AGENTS.md#Standard Dispatch Prompt`; exact template in `window-dispatch.md` |
| Rule/Skill/reference layering | `AGENTS.md#Skill And Rule Layers` |
| Cross-repository integration and destructive boundaries | `AGENTS.md#Cross-Repository Integration, Deletion, And Compatibility Cleanup` plus `phased-migration.md` |
| Repository technical safety floor | `AGENTS.md#Technical Stack And Verification` |

## Historical Migration

The old reusable-template headings `Gate Flow`, `Highest Stop Card`,
`Decision Questions`, and `Confirmation Gates` were removed in 2026-06-21.
Operator-specific stop cards and decision rituals now belong to each installed
workspace's preserved `## Personal Operating Constraints`. They are not
current anchors in this reusable `AGENTS.md`.

## Maintenance Rules

- Keep identity, authority, safety, and acceptance rules in `AGENTS.md`.
- Keep command order, prompt examples, troubleshooting, and runtime detail in
  Skills/references.
- A prompt template must describe the generated runtime shape, not a historical
  compact form.
- Product-specific incidents and stale line-number maps do not belong here.
- When moving a hard rule, record its new current owner before deleting the old
  wording.
