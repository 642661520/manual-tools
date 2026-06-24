CREATE TABLE `catalogs` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`targets` text DEFAULT '[]' NOT NULL,
	`features` text DEFAULT '[]' NOT NULL,
	`version` text DEFAULT '1.0' NOT NULL,
	`cover_info` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `document_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`document_id` text NOT NULL,
	`snapshot_data` blob NOT NULL,
	`update_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `document_updates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`document_id` text NOT NULL,
	`update_data` blob NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`feature_id` text NOT NULL,
	`section_key` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`assignee` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`feature_id`) REFERENCES `features`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `features` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`module` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`sections` text DEFAULT '[]' NOT NULL,
	`is_custom` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text,
	`role` text DEFAULT 'ops' NOT NULL,
	`feishu_open_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);