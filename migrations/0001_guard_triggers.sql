-- Preconditions for atomic D1 batches (D1 has no interactive transactions).
-- A batch starts with   INSERT INTO guard (ok, code) SELECT <condition>, '<code>';
-- ok = 0 aborts the whole batch (rolled back) with the message "guard:<code>"; ok <> 0 is ignored (no row written).
CREATE TRIGGER `guard_version_conflict` BEFORE INSERT ON `guard`
WHEN NEW.ok = 0 AND NEW.code = 'version_conflict'
BEGIN SELECT RAISE(ABORT, 'guard:version_conflict'); END;
--> statement-breakpoint
CREATE TRIGGER `guard_already_responded` BEFORE INSERT ON `guard`
WHEN NEW.ok = 0 AND NEW.code = 'already_responded'
BEGIN SELECT RAISE(ABORT, 'guard:already_responded'); END;
--> statement-breakpoint
CREATE TRIGGER `guard_failed` BEFORE INSERT ON `guard`
WHEN NEW.ok = 0 AND NEW.code NOT IN ('version_conflict', 'already_responded')
BEGIN SELECT RAISE(ABORT, 'guard:failed'); END;
--> statement-breakpoint
CREATE TRIGGER `guard_pass` BEFORE INSERT ON `guard`
WHEN NEW.ok <> 0
BEGIN SELECT RAISE(IGNORE); END;
