# Church Monitoring System

## About
The Church Monitoring System is a web application for managing church
participants, events, attendance, and child-care follow-up. It provides
authorized staff with participant records and tools to monitor participation,
education, growth, and care notes.

## System Features

- Register, search, and manage participant records.
- Manage events and record attendance using QR code check-in and check-out.
- Import event schedules from CSV or Excel files.
- Review monthly, yearly, and historical participation and attendance.
- Monitor children's growth, care notes, activities, and education history.
- Track attendance warnings and administrator follow-up.
- View dashboards, analytics, and attendance reports.
- Manage staff permissions and review audit history.
- Provide guardians with a QR-code and passcode verified portal for viewing
  their child's profile and recent attendance.

## User Roles

- **System Administrator** — Has access to all staff modules, manages staff
  accounts and permissions, and reviews audit history.
- **Church Staff** — Uses the staff modules and actions assigned by a
  System Administrator.
- **Church Goer** — Views and records attendance and, when permitted, child-care
  updates for sponsored children in their assigned education group. Access is
  restricted to that group.
- **Participant or Guardian** — Uses the verified participant portal to view
  the child's profile and recent attendance.

## Importing events

System Administrators can import event schedules from the Events page. Use the
Events import type with columns for Event Name and Starts At; Description,
Ends At, and Location are optional. Start and end values should use
`YYYY-MM-DD HH:mm:ss`. The importer previews and validates rows before saving.

[`EventsData.sql`](./EventsData.sql) is optional synthetic demo data. Running it
creates 35 completed events spanning October 2021 through November 2026 and
updates past attendance for current participants. Sponsored-child participation
statuses are assigned reproducibly to approximately 70% Active, 10% Warning,
5% Second Chance, 4% Grounds for Departure, and 11% Removed; counts are rounded
to the current non-deleted sponsored-child population.
Participation absences are counted only for activities that were scheduled:
months without events add no absences, and months with one event can add at
most one absence. Attendance is capped at two activities per month.