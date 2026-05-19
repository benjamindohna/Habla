CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"topic" text NOT NULL,
	"created_at" integer DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER NOT NULL,
	"ended_at" integer
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" text NOT NULL,
	"text_target" text NOT NULL,
	"user_raw" text,
	"segments_json" text,
	"created_at" integer DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_sets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"topics_json" text NOT NULL,
	"generated_at" integer DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_interests" (
	"user_id" integer NOT NULL,
	"interest" text NOT NULL,
	"added_at" integer DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER NOT NULL,
	"is_recent" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "user_interests_user_id_interest_pk" PRIMARY KEY("user_id","interest")
);
--> statement-breakpoint
CREATE TABLE "user_vocab" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"target_word_original" text NOT NULL,
	"target_word_lower" text NOT NULL,
	"english_description" text NOT NULL,
	"context_sentence" text,
	"stage" integer DEFAULT 0 NOT NULL,
	"stage_sentence" integer DEFAULT 0 NOT NULL,
	"next_due_at" integer,
	"correct_streak" integer DEFAULT 0 NOT NULL,
	"looked_up" integer DEFAULT 1 NOT NULL,
	"last_seen" integer DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER NOT NULL,
	"relevance_rank" integer DEFAULT 999999 NOT NULL,
	"native_translation" text,
	"native_hint" text,
	"tts_audio" "bytea",
	"created_at" integer DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"native_language" text DEFAULT 'German' NOT NULL,
	"level" integer DEFAULT 30 NOT NULL,
	"interests_text" text DEFAULT '' NOT NULL,
	"correction_style" text DEFAULT 'natural' NOT NULL,
	"current_set_id" integer,
	"next_set_id" integer,
	"recent_inputs_json" text DEFAULT '[]' NOT NULL,
	"last_level_check_at" integer,
	"target_language_json" text DEFAULT '{"language":"Spanish","location":"castellano","style":"everyday"}' NOT NULL,
	"samples_since_last_check" integer DEFAULT 0 NOT NULL,
	"created_at" integer DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_sets" ADD CONSTRAINT "topic_sets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_interests" ADD CONSTRAINT "user_interests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_vocab" ADD CONSTRAINT "user_vocab_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_current_set_id_topic_sets_id_fk" FOREIGN KEY ("current_set_id") REFERENCES "public"."topic_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_next_set_id_topic_sets_id_fk" FOREIGN KEY ("next_set_id") REFERENCES "public"."topic_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_conversations_user_id" ON "conversations" USING btree ("user_id","id");--> statement-breakpoint
CREATE INDEX "idx_messages_conv_id" ON "messages" USING btree ("conversation_id","id");--> statement-breakpoint
CREATE INDEX "idx_topic_sets_user_id" ON "topic_sets" USING btree ("user_id","id");--> statement-breakpoint
CREATE INDEX "idx_user_vocab_user_lower" ON "user_vocab" USING btree ("user_id","target_word_lower");--> statement-breakpoint
CREATE INDEX "idx_user_vocab_user_due" ON "user_vocab" USING btree ("user_id","next_due_at");--> statement-breakpoint
CREATE INDEX "idx_user_vocab_rank" ON "user_vocab" USING btree ("user_id","relevance_rank");