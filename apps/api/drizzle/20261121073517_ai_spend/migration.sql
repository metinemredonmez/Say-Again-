CREATE TABLE "ai_spend" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid,
	"source" text NOT NULL,
	"cost_micro_usd" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_spend_source_check" CHECK (source in ('speech_to_text', 'coach', 'evaluator', 'transfer_judge', 'text_to_speech')),
	CONSTRAINT "ai_spend_cost_check" CHECK ("cost_micro_usd" >= 0)
);
--> statement-breakpoint
CREATE INDEX "ai_spend_at_idx" ON "ai_spend" ("at");--> statement-breakpoint
CREATE INDEX "ai_spend_user_at_idx" ON "ai_spend" ("user_id","at");--> statement-breakpoint
ALTER TABLE "ai_spend" ADD CONSTRAINT "ai_spend_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;