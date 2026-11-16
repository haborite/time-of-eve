CREATE TABLE `api_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`revoked` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_tokens_token_hash_unique` ON `api_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`poll_id` text,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`detail` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_poll` ON `audit_logs` (`poll_id`,`id`);--> statement-breakpoint
CREATE TABLE `candidates` (
	`poll_id` text NOT NULL,
	`no` integer NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`poll_id`, `no`),
	FOREIGN KEY (`poll_id`) REFERENCES `polls`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `guard` (
	`ok` integer NOT NULL,
	`code` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`key` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `participants` (
	`poll_id` text NOT NULL,
	`no` integer NOT NULL,
	`display_name` text NOT NULL,
	`email` text,
	`required` integer DEFAULT false NOT NULL,
	`preregistered` integer DEFAULT false NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`answers` text DEFAULT '{}' NOT NULL,
	`slots` text,
	`edit_nonce` text,
	`responded_at` integer,
	`created_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
	PRIMARY KEY(`poll_id`, `no`),
	FOREIGN KEY (`poll_id`) REFERENCES `polls`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `polls` (
	`id` text PRIMARY KEY NOT NULL,
	`public_id` text NOT NULL,
	`owner_user_id` integer,
	`owner_scope` text NOT NULL,
	`manage_nonce` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`basis` text DEFAULT '' NOT NULL,
	`timezone` text NOT NULL,
	`duration_minutes` integer,
	`response_deadline` integer,
	`show_participant_names` integer DEFAULT false NOT NULL,
	`allow_maybe` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`finalized_candidate_no` integer,
	`hidden` integer DEFAULT false NOT NULL,
	`client_request_id` text,
	`request_hash` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `polls_public_id_unique` ON `polls` (`public_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `polls_idempotency` ON `polls` (`owner_scope`,`client_request_id`);--> statement-breakpoint
CREATE INDEX `polls_owner` ON `polls` (`owner_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `polls_created` ON `polls` (`created_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`csrf` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_user_id` integer NOT NULL,
	`name` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`disabled` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);