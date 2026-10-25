CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"prefix" text NOT NULL,
	"hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "esims" (
	"iccid" text PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"lpa" text,
	"smdp_address" text,
	"activation_code" text,
	"qr_url" text,
	"status" text,
	"data_total_mb" integer,
	"data_used_mb" integer,
	"expires_at" timestamp with time zone,
	"raw" jsonb,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"currency" char(3) PRIMARY KEY NOT NULL,
	"per_usd" numeric(18, 6) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"partner_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"order_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_partner_id_mode_key_pk" PRIMARY KEY("partner_id","mode","key")
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"posting_id" uuid NOT NULL,
	"account" text NOT NULL,
	"currency" char(3) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"kind" text NOT NULL,
	"ref" text NOT NULL,
	"order_id" uuid,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"plan_id" uuid NOT NULL,
	"partner_reference" text,
	"status" text DEFAULT 'created' NOT NULL,
	"price_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"cost_usd_cents" integer NOT NULL,
	"rb_order_id" text,
	"iccid" text,
	"failure_reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"currency" char(3) NOT NULL,
	"markup_bps" integer DEFAULT 2000 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"webhook_url" text,
	"webhook_secret" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partners_markup_bps" CHECK ("partners"."markup_bps" between 0 and 20000)
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mode" text NOT NULL,
	"rb_plan_id" integer NOT NULL,
	"name" text NOT NULL,
	"coverage" text[] DEFAULT '{}'::text[] NOT NULL,
	"data_mb" integer,
	"validity_days" integer,
	"cost_usd_cents" integer,
	"active" boolean DEFAULT true NOT NULL,
	"raw" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "esims" ADD CONSTRAINT "esims_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "esims" ADD CONSTRAINT "esims_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash_key" ON "api_keys" USING btree ("hash");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_once_key" ON "ledger_entries" USING btree ("account","currency","kind","ref");--> statement-breakpoint
CREATE INDEX "ledger_entries_account_idx" ON "ledger_entries" USING btree ("account","currency");--> statement-breakpoint
CREATE INDEX "orders_partner_created_idx" ON "orders" USING btree ("partner_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_rb_order_id_key" ON "orders" USING btree ("mode","rb_order_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "partners_slug_key" ON "partners" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_mode_rb_plan_id_key" ON "plans" USING btree ("mode","rb_plan_id");--> statement-breakpoint
CREATE INDEX "webhook_events_pending_idx" ON "webhook_events" USING btree ("next_attempt_at") WHERE "webhook_events"."delivered_at" is null;