# Attendance Bridge

Desktop app that reads attendance from a biometric/RFID device by **IP + port**, then posts the logs to your **server API URL**.

You change:

- Device IP and port
- Device credentials (optional: username, password, comm key)
- Server API URL, HTTP method, headers and auth
- Payload field names and extra fields

The default JSON keys are shown below, but the API URL, method, headers, auth and field names are all configurable.

## How it works

```
Attendance device  -->  this PC (Attendance Bridge)  -->  your ERP / Node.js server
   IP + port              pull punches                     POST attendance API

Your ERP              -->  this PC (Attendance Bridge)  -->  Attendance device
   student + RFID          POST /api/erp/students            write user + card
```

1. You choose the device type first (StellarBD, Tipsoi, or ZKTeco).
2. Fields change by type. StellarBD uses RAMS `fetch_log` (`auth_user`, `auth_code`).
3. ZKTeco still uses IP, port, and optional comm key:
   - ZKTeco pull (common port `4370`)
   - iClock / ADMS push (`/iclock/cdata`)
   - HTTP attendance API
   - TCP port check if the protocol is unknown
3. **Test** checks that the device is reachable.
4. **Pull** downloads punch logs and groups them into first in / last out for each employee and date.
5. **Sync** POSTs each record to your server API URL.

Default payload posted to the server:

```json
{
  "empID": "1001",
  "empName": "John Doe",
  "date": "2026-09-09",
  "inTime": "08:01:12",
  "outTime": "17:04:33",
  "total_time": "09:03"
}
```

The PC must be on the same network as the device. This is not a cloud-only product; the app talks to the machine directly.

The request is built dynamically from `server/store.js` config (also editable through `PUT /api/config`):

- `syncUrl` - target endpoint
- `syncMethod` - HTTP method (default `POST`)
- `syncHeaders` - extra headers as a key/value object
- `fieldMap` - rename payload keys, for example `{ "empID": "employee_id" }`
- `extraFields` - static key/value pairs added to every payload
- Auth: `authType` (`none`, `api-key`, `jwt`) plus the related `auth*` settings. API keys and JWT tokens are applied automatically by `server/auth.js`.

## Procedure

### 1. Install

**Windows**

- Double-click `install.bat`
- If Node.js is missing, install Node.js LTS from https://nodejs.org then run `install.bat` again

**Linux / macOS**

```bash
npm run setup
```

This installs Express, axios, node-zklib, Electron, and creates the `data` folder.

### 2. Start (desktop app)

**Windows**

- Double-click `start.bat`

**Any OS**

```bash
npm start
```

The Electron window starts the local API, a tray icon, and File menu backup actions. Close minimizes to tray unless that is turned off in Backup settings.

**Packaged installer**

```bash
npm run dist
```

Windows output is an NSIS installer plus a portable `.exe` in `dist/`.

**API / browser only** (no Electron window)

```bash
npm run server
```

Local address: `http://127.0.0.1:3780`

### 3. Set the server API URL

1. Open **Settings**
2. Paste your Node.js endpoint, for example:
   `https://server.roohschool.edu.bd/server/postAttendence`
3. Click **Save**

By default the server must accept `empID`, `empName`, `date`, `inTime`, `outTime`, `total_time`. To send different field names or add extra fields, update `fieldMap` / `extraFields` through `PUT /api/config` (or edit `data/config.json`).

### 4. Add the device

1. Open **Devices** (or use **Connect a device** on Dashboard)
2. Choose the **device type** first
3. Enter a **device name**
4. For **StellarBD**:
   - API URL defaults to `https://rumytechnologies.com/rams/json_api`
   - Enter `auth_user` and `auth_code`
   - Pull uses `operation: fetch_log` for today `00:00:00` to `23:59:59`
5. For **ZKTeco**:
   - Enter **IP** (example: `192.168.1.201`)
   - Enter **Port** (usually `4370`)
   - Optional username, password, comm key
6. Click **Add device**

### 5. Test, pull, sync

1. Click **Test** — device must be online
2. Click **Pull** — logs appear under **Attendance**
3. Click **Sync now** — pending rows are POSTed to the server URL

That is the full daily procedure.

## ERP to device (students / RFID)

The ERP cannot talk to the attendance machine directly. It POSTs students to this bridge; the bridge writes `userId` + RFID card onto the ZKTeco device (port `4370`). After that, a card scan logs attendance as that student.

From the ERP:

```
POST http://<this-pc>:3780/api/erp/students
Content-Type: application/json

{
  "students": [
    { "studentId": "1001", "name": "John Doe", "cardNo": "12345678" }
  ]
}
```

Same body is accepted on `POST /api/students`. Send one object or `{ "students": [ ... ] }`.

Default fields: `studentId`, `name`, `cardNo`. Aliases such as `empID`, `rfid`, `card_no` are accepted. To map your ERP names, set `studentFieldMap` in Settings or:

```
PUT /api/config
{ "studentFieldMap": { "studentId": "stu_id", "name": "full_name", "cardNo": "rfid" } }
```

Other endpoints:

- `GET /api/students` — stored list
- `POST /api/students/push` — write stored students to all devices
- `POST /api/devices/:id/users` — write to one device
- `DELETE /api/students/:id` — remove from store and device
- `{ "push": false }` — store only, do not write the device yet

On the device, `studentId` is the PIN / user ID and `cardNo` is the RFID. ZKTeco PIN is limited to 9 characters.

User write requires ZKTeco native protocol. iClock / ADMS push devices do not accept users this way.

## Backup and restore

The desktop app stores config, attendance, students, and events as JSON. Open **Backup** to:

- **Backup now** — write a snapshot into the backups folder
- **Export JSON / CSV** — save a copy through the File menu or Backup screen
- **Restore selected** — replace current data with a listed backup
- **Restore from file** — pick a `.json` backup (native dialog in Electron)
- Turn on **Auto backup** (default every 24 hours, keep 30 days)

File menu: Backup now, Restore backup, Export backup JSON, Export attendance CSV, Open data folder.

Windows scheduled backup while the app is running:

```
30daysBackup.bat
```

Electron keeps data under the OS user data folder. `npm run server` still uses `data/` next to the project.

## iClock / ADMS devices (push)

If the device cannot be pulled and instead sends data to a server:

1. On the device, set Cloud / ADMS / server IP to **this PC IP**
2. Set the device server port to **3780**
3. Keep this app running
4. Logs arrive at `/iclock/cdata` and show under **Attendance**
5. Click **Sync now**

## What you configure vs what is fixed

| You set | Fixed |
| --- | --- |
| Device IP | Local listen port `3780` |
| Device port | Default payload keys (overridable via `fieldMap`) |
| Username / password / comm key | Default method `POST` (overridable via `syncMethod`) |
| Server API URL, method, headers, auth | |
| Payload `fieldMap` / `extraFields` | |

## OS support

| OS | Desktop app | Server only |
| --- | --- | --- |
| Windows | Yes (`start.bat` / `npm start`) | Yes |
| Linux | Yes (`npm start`) | Yes |
| macOS | Yes (`npm start`) | Yes |

Electron needs Node.js 18+. The attendance device itself is not an OS; it is a network machine. The PC OS only runs this bridge.

## Device support

Works when the device is reachable by IP and port and uses one of:

- StellarBD RAMS JSON API (`fetch_log`)
- ZKTeco native protocol
- iClock / ADMS push
- HTTP attendance API
- Open TCP port (reachability only)

It will not work if:

- The PC cannot reach the device (wrong IP, firewall, different VLAN)
- The brand uses a closed protocol this app does not speak
- BioTime / vendor software is required and no raw IP access exists

## Files

| Path | Role |
| --- | --- |
| `electron-main.js` | Electron window, tray, menus, backup dialogs |
| `preload.js` | Desktop bridge for backup/export |
| `server/index.js` | Local API on port 3780 |
| `server/backup.js` | Snapshot, restore, 30-day prune |
| `server/deviceManager.js` | Auto-detect and pull |
| `server/sync.js` | POST attendance to your server URL |
| `server/students.js` | ERP student ingest and device push |
| `data/` or Electron userData | Config, logs, students, backups |
| `install.bat` / `setup.js` | Install dependencies |

## Commands

```bash
npm run setup
npm start
npm run dist
npm run server
```