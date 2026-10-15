CREATE TABLE IF NOT EXISTS "aiSessions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "aiSessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"userName" varchar(255) NOT NULL,
	"subject" varchar(255) NOT NULL,
	"content" text NOT NULL,
	"reply" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
