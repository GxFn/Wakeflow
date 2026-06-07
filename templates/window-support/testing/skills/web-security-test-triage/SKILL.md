---
name: web-security-test-triage
description: Use in a Wakeflow Test window when a controller-assigned web or API scenario needs authorized security-oriented smoke checks without broadening into unrelated penetration testing.
---

# Web Security Test Triage

Use this skill only inside an authorized Wakeflow Test boundary.

## Scope Areas

- Authentication and authorization behavior.
- Input validation and output encoding.
- Sensitive data exposure in responses, logs, storage, or screenshots.
- Session, cookie, and CSRF-relevant behavior.
- Error handling and information disclosure.
- API contract abuse cases that match the assigned feature boundary.

## Output

- Authorized target and non-targets.
- Checks performed and exact requests/steps.
- Observed behavior and evidence path.
- Risk level and owner.
- Whether the result is blocking, informational, or requires security review.

## Stop Conditions

- No explicit controller authorization.
- The proposed check would target third-party systems, unrelated repositories,
  production data, or credentials outside the test boundary.
- The result needs policy or product decision rather than Test repair.

## References

- OWASP Web Security Testing Guide: https://owasp.org/www-project-web-security-testing-guide/
- OWASP API Security Project: https://owasp.org/www-project-api-security/
