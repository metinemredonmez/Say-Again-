CREATE TABLE "ai_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"target" text NOT NULL,
	"turn_id" uuid,
	"reason" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_reports_target_check" CHECK (target in ('correction', 'coach_turn')),
	CONSTRAINT "ai_reports_reason_check" CHECK (reason in ('wrong', 'inappropriate', 'other'))
);
--> statement-breakpoint
CREATE TABLE "corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"lesson_id" uuid NOT NULL UNIQUE,
	"kind" text NOT NULL,
	"original" text NOT NULL,
	"improved" text NOT NULL,
	"explanation_tr" text NOT NULL,
	"category" text NOT NULL,
	"resay_prompt_tr" text NOT NULL,
	"resay_text" text,
	"reported_wrong" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "corrections_kind_check" CHECK (kind in ('correction', 'polish')),
	CONSTRAINT "corrections_category_check" CHECK (category in ('article', 'preposition', 'word-order', 'tense', 'plural-countable', 'agreement', 'word-choice', 'politeness', 'other'))
);
--> statement-breakpoint
CREATE TABLE "lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"scenario_id" text NOT NULL,
	"difficulty" text NOT NULL,
	"state" text DEFAULT 'in_progress' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"evaluation_started_at" timestamp with time zone,
	"evaluated_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"stt_ms" integer DEFAULT 0 NOT NULL,
	"tts_chars" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micro_usd" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "lessons_state_check" CHECK (state in ('in_progress', 'evaluating', 'awaiting_resay', 'completed', 'abandoned')),
	CONSTRAINT "lessons_difficulty_check" CHECK (difficulty in ('easy', 'hard'))
);
--> statement-breakpoint
CREATE TABLE "phrases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL UNIQUE,
	"scenario_id" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" text PRIMARY KEY,
	"family_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"family_expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked" boolean DEFAULT false NOT NULL,
	"claims" jsonb
);
--> statement-breakpoint
CREATE TABLE "review_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"phrase_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"hint_used" boolean DEFAULT false NOT NULL,
	"answer_text" text,
	"cost_micro_usd" bigint DEFAULT 0 NOT NULL,
	"done_at" timestamp with time zone,
	"outcome" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_items_kind_check" CHECK (kind in ('review', 'transfer')),
	CONSTRAINT "review_items_outcome_check" CHECK ("outcome" is null or outcome in ('unaided', 'hinted', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"store" text NOT NULL,
	"store_ref" text NOT NULL,
	"product_id" text NOT NULL,
	"status" text NOT NULL,
	"current_period_end" timestamp with time zone,
	"sandbox" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_store_ref_unique" UNIQUE("store","store_ref"),
	CONSTRAINT "subscriptions_store_check" CHECK (store in ('app_store', 'play_store')),
	CONSTRAINT "subscriptions_status_check" CHECK (status in ('active', 'grace', 'expired', 'refunded', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"lesson_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"speaker" text NOT NULL,
	"coach_move" text,
	"text" text NOT NULL,
	"from_audio" boolean DEFAULT false NOT NULL,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "turns_lesson_position_unique" UNIQUE("lesson_id","position"),
	CONSTRAINT "turns_speaker_check" CHECK (speaker in ('coach', 'learner')),
	CONSTRAINT "turns_coach_move_check" CHECK ("coach_move" is null or coach_move in ('opening', 'follow_up', 'hint', 'closing'))
);
--> statement-breakpoint
CREATE TABLE "usage_months" (
	"user_id" uuid,
	"month" date,
	"lessons_completed" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_months_pkey" PRIMARY KEY("user_id","month")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"level" text,
	"pack" text DEFAULT 'professional' NOT NULL,
	"difficulty" text DEFAULT 'easy' NOT NULL,
	"target_language" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_level_check" CHECK ("level" is null or level in ('A2', 'B1', 'B2', 'C1')),
	CONSTRAINT "users_pack_check" CHECK (pack in ('professional', 'seller')),
	CONSTRAINT "users_difficulty_check" CHECK (difficulty in ('easy', 'hard')),
	CONSTRAINT "users_target_language_check" CHECK ("target_language" ~ '^[a-z]{2}$')
);
--> statement-breakpoint
CREATE INDEX "ai_reports_created_idx" ON "ai_reports" ("created_at");--> statement-breakpoint
CREATE INDEX "lessons_user_started_idx" ON "lessons" ("user_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "lessons_started_idx" ON "lessons" ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lessons_one_open_per_user" ON "lessons" ("user_id") WHERE "state" in ('in_progress', 'evaluating', 'awaiting_resay');--> statement-breakpoint
CREATE INDEX "phrases_user_idx" ON "phrases" ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens" ("family_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens" ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_expires_at_idx" ON "refresh_tokens" ("family_expires_at");--> statement-breakpoint
CREATE INDEX "review_items_due_idx" ON "review_items" ("user_id","due_at") WHERE "done_at" is null;--> statement-breakpoint
CREATE INDEX "subscriptions_user_idx" ON "subscriptions" ("user_id");--> statement-breakpoint
ALTER TABLE "ai_reports" ADD CONSTRAINT "ai_reports_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ai_reports" ADD CONSTRAINT "ai_reports_lesson_id_lessons_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ai_reports" ADD CONSTRAINT "ai_reports_turn_id_turns_id_fkey" FOREIGN KEY ("turn_id") REFERENCES "turns"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_lesson_id_lessons_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "phrases" ADD CONSTRAINT "phrases_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "phrases" ADD CONSTRAINT "phrases_lesson_id_lessons_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_phrase_id_phrases_id_fkey" FOREIGN KEY ("phrase_id") REFERENCES "phrases"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "turns" ADD CONSTRAINT "turns_lesson_id_lessons_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "usage_months" ADD CONSTRAINT "usage_months_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;