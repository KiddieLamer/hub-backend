CREATE TABLE "client_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"type" varchar(20) DEFAULT 'note' NOT NULL,
	"content" text NOT NULL,
	"author_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"due_date" varchar(100),
	"type" varchar(20) DEFAULT 'task' NOT NULL,
	"is_completed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_warranties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"product_name" varchar(255) NOT NULL,
	"serial_number" varchar(100),
	"start_date" date,
	"end_date" date,
	"coverage_type" varchar(255),
	"status" varchar(20) DEFAULT 'Active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "client_warranties_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "mobile" varchar(20);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "topic" varchar(255);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "rating" varchar(20);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "budget" varchar(50);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "identity_type" varchar(20);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "identity_number" varchar(50);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "tags" text[];--> statement-breakpoint
ALTER TABLE "client_activities" ADD CONSTRAINT "client_activities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_activities" ADD CONSTRAINT "client_activities_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_activities" ADD CONSTRAINT "client_activities_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_tasks" ADD CONSTRAINT "client_tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_tasks" ADD CONSTRAINT "client_tasks_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_warranties" ADD CONSTRAINT "client_warranties_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_warranties" ADD CONSTRAINT "client_warranties_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;