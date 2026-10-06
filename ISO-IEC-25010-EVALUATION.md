# ISO/IEC 25010 Evaluation Protocol

This protocol adapts selected ISO/IEC 25010 product-quality characteristics
for the church-monitoring cloud web application. It is an evaluation plan, not
an ISO certification or evidence that production requirements have passed.
Record dated test results, application commit, environment, tester, and
supporting artifacts for each evaluation.

| Characteristic | Measure and acceptance target | Evidence to collect | Current status |
|---|---|---|---|
| Functional suitability | All prioritized study workflows pass their acceptance tests; no open severity-1 or severity-2 functional defects. | Trace each requirement to an API/UI test, retain test output, and record unresolved defects. | Partial: client production build and server encryption tests pass; full workflow and production integration tests remain. |
| Usability | At least 90% task completion across registration, check-in, attendance reporting, and sponsored-child updates; median System Usability Scale score at least 68 from at least 15 representative users. | Moderated task script, completion/time/error observations, anonymized SUS responses, participant count, and analysis. | Not evaluated with users. |
| Performance efficiency | Under a documented representative dataset and 100 concurrent virtual users, API p95 latency below 2 seconds for ordinary reads and below 5 seconds for reports; error rate below 1%. | Versioned load-test script, dataset dimensions, environment/resource limits, raw results, and endpoint-level p50/p95/p99. | Not measured in a production-like environment. |
| Reliability | At least 99.5% monthly availability; demonstrate one successful backup restore with RPO no greater than 24 hours and RTO no greater than 8 hours. | Provider uptime/export, incident log, backup configuration, dated restore-drill timings, and integrity checks. | Cloud availability, backups, and restore behavior are not verified here. |
| Security | No unresolved critical/high findings in dependency, configuration, and application security testing; verify role-denial cases and sensitive-data access boundaries. Verify TLS 1.3 at the public endpoint and database TLS negotiation; verify key custody and rotation operationally. | Dated scan reports, authorization tests, TLS handshake evidence for both connections, key-management configuration, rotation/restore drill, and remediation records. | Application AES-256-GCM helpers have focused tests and optional DB TLS is configurable. No deployment handshake, external security test, hardware-backed key storage, or compliance assessment has been demonstrated. |
| Maintainability | Client lint has no errors; server and analytics tests pass; new business-logic modules have at least 80% branch coverage or documented justification for uncovered paths; no known dependency vulnerabilities without a tracked remediation. | CI logs, coverage report, dependency scan, code-review record, and defect/change lead-time data. | Build and focused tests pass; existing client lint warnings remain, and system-wide coverage/dependency scans have not been produced. |

## Evaluation procedure

1. Freeze a release candidate and record its commit hash, configuration, and
   deployment versions. Use synthetic or properly de-identified test records.
2. Run the automated checks and retain full output. Trace failures to the
   affected requirement; do not count an unexecuted test as a pass.
3. Run performance, reliability/restore, TLS, and key-management checks in the
   actual production-like cloud configuration. Capture evidence rather than
   inferring service behavior from environment variables or health responses.
4. Conduct the usability sessions with informed consent and without exposing
   real children's personal information in recordings or reports.
5. Publish results with limitations, failed criteria, corrective actions, and
   retest dates. Do not call the system ISO certified based on this protocol.

## Predictive-analytics limitation

The attendance score is a transparent rule-based indicator, not a trained or
validated predictor. Before describing it as predictive, define an appropriate
outcome with child-protection oversight, collect a lawful representative
dataset, assess consent and bias risks, establish a temporal holdout, compare
against a baseline, and report calibration and error metrics. Until then, use
the score only as a review prompt and never as the sole basis for decisions
about a child.
