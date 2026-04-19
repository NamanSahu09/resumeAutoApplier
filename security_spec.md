# Security Specification for AutoApply AI

## Data Invariants
1. A job must have a valid `userId` matching the authenticated user.
2. An automation status can only be modified by its owner (`userId`).
3. Resumes are private and only accessible by the owner.
4. Document IDs must be valid alphanumeric strings.
5. All writes must include server timestamps where applicable.

## The "Dirty Dozen" Payloads (Denial Expected)
1. **Identity Spoofing**: Attempt to create a job with `userId: "malicious_user_id"`.
2. **Ghost Update**: Attempt to update a job's `company` field while logged in as a different user.
3. **Admin Escalation**: Attempt to set `isAdmin: true` in user status.
4. **Invalid ID**: Attempt to write to `/jobs/!!!!_invalid_id_!!!!`.
5. **Shadow Field**: Attempt to create a job with an extra field `isVerified: true`.
6. **Self-Assigned Role**: Attempt to set status to `active` without proper auth.
7. **PII Leak**: Attempt to list all resumes without a user-scoped query.
8. **Resource Exhaustion**: Attempt to write a 2MB log entry.
9. **State Shortcut**: Attempt to change job status from `pending` to `applied` without passing through `customizing` (if enforced).
10. **Timestamp Fraud**: Providing a client-side `updatedAt` instead of `request.time`.
11. **Orphaned Job**: Creating a job without a valid user ID.
12. **Blanket Read**: Attempting `db.collection('resumes').get()` without a `where` clause.

## Evaluation
These rules will enforce that only the owner of the data can read or write it, and all data must conform to a strict schema.
