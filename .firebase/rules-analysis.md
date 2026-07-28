# Firestore rules analysis

Target: `employee-management-port-339fe/(default)` (Standard edition).

## Architecture and access patterns

- Firebase web SDK performs authenticated reads and owner-only notification
  device registration.
- Next.js `/api/workflows` verifies the Firebase ID token and active employee
  profile, then uses Firebase Admin SDK for every workflow mutation.
- `workSchedules`, `leaveRequests`, `lateRequests`, `salaryAdvances`,
  `penalties`, `workflowRequests`, and `pushDispatches` reject every client
  write. The Admin SDK is the only writer.
- Employees read their own workflow records. Managers/admins read records for
  review. Notification documents remain owner-readable; only the owner can
  toggle `isRead` or delete them.
- `employees/{uid}/notificationDevices/{fid}` remains owner-only and is the only
  client-created backend-related document, because a browser must register its
  own FCM installation.
- Company rules and employee profile writes retain strict validators and role
  checks.

## Query inventory

- Equality on `employeeId` plus descending date/timestamp order.
- Pending `status` plus descending `createdAt`.
- Employee/date range schedules.
- Active company rules ordered by `order`.
- Unread notifications ordered by `createdAt`.

The required compound indexes are present in `firestore.indexes.json`.

## Devil's advocate checks

- Public access: no unauthenticated read or write rule exists.
- Workflow bypass: browser create/update/delete is denied for all sensitive
  workflow collections, so a client cannot forge status, timestamps, penalties,
  locks, reviewer identity, or notification documents.
- Role escalation: self-created employee profiles are forced to role
  `employee`; self-update cannot change role/status/UID/employee code.
- Cross-user access: workflow reads require ownership or manager/admin role;
  notification and FCM-device reads are owner-only.
- Update/schema/type bypass: every remaining allowed create/update path calls a
  full validator with field allowlists, types, ranges, and size limits.
- Device hijacking: device path UID and payload UID must match auth UID; FID and
  owner are immutable.
- Server-only metadata: `workflowRequests` and `pushDispatches` explicitly deny
  all client access.
- Approved schedule tampering: no client update/delete is allowed at all.
- Query mismatch: application owner queries include `employeeId`; privileged
  list queries are authorized by role.

## Remaining assumptions

- Privileged authority is stored in `employees/{uid}.role`; only trusted Admin
  SDK/console operations or an existing admin may change it.
- Firebase Admin credentials exist only in local/Vercel server environment
  variables and are never exposed with `NEXT_PUBLIC_`.
- Emulator allow/deny regression tests are still recommended before broad use.
