# Church Monitoring System

## What this system is

This system helps church staff manage participants and record attendance. It
supports sponsored children and goers, participant profiles, QR codes, event
schedules, check-in records, and attendance reports.

## How the system works

1. Staff register a participant in the web application.
2. The system creates a participant record and a unique QR code.
3. Staff create an event schedule, such as a Sunday service.
4. The participant's QR code is scanned at the event.
5. Staff choose **Check in** or **Check out** before scanning. The server
   verifies the QR code and records the selected action for the selected event.
6. Check-out records a departure time only when an active check-in exists for
   that participant, event, and day. A second check-in for the same event/day
   remains a duplicate and is not recorded.
7. Staff can add up to five JPG, PNG, or WebP photos to an event when creating
   it or from that event's attendance view. Photos are stored with their event.
8. Staff can view check-in and check-out times with event attendance and its
   photo gallery in the event details modal.

Offline check-in requests may be queued for later synchronization; check-outs
are not queued because the server must verify the active attendance record.

Participant registration is launched from the Participants directory in a
modal; there is no separate Register navigation page.

The **client** is the web page that staff use. The **server** processes login,
participant data, QR scans, events, and attendance. The **database** stores the
participant, event, and attendance records.

## Download from GitHub

### Option 1: Download ZIP

1. Open the project repository on GitHub.
2. Click **Code**.
3. Click **Download ZIP**.
4. Extract the ZIP file.
5. Open PowerShell in the extracted project folder.

### Option 2: Clone with Git

```powershell
git clone https://github.com/YOUR-USERNAME/church-monitoring-system.git
cd church-monitoring-system
```

After downloading the project, follow the database setup and run commands
below.

## Requirements

- Node.js and npm
- MySQL or MariaDB
- Two PowerShell windows

## 1. Import the database

Create a database named `church_monitoring` in MySQL/MariaDB.

From the project folder, import the provided database file:

```powershell
mysql -u root -p church_monitoring < church_monitoringdb.sql
```

Enter your MySQL password when requested.

You can also import `church_monitoringdb.sql` using phpMyAdmin.

## 2. Configure the server

Create or update `server/.env`:

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=church_monitoring
DB_USER=root
DB_PASSWORD=your-mysql-password
JWT_SECRET=replace-with-a-random-secret-at-least-32-bytes-long
AES_KEY=your-64-character-hex-key
CLIENT_ORIGIN=http://localhost:5173
TRUST_PROXY_HOPS=0
# Optional: active key ID and JSON map of key IDs to 64-character hex keys.
# Keep AES_KEY set while legacy profile fields still use the original key.
AES_KEY_ID=primary
AES_KEYRING={"primary":"your-64-character-hex-key"}
# Development only; production always requires verified TLS 1.3.
DB_SSL=false
DB_SSL_CA=
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-username
SMTP_PASSWORD=your-smtp-password
SMTP_FROM=FMC Field Care <verified-sender@example.com>
```

Configure SMTP with credentials from your email provider. For port `465`, set
`SMTP_SECURE=true`; for port `587`, use `SMTP_SECURE=false`. The `SMTP_FROM`
address must be permitted by the provider. SMTP settings are required to send
admin email verification codes; credential changes do not require email
delivery. Render Free services block outbound SMTP ports `25`, `465`, and
`587`; email verification over SMTP therefore requires a deployment plan that
allows outbound SMTP traffic.

Sensitive profile fields continue to decrypt using `AES_KEY`. New encrypted
values use the active key in `AES_KEYRING`, selected by `AES_KEY_ID`; retain old
keys in the keyring until all data encrypted with them has been migrated. Use
unique random 32-byte keys and keep them outside source control. The server can
also read older event-photo and sponsorship-receipt blobs that were stored
without encryption; new uploads are encrypted when a valid `AES_KEY` is
configured. Do not treat this as evidence of hardware-backed key storage.

Production startup requires a 32-byte-or-longer `JWT_SECRET`, a distinct
`AES_KEY`, and an exact HTTPS `CLIENT_ORIGIN`. Database connections use
certificate-validated TLS in production and require TLS 1.3; development can
enable database TLS with `DB_SSL=true` and optionally provide `DB_SSL_CA`.
`/api/health` reports the TLS protocol negotiated by the database connection;
confirm it reports `TLSv1.3` in production.

Sign-in attempts and Guardian Portal verifications are rate-limited in a shared
database table, so the limits apply across server instances. Set
`TRUST_PROXY_HOPS` to the exact number of trusted reverse proxies in front of
the server (for example `1` behind a single platform proxy) so client IP-based
limits are accurate. Only trust forwarded IP headers when direct access to the
server is blocked and the configured proxy overwrites those headers. Rate-limit
records are retained for up to one day.

Generate a random JWT secret and a separate AES key; do not reuse values:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Set the outputs as deployment secrets, `CLIENT_ORIGIN` to the Vercel site's
exact HTTPS origin (without a trailing slash), and `TRUST_PROXY_HOPS` to the
trusted proxy count for the Render service. Existing Render/MySQL deployments
must support TLS 1.3 or the production backend intentionally fails closed;
check `/api/health` after deployment.

Production responses use Helmet security headers and HSTS. The Vercel/Render
edge TLS configuration still needs to be verified independently; the Node app
cannot prove the protocol negotiated with a user's browser from behind a TLS
terminating proxy.

Sponsored-child records include dated growth, activity, and private care-note
updates. The server creates the `sponsored_child_updates` table
non-destructively with `CREATE TABLE IF NOT EXISTS`; existing installations
retain their current records. The SQL export also includes the table for fresh
imports.

New sponsor-letter subjects and message bodies are encrypted before they are
written to the database. Existing letter subjects and messages remain readable
in their legacy plaintext format; this deployment does not rewrite existing
letter records. Existing installations receive the nullable
`subject_encrypted` column through a non-destructive schema migration.

The analytics dashboard evaluates whether a logistic model trained on the
previous 90 days of check-in history predicts no check-in in the following
30 days. It uses monthly snapshots, a chronological holdout, and a 30-day
label embargo. Validation requires at least 100 training snapshots (20 positive
from 20 participants, 20 positive and 20 negative), 30 holdout snapshots from
20 participants (10 positive and 10 negative), plus better holdout PR-AUC and
Brier score than the training-prevalence baseline and expected calibration
error no worse than that baseline. These are conservative system gates, not a
universal statistical guarantee.

The model is activated only when all sample and metric gates pass. Otherwise,
scores continue using the clearly labeled `attendance-baseline-v2` heuristic
and are not validated predictions. A passing retrospective result is still
not a guarantee of future accuracy; staff must treat scores as review prompts
and never as the sole basis for decisions about a child. The evaluation reads
only participant IDs and check-in timestamps inside the server, and stores
aggregate metrics rather than participant-level training examples. Run server
tests with:

```powershell
cd server
npm test
```

The [ISO/IEC 25010 evaluation protocol](./ISO-IEC-25010-EVALUATION.md) lists
measurable criteria and distinguishes local test results from usability,
production-cloud, and security evidence that still must be collected.

All staff and Goer sign-in uses unique email addresses. The legacy `username` column
is retained internally for existing records and schema compatibility; new
accounts receive a generated internal value that is not used to sign in. Fresh
database imports include unique username and email indexes. For an existing
database, first resolve any duplicate values, then run:

```sql
ALTER TABLE users
  ADD UNIQUE KEY uq_users_username (username),
  ADD UNIQUE KEY uq_users_email (email);
```

Email-change codes are sent to the new address, expire after 10 minutes, and
are limited to five verification attempts.

## Role-based access

The application shows pages and actions based on the signed-in user's role.
The server also checks permissions; hiding a page in the client is not the
security boundary.

| Role | Access |
| --- | --- |
| System Administrator | All staff modules, staff account registration and permission management, audit history, and personal account settings |
| Church Administrator | Personal account settings and the modules individually assigned by a System Administrator, including optional sponsored-child care access |
| Goer | Check-in, group-scoped care records, and sponsor letters for active sponsored children in one assigned education group |

Sponsored Child is a participant type. Goer is a separate staff login role and
is not assigned through participant registration. Only a System Administrator
can register accounts through the Manage Accounts page. Staff and Goer
registration collects first, middle, and last names, an email address used for
sign-in, and a temporary password. Church Administrator accounts receive
individually selected access to the dashboard, participants, events, check-in,
analytics, reports, the participant QR portal, and optionally sponsored care.
Management permission also grants the related view permission. Goer accounts
are assigned one of Elementary, Junior High School, Senior High School, or
College. They can record attendance, log a child’s received gift or allowance
with receipt proof, and create or reply to sponsor letters for active children
in their assigned group. The server enforces that group assignment on every
relevant read and write. Goers cannot change lifecycle or allowance settings,
edit school or growth records, manage letter status, or access participant
administration. Goer receipt records are kept separately from sponsor
disbursements, so they do not appear as money sent in the guardian sponsorship
history. System Administrators can update a Goer’s group or
deactivate/reactivate the account.
A staff account cannot grant itself more access or manage other accounts.

Existing Church Administrator accounts with no saved permission list retain
their prior access for compatibility. New permission selections are enforced by
the server as well as reflected in the navigation.

## Sponsored-child care

The Sponsored care staff module organizes registered Sponsored Children by
lifecycle: New, Active, Deceased, or Graduated. Newly registered children start
as New; existing records are preserved as Active unless staff updates them.
Graduated marks a child who has exited sponsorship. These lifecycle changes do
not delete the participant or revoke their QR code.

Staff with View sponsored care permission can review lifecycle, monthly
allowance, past disbursements, received-care records, receipt proofs, and child
letter threads. Staff with Manage sponsored care permission can also update
lifecycle and allowance, record a sponsor disbursement, reply to letters, and
update letter status. Goers record a received gift or allowance separately
from a sponsor disbursement. Receipt proofs accept JPG, PNG, or PDF files (up
to 4 MB); proof files are stored in the database and are not served from the
public uploads directory.

Guardians scan the child's active QR code, then enter the child's
6-digit numeric passcode in the verification dialog to view that child's
allowance and gift history and open receipt proofs. New Sponsored Child records
receive a cryptographically generated 6-digit passcode, shown once to the
authorized staff member who registered the child. Its verification hash and an
AES-256-GCM encrypted copy are stored. Church and system administrators can
reveal it from the Participants page; each reveal is audit-logged. Existing
records that only have a passcode hash cannot be revealed and need a new
passcode set by an administrator. Administrators can replace a passcode from
the participant record, leaving it blank to retain the current one. Guardians
can create letter
threads and reply to open threads; staff replies and status updates appear in
the same thread. Public APIs re-verify the QR/passcode for each request and
guardians cannot access another child's records. Public proof uploads accept
only JPG, PNG, or PDF files, limited to 4 MB.

## Public participant portals

The public home page provides separate entry points for staff sign-in, Sponsored
Child guardian sponsorship-status checks, and Goer profile/attendance access.
Guardian checks require both an active Sponsored Child QR code and the child's
passcode; failed attempts for a QR code are temporarily locked after five
failures. Goers use their own active QR code to view only their name, participant
ID, and up to 20 recent attendance entries. These public responses do not
include contact, medical, or sponsor details. Treat participant QR codes as
private credentials and revoke a code if it is lost or shared.

On server startup, legacy Admin accounts are changed to System Administrator.
Program Coordinator and Check-in Volunteer accounts are retained but changed
to inactive Church Administrator accounts; reactivate them only after
reviewing who should have staff access. Existing login sessions for inactive
accounts are rejected.

## Sponsored-child qualification

Sponsored-child registration and edits require a date of birth proving the
participant is 6 through 22 years old, inclusive, and an education level:
Elementary, Junior High School, Senior High School, or College. A college
grade is selected from Grades 1–6, Junior High from Grades 7–10, Senior High
from Grades 11–12, and College from Years 1–6. A college program/course is
required for College. Goer records are not subject to these age and education rules. Existing participant data is preserved; the new
qualification is validated when creating or editing a sponsored-child record.
Education course data, school name and address, and each name part are
encrypted in the database; the education level and grade/year are stored as
non-sensitive classification data.
Participant registration and editing use required first and last names plus
an optional middle name. Existing full names remain intact; when editing a
legacy record, the form initially separates its first word, middle words, and
last word, so review the split and correct it if the name has multiple words
in its first or last part.

## Audit history

The server creates an `audit_logs` table automatically when it starts. System
Administrators
can open **Audit history** to review account credential/email changes,
participant creation/updates/deletion, event creation, and recorded check-ins.
Entries contain the actor, role, action, record reference, timestamp, and only
field names or event names where applicable; passwords and participant field
values are not recorded.

## 3. Run the system

### PowerShell window 1: Server

```powershell
cd server
npm run dev
```

### PowerShell window 2: Client

```powershell
cd client
npm run dev -- --host 0.0.0.0
```

Keep both windows running.

## 4. Open the system

On the computer, open:

```text
https://localhost:5173/
```

## Open on a phone

Connect the phone and computer to the same Wi-Fi network.

Find the computer IP address:

```powershell
ipconfig
```

On the phone, open:

```text
https://YOUR-COMPUTER-IP:5173/
```

Example:

```text
https://192.168.1.8:5173/
```

If the phone cannot connect:

1. Make sure both devices use the same Wi-Fi.
2. Make sure the client is running with `--host 0.0.0.0`.
3. Allow port `5173` through Windows Firewall.
4. Accept the HTTPS certificate warning.

## Stop the system

Press `Ctrl + C` in both PowerShell windows.

## Common problems

### Database error

Make sure MySQL/MariaDB is running and the values in `server/.env` are correct.

### API connection error

Make sure the server is running before using the client.

### Camera does not work

Use the HTTPS address and allow camera permission in the browser.
