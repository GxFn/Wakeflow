---
name: e2e-playwright-practices
description: Use in a Wakeflow Test window when a controller-assigned real scenario needs Playwright or browser automation evidence.
---

# E2E Playwright Practices

Use this skill to keep browser validation focused, stable, and user-centered.

## Principles

- Test user-visible behavior, not implementation details.
- Prefer role, label, text, and semantic locators over brittle selectors.
- Keep each test isolated with explicit setup and teardown.
- Avoid arbitrary sleeps; wait for observable UI, network, or state changes.
- Keep assertions close to the user outcome.
- Preserve trace, screenshot, video, console, or network evidence when useful.

## Wakeflow Output

- Scenario name and assigned state root.
- Browser/project configuration.
- Test command and environment.
- Evidence path for trace/report/screenshot/log.
- Result summary, failure analysis, and residual risk.

## Stop Conditions

- The scenario has no assigned Test card or repository boundary.
- The app state cannot be set up repeatably.
- A failing test points to product ownership outside Test; report it instead of
  repairing product code from Test.

## References

- Playwright best practices: https://playwright.dev/docs/best-practices
- Testing Library guiding principles: https://testing-library.com/docs/guiding-principles
