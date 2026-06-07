# Test Skills

These optional local skills help Test windows plan and run real-scenario
validation. They do not replace the workspace AGENTS rules, controller
state-root boundaries, product repository rules, or Wakeflow target skills.

Use a skill only when the current controller state root or test card assigns a
matching Test task:

- `risk-based-test-strategy/SKILL.md`: choose a minimal but meaningful test
  scope from risk, user impact, and changed surfaces.
- `diagnostic-feedback-loop/SKILL.md`: reproduce, isolate, and verify a
  failing or uncertain runtime behavior.
- `behavior-first-regression-evidence/SKILL.md`: prove user-visible or
  operator-visible behavior without overfitting to implementation details.
- `e2e-playwright-practices/SKILL.md`: design maintainable browser tests
  around user-visible behavior.
- `accessibility-test-plan/SKILL.md`: plan accessibility evidence for a real
  scenario.
- `web-security-test-triage/SKILL.md`: scope authorized web/API security
  checks without expanding into unrelated penetration testing.

Keep source-specific test helpers with the owning product repository. Keep
hard Wakeflow execution gates in AGENTS.md.
