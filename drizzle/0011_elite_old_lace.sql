ALTER TABLE "tasks" ADD COLUMN "channels" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "channel_links" jsonb DEFAULT '{}'::jsonb NOT NULL;