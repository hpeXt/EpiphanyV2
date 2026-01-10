CREATE TABLE `comments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`viewpointId` int NOT NULL,
	`parentId` int,
	`authorId` int NOT NULL,
	`content` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `comments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `topics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(128) NOT NULL,
	`title` varchar(512) NOT NULL,
	`description` text,
	`creatorId` int NOT NULL,
	`status` enum('draft','active','archived') NOT NULL DEFAULT 'active',
	`aiReport` json,
	`reportUpdatedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `topics_id` PRIMARY KEY(`id`),
	CONSTRAINT `topics_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `viewpoints` (
	`id` int AUTO_INCREMENT NOT NULL,
	`topicId` int NOT NULL,
	`parentId` int,
	`authorId` int NOT NULL,
	`title` varchar(512) NOT NULL,
	`content` text,
	`theme` varchar(128),
	`sentimentScore` int,
	`keywords` json,
	`depth` int NOT NULL DEFAULT 0,
	`totalVotes` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `viewpoints_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `votes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`viewpointId` int NOT NULL,
	`voteCount` int NOT NULL DEFAULT 0,
	`creditsSpent` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `votes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `votingCredits` int DEFAULT 100 NOT NULL;