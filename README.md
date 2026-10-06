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
5. The server verifies the QR code and records the attendance.
6. The system prevents the same participant from being checked in twice for
   the same event on the same day.
7. Staff can add up to five JPG, PNG, or WebP photos to an event when creating
   it or from that event's attendance view. Photos are stored with their event.
8. Staff can view event attendance and its photo gallery in the event details
   modal.

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
JWT_SECRET=your-secret-key
AES_KEY=your-64-character-hex-key
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
delivery.

The account settings feature requires unique usernames and email addresses.
Fresh database imports include these indexes. For an existing database, first
resolve any duplicate usernames or email addresses, then run:

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

Sponsored Child and Goer are participant types, not staff login roles.
Participants do not receive staff accounts through participant registration. Only
a System Administrator can register staff accounts. New staff accounts receive
the Church Administrator role; the System Administrator selects access to the
dashboard, participant viewing/management, event viewing/management, check-in,
analytics, reports, and the participant QR portal. Management permission also
grants the related view permission. System Administrators can later update
permissions or deactivate/reactivate a staff account. A staff account cannot
grant itself more access or manage other accounts.

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
allowance, past disbursements, receipt proofs, and child letter threads. Staff
with Manage sponsored care permission can also update lifecycle and allowance,
record an allowance or gift with a JPG, PNG, or PDF receipt proof (up to 4 MB),
reply to letters, and update letter status. Receipt proof files are stored in
the database and are not served from the public uploads directory.

Guardians use the child's active QR code and passcode to view that child's
allowance and gift history and open receipt proofs. They can create letter
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
Education course data and each name part are encrypted in the database; the
education level and grade/year are stored as non-sensitive classification data.
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
