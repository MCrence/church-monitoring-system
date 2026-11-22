# FMC Field Care System

## About
The FMC Field Care System manages sponsored children, Church Goer records,
events, attendance, and child-care follow-up. Authorized staff can review
sponsored child information and follow education, growth, activities, and care
notes.

## System Features

- Register, search, and manage sponsored child records.
- Manage events and record attendance using QR code check-in and check-out.
- Import sponsored child information, church activities, education history,
  detailed attendance, and historical attendance summaries from CSV or Excel.
  The import workflow provides type-specific templates, validation previews,
  row-level results, and import history. Import files may be up to 5 MB and
  contain up to 20,000 data rows.
- Review monthly, yearly, and historical attendance.
- Monitor children's growth, care notes, activities, and education history.
- Track attendance warnings and administrator follow-up.
- View dashboards, analytics, and attendance reports.
- Review attendance-based Prediction Analytics with explainable rule-based
  risk scores, complete recorded attendance evidence, administrator-configurable
  weights and thresholds, and a manual refresh of current attendance data.
  Prediction scores are advisory and never change attendance or sponsorship
  status automatically.
- Reconcile the supplied official attendance file with existing sponsored
  child and church activity records by running `npm run reconcile-attendance`
  from the `server` directory. The operation links matching records without
  changing attendance dates or child sponsorship statuses.
- Manage staff permissions and review audit history.
- Provide guardians with a QR-code and passcode verified portal for viewing
  a sponsored child's profile and recent attendance.

## User Roles

- **System Administrator** — Has access to all staff modules, manages staff
  accounts and permissions, and reviews audit history.
- **Church Staff** — Uses the staff modules and actions assigned by a
  System Administrator.
- **Church Goer** — Views and records attendance and, when permitted, child-care
  updates for sponsored children in their assigned education group. Access is
  restricted to that group.
- **Participant or Guardian** — Uses the verified sponsored child portal to
  view the child's profile and recent attendance.

