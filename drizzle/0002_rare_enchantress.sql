CREATE TABLE "client_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"text" varchar(500) NOT NULL,
	"subtext" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_tasks" ADD COLUMN "step" varchar(50);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "avatar_url" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "company_name" varchar(255);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "job_title" varchar(100);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "social_media" jsonb;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "score" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "grade" varchar(20) DEFAULT 'Grade C' NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "status_tag" varchar(50) DEFAULT 'New' NOT NULL;--> statement-breakpoint
ALTER TABLE "client_insights" ADD CONSTRAINT "client_insights_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_insights" ADD CONSTRAINT "client_insights_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
DROP TYPE "public"."member_role";