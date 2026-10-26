CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`host_peer` text NOT NULL,
	`host_name` text NOT NULL,
	`guest_peer` text,
	`guest_name` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_code_idx` ON `rooms` (`code`);--> statement-breakpoint
CREATE INDEX `rooms_mode_status_idx` ON `rooms` (`mode`,`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `signals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` text NOT NULL,
	`to_peer` text NOT NULL,
	`from_peer` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `signals_room_to_idx` ON `signals` (`room_id`,`to_peer`,`id`);--> statement-breakpoint
CREATE INDEX `signals_created_idx` ON `signals` (`created_at`);