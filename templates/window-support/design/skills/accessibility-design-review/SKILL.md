---
name: accessibility-design-review
description: Use in a Wakeflow Design window when a requirement, flow, or handoff needs accessibility risks, constraints, and acceptance signals before implementation or Test work.
---

# Accessibility Design Review

Use this skill to make accessibility requirements explicit while the work is
still in Design.

## Review Areas

- Perceivable: text alternatives, contrast expectations, responsive layout,
  content order, media alternatives, and non-color cues.
- Operable: keyboard path, focus order, target size, motion sensitivity,
  timeout behavior, and safe cancellation.
- Understandable: labels, instructions, error messages, consistent navigation,
  and language clarity.
- Robust: semantic structure, assistive technology expectations, form roles,
  live updates, and compatibility risks.

## Output

- Accessibility-sensitive user scenarios.
- Required interaction states, including focus, loading, error, empty, disabled,
  and recovery states.
- Known risks and questions for controller or product windows.
- Suggested validation route: controller self-check, product unit/integration
  test, Test real scenario, or manual assistive review.

## Stop Conditions

- The design cannot describe keyboard or non-pointer operation for an
  interactive workflow.
- Error and recovery behavior are undefined for a user-critical path.
- The requested visual direction conflicts with accessibility requirements and
  needs a user or developer decision.

## References

- W3C WCAG 2.2: https://www.w3.org/TR/WCAG22/
- WAI Easy Checks: https://www.w3.org/WAI/test-evaluate/preliminary/
