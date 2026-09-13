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
7. Staff can view attendance from the event page and dashboard.

The **client** is the web page that staff use. The **server** processes login,
participant data, QR scans, events, and attendance. The **database** stores the
participant, event, and attendance records.

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
DB_NAME=church_monitoring_db
DB_USER=root
DB_PASSWORD=
JWT_SECRET=8bc2525f8aa7caf103d4540aafe39edc1418ed768fe10deed74e32e35108d3687ad01a3da4931a9fcd16760064ea4b82
AES_KEY=e0f468939d74690dc462449bb56412430fa1dfdae08aaddaa66ca988b643d83b
```


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
