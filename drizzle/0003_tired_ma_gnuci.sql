DROP INDEX "idx_user_vocab_user_lower_class";--> statement-breakpoint
CREATE UNIQUE INDEX "ux_user_vocab_user_lower_class" ON "user_vocab" USING btree ("user_id","target_word_lower","word_class");