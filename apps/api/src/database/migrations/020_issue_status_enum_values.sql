-- Adds two new issue_status_enum values needed by the issue-tracker
-- reconciliation work (ticket 2a/2b): 'waiting_for_information' (an issue
-- is blocked pending info from another party) and 'reopened' (a
-- previously closed/resolved issue that was reopened).
--
-- This is its own migration file, separate from 021, on purpose:
-- ALTER TYPE ... ADD VALUE cannot have its new value referenced/used
-- within the same transaction that added it. The migration runner
-- (run-migrations.ts) executes each file's full contents as a single
-- `sql.unsafe(content)` call, which Postgres treats as one implicit
-- transaction for a multi-statement simple-query string. Keeping the
-- ADD VALUE statements isolated in their own file/transaction means any
-- later migration (this one's neighbor 021, or a ticket-2b migration)
-- is free to reference the new values immediately.
--
-- Ticket 2a does not itself use these two values anywhere yet -- they're
-- added now purely so ticket 2b's workflow actions (reopen, etc.) don't
-- need another ALTER TYPE ADD VALUE transaction-boundary dance later.
ALTER TYPE issue_status_enum ADD VALUE IF NOT EXISTS 'waiting_for_information';
ALTER TYPE issue_status_enum ADD VALUE IF NOT EXISTS 'reopened';
