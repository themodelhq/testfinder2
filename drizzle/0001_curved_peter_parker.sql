CREATE TABLE `products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sku` varchar(255) NOT NULL,
	`name` text,
	`brand` varchar(255),
	`category` text,
	`price` decimal(12,2),
	`oldPrice` decimal(12,2),
	`discount` varchar(50),
	`rating` decimal(3,2),
	`totalRatings` int,
	`image` text,
	`url` text,
	`seller` varchar(255),
	`isJumiaExpress` boolean DEFAULT false,
	`isShopGlobal` boolean DEFAULT false,
	`stock` varchar(50),
	`tags` json,
	`country` varchar(10) DEFAULT 'NG',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `products_id` PRIMARY KEY(`id`),
	CONSTRAINT `products_sku_unique` UNIQUE(`sku`)
);
--> statement-breakpoint
CREATE TABLE `searches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`query` text,
	`country` varchar(10) DEFAULT 'NG',
	`resultsCount` int DEFAULT 0,
	`filters` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `searches_id` PRIMARY KEY(`id`)
);
