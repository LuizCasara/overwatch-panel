# LESSONS - auto-maintained by scripts/lessons.py

> Machine-owned. Do NOT hand-edit. Changes are overwritten on the next `lessons.py` write.
> Canonical state lives in `.specs/lessons.json`. Edit lessons only via the script.
> promote_threshold=2 distinct features · window_days=45 · quarantine_threshold=2

## Confirmed (load these at Specify/Design)

Corroborated across multiple features. Safe to apply as guidance.

_none_

## Candidates (under observation - do NOT load as guidance yet)

Seen once or not yet corroborated. Tracked, not trusted.

### L-001 - Test TTL/threshold comparisons at the exact boundary value, not only just-inside and just-outside it, so a > vs >= mutation is caught.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `testing` · harmful: 0
- features: session-overwatch-panel
- evidence: panel/format.js:43 (testing)
- last seen: 2026-09-13T10:44:49Z

### L-002 - When a hook's behavior is scoped by a static matcher/config string, assert the exact matcher value in a test, not just the resulting command string.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `install` · harmful: 0
- features: session-overwatch-panel
- evidence: scripts/install-lib.js:14 (install)
- last seen: 2026-09-13T10:44:58Z

### L-003 - When manual verification substitutes a mock for the real external dependency the AC requires exercising, disclose it explicitly and treat it as an open coverage gap, not full coverage.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `verification` · harmful: 0
- features: session-overwatch-panel
- evidence: OVW-17 (verification)
- last seen: 2026-09-13T10:44:58Z

### L-004 - Keep process-spawning side effects out of pure event handlers; wire them at the dispatch/main level so handlers stay unit-testable without mocking child_process.
- signal: `spec_deviation` · recurrence: 1 feature(s) · scope: `architecture` · harmful: 0
- features: session-overwatch-panel
- evidence: scripts/overwatch.js:278 (architecture)
- last seen: 2026-09-13T10:44:58Z

## Quarantined (failed when applied - ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
