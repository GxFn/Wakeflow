---
name: accessibility-test-plan
description: Use in a Wakeflow Test window when a controller-assigned scenario requires accessibility evidence across keyboard, semantics, content, or assistive-technology-relevant behavior.
---

# Accessibility Test Plan

Use this skill to plan accessibility evidence for a real workflow.

## Checks

- Keyboard-only path and visible focus.
- Correct names, roles, labels, headings, and landmarks.
- Error identification, recovery, and form guidance.
- Color contrast and non-color cues.
- Reflow/responsive behavior and zoom tolerance.
- Reduced motion, timeouts, dialogs, and live updates.

## Evidence

- Automated scan output when available.
- Manual keyboard walkthrough notes.
- Screenshot or trace for focus and error states.
- Specific WCAG-related risk statement, without overstating certification.

## Stop Conditions

- The workflow cannot be exercised without credentials or data that were not
  authorized by the controller.
- The finding requires a product design decision; return it to Design or the
  controller instead of silently choosing behavior.

## References

- W3C WCAG 2.2: https://www.w3.org/TR/WCAG22/
- WAI Easy Checks: https://www.w3.org/WAI/test-evaluate/preliminary/
