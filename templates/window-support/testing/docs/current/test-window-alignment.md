# Test Window Alignment

This directory can act as Wakeflow's built-in Test surface.

- New control flow is state-root first: Wakeflow writes machine test cards under
  `<state-root>/test-cards/*.json`.
- The configured `test-exchange.md` is a short projection / exchange surface
  when useful; it is not the state authority for new demands.
- Keep probe scripts and real-environment evidence here only when the test
  truly needs a Test-owned environment.
- Product fixes still belong in the owning product repository.
