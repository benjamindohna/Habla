ALTER TABLE "user_vocab" ALTER COLUMN "english_description" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "user_vocab" ADD COLUMN "word_class" text;--> statement-breakpoint
CREATE INDEX "idx_user_vocab_user_lower_class" ON "user_vocab" USING btree ("user_id","target_word_lower","word_class");