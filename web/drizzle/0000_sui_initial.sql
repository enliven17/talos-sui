CREATE TABLE "tls_activities" (
	"id" text PRIMARY KEY NOT NULL,
	"talosId" text NOT NULL,
	"type" text NOT NULL,
	"content" text NOT NULL,
	"walrusBlobId" text,
	"channel" text NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tls_api_audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"talosId" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"statusCode" integer NOT NULL,
	"ipAddress" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tls_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"talosId" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"amount" numeric(18, 6),
	"status" text DEFAULT 'pending' NOT NULL,
	"decidedAt" timestamp (3),
	"decidedBy" text,
	"txHash" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tls_commerce_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"talosId" text NOT NULL,
	"requesterTalosId" text NOT NULL,
	"serviceName" text NOT NULL,
	"payload" jsonb,
	"result" jsonb,
	"walrusResultBlobId" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"paymentSig" text,
	"txHash" text,
	"amount" numeric(18, 6) NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "tls_commerce_jobs_paymentSig_unique" UNIQUE("paymentSig")
);
--> statement-breakpoint
CREATE TABLE "tls_commerce_services" (
	"id" text PRIMARY KEY NOT NULL,
	"talosId" text NOT NULL,
	"serviceName" text NOT NULL,
	"description" text,
	"price" numeric(18, 6) NOT NULL,
	"currency" text DEFAULT 'USDC' NOT NULL,
	"suiAddress" text NOT NULL,
	"chains" text[] DEFAULT '{"sui"}' NOT NULL,
	"fulfillmentMode" text DEFAULT 'async' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "tls_commerce_services_talosId_unique" UNIQUE("talosId")
);
--> statement-breakpoint
CREATE TABLE "tls_patrons" (
	"id" text PRIMARY KEY NOT NULL,
	"talosId" text NOT NULL,
	"suiAddress" text NOT NULL,
	"role" text NOT NULL,
	"pulseAmount" integer DEFAULT 0 NOT NULL,
	"share" numeric(5, 2) NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tls_playbook_purchases" (
	"id" text PRIMARY KEY NOT NULL,
	"playbookId" text NOT NULL,
	"buyerAddress" text NOT NULL,
	"appliedAt" timestamp (3),
	"txHash" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tls_playbooks" (
	"id" text PRIMARY KEY NOT NULL,
	"talosId" text NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"channel" text NOT NULL,
	"description" text NOT NULL,
	"price" numeric(18, 6) NOT NULL,
	"currency" text DEFAULT 'USDC' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"content" jsonb,
	"walrusContentBlobId" text,
	"impressions" integer DEFAULT 0 NOT NULL,
	"engagementRate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"conversions" integer DEFAULT 0 NOT NULL,
	"periodDays" integer DEFAULT 30 NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tls_revenues" (
	"id" text PRIMARY KEY NOT NULL,
	"talosId" text NOT NULL,
	"amount" numeric(18, 6) NOT NULL,
	"currency" text DEFAULT 'USDC' NOT NULL,
	"source" text NOT NULL,
	"txHash" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tls_talos" (
	"id" text PRIMARY KEY NOT NULL,
	"onChainId" integer,
	"onChainObjectId" text,
	"agentName" text,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'Active' NOT NULL,
	"mitosCoinType" text,
	"tokenSymbol" text,
	"pulsePrice" numeric(18, 6) DEFAULT '0' NOT NULL,
	"totalSupply" integer DEFAULT 1000000 NOT NULL,
	"creatorShare" integer DEFAULT 60 NOT NULL,
	"investorShare" integer DEFAULT 25 NOT NULL,
	"treasuryShare" integer DEFAULT 15 NOT NULL,
	"apiKey" text,
	"persona" text,
	"targetAudience" text,
	"channels" text[] DEFAULT '{}' NOT NULL,
	"toneVoice" text,
	"approvalThreshold" numeric(18, 2) DEFAULT '10' NOT NULL,
	"gtmBudget" numeric(18, 2) DEFAULT '200' NOT NULL,
	"minPatronPulse" integer,
	"agentOnline" boolean DEFAULT false NOT NULL,
	"agentLastSeen" timestamp (3),
	"walletAddress" text,
	"creatorAddress" text,
	"investorAddress" text,
	"treasuryAddress" text,
	"agentWalletId" text,
	"agentWalletAddress" text,
	"walrusProfileBlob" text,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "tls_talos_onChainId_unique" UNIQUE("onChainId"),
	CONSTRAINT "tls_talos_agentName_unique" UNIQUE("agentName"),
	CONSTRAINT "tls_talos_apiKey_unique" UNIQUE("apiKey")
);
--> statement-breakpoint
ALTER TABLE "tls_activities" ADD CONSTRAINT "tls_activities_talosId_tls_talos_id_fk" FOREIGN KEY ("talosId") REFERENCES "public"."tls_talos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tls_api_audit_logs" ADD CONSTRAINT "tls_api_audit_logs_talosId_tls_talos_id_fk" FOREIGN KEY ("talosId") REFERENCES "public"."tls_talos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tls_approvals" ADD CONSTRAINT "tls_approvals_talosId_tls_talos_id_fk" FOREIGN KEY ("talosId") REFERENCES "public"."tls_talos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tls_commerce_jobs" ADD CONSTRAINT "tls_commerce_jobs_talosId_tls_talos_id_fk" FOREIGN KEY ("talosId") REFERENCES "public"."tls_talos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tls_commerce_services" ADD CONSTRAINT "tls_commerce_services_talosId_tls_talos_id_fk" FOREIGN KEY ("talosId") REFERENCES "public"."tls_talos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tls_patrons" ADD CONSTRAINT "tls_patrons_talosId_tls_talos_id_fk" FOREIGN KEY ("talosId") REFERENCES "public"."tls_talos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tls_playbook_purchases" ADD CONSTRAINT "tls_playbook_purchases_playbookId_tls_playbooks_id_fk" FOREIGN KEY ("playbookId") REFERENCES "public"."tls_playbooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tls_playbooks" ADD CONSTRAINT "tls_playbooks_talosId_tls_talos_id_fk" FOREIGN KEY ("talosId") REFERENCES "public"."tls_talos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tls_revenues" ADD CONSTRAINT "tls_revenues_talosId_tls_talos_id_fk" FOREIGN KEY ("talosId") REFERENCES "public"."tls_talos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tls_activities_talosId_createdAt_idx" ON "tls_activities" USING btree ("talosId","createdAt");--> statement-breakpoint
CREATE INDEX "tls_api_audit_logs_talosId_createdAt_idx" ON "tls_api_audit_logs" USING btree ("talosId","createdAt");--> statement-breakpoint
CREATE INDEX "tls_approvals_talosId_status_idx" ON "tls_approvals" USING btree ("talosId","status");--> statement-breakpoint
CREATE INDEX "tls_commerce_jobs_talosId_status_idx" ON "tls_commerce_jobs" USING btree ("talosId","status");--> statement-breakpoint
CREATE UNIQUE INDEX "tls_patrons_talosId_suiAddress_key" ON "tls_patrons" USING btree ("talosId","suiAddress");--> statement-breakpoint
CREATE UNIQUE INDEX "tls_playbook_purchases_playbookId_buyerAddress_key" ON "tls_playbook_purchases" USING btree ("playbookId","buyerAddress");--> statement-breakpoint
CREATE INDEX "tls_playbooks_talosId_idx" ON "tls_playbooks" USING btree ("talosId");--> statement-breakpoint
CREATE INDEX "tls_revenues_talosId_createdAt_idx" ON "tls_revenues" USING btree ("talosId","createdAt");