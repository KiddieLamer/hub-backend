ALTER TABLE "client_activities" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "client_activities" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "client_activities" ADD CONSTRAINT "client_activities_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;