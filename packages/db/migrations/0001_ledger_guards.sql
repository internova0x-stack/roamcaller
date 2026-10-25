-- Ledger rows are append-only, and every posting must sum to zero per currency.
-- The balance check is a deferred constraint trigger, so it runs at commit, after
-- all rows of a posting are in.

CREATE FUNCTION ledger_forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only';
END $$;
--> statement-breakpoint
CREATE TRIGGER ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_forbid_change();
--> statement-breakpoint
CREATE FUNCTION ledger_check_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  off record;
BEGIN
  SELECT currency, sum(amount_minor) AS total INTO off
  FROM ledger_entries
  WHERE posting_id = NEW.posting_id
  GROUP BY currency
  HAVING sum(amount_minor) <> 0
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'ledger posting % does not balance in % (off by %)', NEW.posting_id, off.currency, off.total;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ledger_entries_balanced
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_check_balanced();
--> statement-breakpoint
-- Drizzle's text enums are only checked in TypeScript; enforce them in the database too.
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('created','reserved','completed','delivered','failed','cancelled'));
--> statement-breakpoint
ALTER TABLE partners ADD CONSTRAINT partners_status_check CHECK (status IN ('active','paused'));
--> statement-breakpoint
ALTER TABLE api_keys ADD CONSTRAINT api_keys_mode_check CHECK (mode IN ('test','live'));
--> statement-breakpoint
ALTER TABLE orders ADD CONSTRAINT orders_mode_check CHECK (mode IN ('test','live'));
--> statement-breakpoint
ALTER TABLE plans ADD CONSTRAINT plans_mode_check CHECK (mode IN ('test','live'));
