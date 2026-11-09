-- CreateTable
CREATE TABLE `admission_results` (
    `admission_id` BIGINT NOT NULL AUTO_INCREMENT,
    `created_at` DATETIME(6) NOT NULL,
    `updated_at` DATETIME(6) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `name_normalized` VARCHAR(100) NOT NULL,
    `phone_digits` VARCHAR(20) NOT NULL,
    `status` ENUM('FAIL', 'PASS') NOT NULL,

    UNIQUE INDEX `uq_admission_name_phone`(`name_normalized`, `phone_digits`),
    PRIMARY KEY (`admission_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- CreateTable
CREATE TABLE `comments` (
    `comment_id` BIGINT NOT NULL AUTO_INCREMENT,
    `created_at` DATETIME(6) NOT NULL,
    `updated_at` DATETIME(6) NOT NULL,
    `content` MEDIUMTEXT NOT NULL,
    `parent_comment_id` BIGINT NULL,
    `post_id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,

    INDEX `FK7h839m3lkvhbyv3bcdv7sm4fj`(`parent_comment_id`),
    INDEX `FK8omq0tc18jd43bu5tjh6jvraq`(`user_id`),
    INDEX `FKh4c7lvsc298whoyd4w9ta25cr`(`post_id`),
    PRIMARY KEY (`comment_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- CreateTable
CREATE TABLE `commit_history` (
    `commit_history_id` BIGINT NOT NULL AUTO_INCREMENT,
    `created_at` DATETIME(6) NOT NULL,
    `updated_at` DATETIME(6) NOT NULL,
    `commit_message` VARCHAR(255) NULL,
    `commit_sha` VARCHAR(255) NOT NULL,
    `repository_id` BIGINT NOT NULL,
    `post_id` BIGINT NOT NULL,

    INDEX `FK_commit_history_post`(`post_id`),
    INDEX `FKf9u6rea2lgma9w9w244yg04i8`(`repository_id`),
    PRIMARY KEY (`commit_history_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- CreateTable
CREATE TABLE `introductions` (
    `intro_id` BIGINT NOT NULL AUTO_INCREMENT,
    `created_at` DATETIME(6) NOT NULL,
    `updated_at` DATETIME(6) NOT NULL,
    `content` MEDIUMTEXT NOT NULL,
    `user_id` BIGINT NOT NULL,

    UNIQUE INDEX `uk_introductions_user`(`user_id`),
    PRIMARY KEY (`intro_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- CreateTable
CREATE TABLE `likes` (
    `like_id` BIGINT NOT NULL AUTO_INCREMENT,
    `created_at` DATETIME(6) NOT NULL,
    `updated_at` DATETIME(6) NOT NULL,
    `post_id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,

    INDEX `FKnvx9seeqqyy71bij291pwiwrg`(`user_id`),
    INDEX `FKry8tnr4x2vwemv2bb0h5hyl0x`(`post_id`),
    PRIMARY KEY (`like_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- CreateTable
CREATE TABLE `post_images` (
    `post_image_id` BIGINT NOT NULL AUTO_INCREMENT,
    `created_at` DATETIME(6) NOT NULL,
    `updated_at` DATETIME(6) NOT NULL,
    `image_url` VARCHAR(2048) NOT NULL,
    `post_id` BIGINT NOT NULL,

    INDEX `FKo1i5va2d8de9mwq727vxh0s05`(`post_id`),
    PRIMARY KEY (`post_image_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- CreateTable
CREATE TABLE `post_tags` (
    `post_tag_id` BIGINT NOT NULL AUTO_INCREMENT,
    `created_at` DATETIME(6) NOT NULL,
    `updated_at` DATETIME(6) NOT NULL,
    `post_id` BIGINT NOT NULL,
    `tag_id` BIGINT NOT NULL,

    INDEX `FKkifam22p4s1nm3bkmp1igcn5w`(`post_id`),
    INDEX `FKm6cfovkyqvu5rlm6ahdx3eavj`(`tag_id`),
    PRIMARY KEY (`post_tag_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- CreateTable
CREATE TABLE `posts` (
    `post_id` BIGINT NOT NULL AUTO_INCREMENT,
    `created_at` DATETIME(6) NOT NULL,
    `updated_at` DATETIME(6) NOT NULL,
    `commit_message` VARCHAR(255) NULL,
    `content` TEXT NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `repository_id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,

    INDEX `FK5lidm6cqbc7u4xhqpxm898qme`(`user_id`),
    INDEX `FKfwwqm5wbu71yvfamk29u8b87j`(`repository_id`),
    INDEX `idx_post_created_at`(`created_at` DESC),
    PRIMARY KEY (`post_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- CreateTable
CREATE TABLE `profile_images` (
    `profile_image_id` BIGINT NOT NULL AUTO_INCREMENT,
    `created_at` DATETIME(6) NOT NULL,
    `updated_at` DATETIME(6) NOT NULL,
    `profile_image_url` VARCHAR(2048) NOT NULL,
    `user_id` BIGINT NOT NULL,

    INDEX `FK6577qi31mxp06kavqxmt68fds`(`user_id`),
    PRIMARY KEY (`profile_image_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- CreateTable
CREATE TABLE `projects` (
    `project_id` BIGINT NOT NULL AUTO_INCREMENT,
    `created_at` DATETIME(6) NOT NULL,
    `updated_at` DATETIME(6) NOT NULL,
    `description` TINYTEXT NOT NULL,
    `duration` VARCHAR(50) NULL,
    `title` VARCHAR(255) NOT NULL,
    `owner_id` BIGINT NOT NULL,
    `thumbnail_url` VARCHAR(255) NULL,

    INDEX `FKmueqy6cpcwpfl8gnnag4idjt9`(`owner_id`),
    PRIMARY KEY (`project_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- CreateTable
CREATE TABLE `repository` (
    `repository_id` BIGINT NOT NULL AUTO_INCREMENT,
    `created_at` DATETIME(6) NOT NULL,
    `updated_at` DATETIME(6) NOT NULL,
    `github_url` VARCHAR(255) NULL,
    `name` VARCHAR(255) NOT NULL,
    `user_id` BIGINT NOT NULL,

    UNIQUE INDEX `UKae58thkfptnlm6ctb25xxn6am`(`user_id`),
    PRIMARY KEY (`repository_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- CreateTable
CREATE TABLE `tags` (
    `tag_id` BIGINT NOT NULL AUTO_INCREMENT,
    `created_at` DATETIME(6) NOT NULL,
    `updated_at` DATETIME(6) NOT NULL,
    `tag_name` VARCHAR(100) NOT NULL,

    UNIQUE INDEX `UK2c6s9hekidseaj5vbgb3pgy3k`(`tag_name`),
    PRIMARY KEY (`tag_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- CreateTable
CREATE TABLE `users` (
    `user_id` BIGINT NOT NULL AUTO_INCREMENT,
    `created_at` DATETIME(6) NOT NULL,
    `updated_at` DATETIME(6) NOT NULL,
    `email` VARCHAR(100) NULL,
    `gamja_batch` INTEGER NULL,
    `github_id` VARCHAR(100) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `nickname` VARCHAR(255) NOT NULL,
    `position` ENUM('APP_DEVELOPER', 'BACKEND', 'DESIGNER', 'FRONTEND') NULL,
    `role` ENUM('ADMIN', 'PENDING', 'PRE_REGISTER', 'USER') NOT NULL,
    `student_number` VARCHAR(255) NULL,

    UNIQUE INDEX `UK6dotkott2kjsp8vw4d0m25fb7`(`email`),
    UNIQUE INDEX `UKg9s8emobrgjmob2ty2va0l354`(`github_id`),
    UNIQUE INDEX `UK2ty1xmrrgtn89xt7kyxx6ta7h`(`nickname`),
    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- AddForeignKey
ALTER TABLE `comments` ADD CONSTRAINT `FK7h839m3lkvhbyv3bcdv7sm4fj` FOREIGN KEY (`parent_comment_id`) REFERENCES `comments`(`comment_id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `comments` ADD CONSTRAINT `FK8omq0tc18jd43bu5tjh6jvraq` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `comments` ADD CONSTRAINT `FKh4c7lvsc298whoyd4w9ta25cr` FOREIGN KEY (`post_id`) REFERENCES `posts`(`post_id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `commit_history` ADD CONSTRAINT `FK_commit_history_post` FOREIGN KEY (`post_id`) REFERENCES `posts`(`post_id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `commit_history` ADD CONSTRAINT `FKf9u6rea2lgma9w9w244yg04i8` FOREIGN KEY (`repository_id`) REFERENCES `repository`(`repository_id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `introductions` ADD CONSTRAINT `FK3w62f9amh41y0tvukmhwmg1mu` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `likes` ADD CONSTRAINT `FKnvx9seeqqyy71bij291pwiwrg` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `likes` ADD CONSTRAINT `FKry8tnr4x2vwemv2bb0h5hyl0x` FOREIGN KEY (`post_id`) REFERENCES `posts`(`post_id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `post_images` ADD CONSTRAINT `FKo1i5va2d8de9mwq727vxh0s05` FOREIGN KEY (`post_id`) REFERENCES `posts`(`post_id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `post_tags` ADD CONSTRAINT `FKkifam22p4s1nm3bkmp1igcn5w` FOREIGN KEY (`post_id`) REFERENCES `posts`(`post_id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `post_tags` ADD CONSTRAINT `FKm6cfovkyqvu5rlm6ahdx3eavj` FOREIGN KEY (`tag_id`) REFERENCES `tags`(`tag_id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `posts` ADD CONSTRAINT `FK5lidm6cqbc7u4xhqpxm898qme` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `posts` ADD CONSTRAINT `FKfwwqm5wbu71yvfamk29u8b87j` FOREIGN KEY (`repository_id`) REFERENCES `repository`(`repository_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `profile_images` ADD CONSTRAINT `FK6577qi31mxp06kavqxmt68fds` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `projects` ADD CONSTRAINT `FKmueqy6cpcwpfl8gnnag4idjt9` FOREIGN KEY (`owner_id`) REFERENCES `users`(`user_id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `repository` ADD CONSTRAINT `FK52sbe60tcte61u3h80w181pqx` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

