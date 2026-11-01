CREATE TABLE "embed_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"customer_ref" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "customer_ref" text;--> statement-breakpoint
ALTER TABLE "embed_sessions" ADD CONSTRAINT "embed_sessions_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "embed_sessions_token_hash_key" ON "embed_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("partner_id","mode","customer_ref");