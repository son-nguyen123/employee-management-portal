# Firestore rules analysis

Target: `employee-management-port-339fe/(default)` (Standard edition).

## Collections and access patterns

- `employees/{uid}`: owner reads profile; managers/admins read staff; self-signup
  creates an `employee` profile; only admins may change roles/status or delete.
- `workSchedules`: employee creates and queries their own schedules; managers
  approve/reject and may delete.
- `leaveRequests`, `lateRequests`, `salaryAdvances`: employee creates `Pending`
  requests and queries their own documents; managers/admins approve or reject.
- `penalties`: managers/admins create; employee reads their own history.
- `companyRules`: authenticated users read active rules; admins manage rules.
- `notifications`: managers/admins create; employee reads, marks read, or deletes
  their own notifications.

## Query inventory

- Equality on `employeeId` combined with descending date/timestamp ordering.
- Pending status combined with descending `createdAt`.
- Work schedule employee/date range queries.
- Active company rules ordered by `order`.
- Unread employee notifications ordered by `createdAt`.

These queries are represented in `firestore.indexes.json`.

## Devil's advocate checks

- Public reads: denied by default.
- Cross-user reads/writes: owner fields must match `request.auth.uid`.
- Ownership hijacking: ownership fields are immutable after creation.
- Role escalation: self-created profiles are forced to `employee`; self-updates
  cannot change role, status, UID, employee code, or timestamps.
- Update bypass: all permitted updates call the full domain validator.
- Schema pollution: every validator uses `keys().hasOnly(...)`.
- Type juggling: every field is type checked.
- Resource exhaustion: every string has a realistic maximum length.
- Invalid workflow transition: user requests start as `Pending`; only
  managers/admins may move them to `Approved` or `Rejected`.
- Timestamp manipulation: create/update timestamps must be close to request time
  and `createdAt` is immutable.
- Query mismatch: owner queries include the ownership filter required by rules.

## Remaining assumptions

- Manager/admin authority is stored in `employees/{uid}.role`; rules prevent a
  non-admin from changing that field.
- The first admin must be bootstrapped from Firebase Console, which bypasses
  client Security Rules through trusted project administration.
- Rules should be reviewed again before a broad production launch.
