CREATE TABLE "sentence_annotations" (
	"id" serial PRIMARY KEY NOT NULL,
	"cache_key" text NOT NULL,
	"text" text NOT NULL,
	"native_language" text NOT NULL,
	"target_language_json" text NOT NULL,
	"prompt_version" integer NOT NULL,
	"model" text NOT NULL,
	"payload" text NOT NULL,
	"created_at" integer DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ux_sentence_annotations_key" ON "sentence_annotations" USING btree ("cache_key");