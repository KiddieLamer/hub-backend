ALTER TABLE "projects" ADD COLUMN "priority" varchar(20) DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "billing_type" varchar(20) DEFAULT 'fixed' NOT NULL;