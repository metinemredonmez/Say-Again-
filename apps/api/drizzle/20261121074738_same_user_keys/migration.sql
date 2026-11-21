ALTER TABLE "lessons" ADD CONSTRAINT "lessons_id_user_unique" UNIQUE("id","user_id");--> statement-breakpoint
ALTER TABLE "phrases" ADD CONSTRAINT "phrases_id_user_unique" UNIQUE("id","user_id");--> statement-breakpoint
ALTER TABLE "turns" ADD CONSTRAINT "turns_id_lesson_unique" UNIQUE("id","lesson_id");--> statement-breakpoint
ALTER TABLE "ai_reports" ADD CONSTRAINT "ai_reports_lesson_same_user_fkey" FOREIGN KEY ("lesson_id","user_id") REFERENCES "lessons"("id","user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ai_reports" ADD CONSTRAINT "ai_reports_turn_same_lesson_fkey" FOREIGN KEY ("turn_id","lesson_id") REFERENCES "turns"("id","lesson_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "phrases" ADD CONSTRAINT "phrases_lesson_same_user_fkey" FOREIGN KEY ("lesson_id","user_id") REFERENCES "lessons"("id","user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_phrase_same_user_fkey" FOREIGN KEY ("phrase_id","user_id") REFERENCES "phrases"("id","user_id") ON DELETE CASCADE;