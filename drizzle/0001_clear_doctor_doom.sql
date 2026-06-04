CREATE TABLE "llm_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"created_at" integer DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER NOT NULL,
	"label" text NOT NULL,
	"model" text NOT NULL,
	"kind" text NOT NULL,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"reasoning_tokens" integer,
	"input_chars" integer,
	"input_bytes" integer,
	"output_bytes" integer,
	"cost_usd" text,
	"route" text
);
--> statement-breakpoint
ALTER TABLE "llm_usage" ADD CONSTRAINT "llm_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_llm_usage_user_time" ON "llm_usage" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_llm_usage_time" ON "llm_usage" USING btree ("created_at");