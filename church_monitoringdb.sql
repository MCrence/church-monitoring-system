-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Generation Time: Sep 13, 2026 at 07:01 PM
-- Server version: 10.4.32-MariaDB
-- PHP Version: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `church_monitoring_db`
--
CREATE DATABASE IF NOT EXISTS `church_monitoring_db` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `church_monitoring_db`;

-- --------------------------------------------------------

--
-- Table structure for table `check_in_logs`
--

CREATE TABLE `check_in_logs` (
  `id` int(11) UNSIGNED NOT NULL,
  `participant_id` int(11) UNSIGNED NOT NULL,
  `qr_code_id` int(11) UNSIGNED DEFAULT NULL,
  `event_name` varchar(100) NOT NULL,
  `checked_in_at` datetime DEFAULT NULL,
  `checked_out_at` datetime DEFAULT NULL,
  `location` varchar(100) DEFAULT NULL,
  `status` varchar(30) NOT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `check_in_logs`
--

INSERT INTO `check_in_logs` (`id`, `participant_id`, `qr_code_id`, `event_name`, `checked_in_at`, `checked_out_at`, `location`, `status`, `created_at`, `updated_at`) VALUES
(1, 5, 11, 'Sunday service', '2026-08-25 23:19:50', NULL, 'Main hall', 'checked_in', '2026-08-25 23:19:50', NULL),
(2, 4, 10, 'Sunday service', '2026-08-25 23:42:33', NULL, 'Main hall', 'checked_in', '2026-08-25 23:42:33', NULL),
(3, 5, 11, 'Sunday service', '2026-08-25 23:42:40', NULL, 'Main hall', 'checked_in', '2026-08-25 23:42:40', NULL),
(4, 5, 11, 'Sunday service', '2026-08-25 23:47:24', NULL, 'Main hall', 'checked_in', '2026-08-25 23:47:24', NULL),
(5, 4, 10, 'Sunday Mass', '2026-08-25 23:53:17', NULL, 'FMC Hall', 'checked_in', '2026-08-25 23:53:17', NULL),
(6, 5, 11, 'Sunday Mass', '2026-08-25 23:53:22', NULL, 'FMC Hall', 'checked_in', '2026-08-25 23:53:22', NULL),
(7, 4, 10, 'Sunday service', '2026-08-25 23:58:01', NULL, 'Main hall', 'checked_in', '2026-08-25 23:58:01', NULL),
(8, 4, 10, 'Children\'s Ministry', '2026-08-26 00:10:58', NULL, 'Main hall', 'checked_in', '2026-08-26 00:10:58', NULL),
(9, 5, 11, 'Children\'s Ministry', '2026-08-26 00:11:02', NULL, 'Main hall', 'checked_in', '2026-08-26 00:11:02', NULL),
(10, 6, 12, 'Sunday service', '2026-09-03 00:17:55', NULL, 'Main hall', 'checked_in', '2026-09-03 00:17:55', NULL),
(11, 5, 11, 'Sunday service', '2026-09-03 00:18:50', NULL, 'Main hall', 'checked_in', '2026-09-03 00:18:50', NULL),
(12, 4, 10, 'Sunday service', '2026-09-03 00:19:00', NULL, 'Main hall', 'checked_in', '2026-09-03 00:19:00', NULL),
(13, 4, 10, 'Mass Production', '2026-09-03 23:38:36', NULL, 'Main Hall', 'checked_in', '2026-09-03 23:38:36', NULL),
(14, 5, 11, 'Mass Production', '2026-09-03 23:38:40', NULL, 'Main Hall', 'checked_in', '2026-09-03 23:38:40', NULL),
(15, 6, 12, 'Mass Production', '2026-09-03 23:38:44', NULL, 'Main Hall', 'checked_in', '2026-09-03 23:38:44', NULL);

-- --------------------------------------------------------

--
-- Table structure for table `events`
--

CREATE TABLE `events` (
  `id` int(10) UNSIGNED NOT NULL,
  `name` varchar(100) NOT NULL,
  `description` varchar(500) DEFAULT NULL,
  `starts_at` datetime NOT NULL,
  `ends_at` datetime DEFAULT NULL,
  `location` varchar(100) DEFAULT NULL,
  `status` varchar(30) NOT NULL DEFAULT 'scheduled',
  `created_by` int(10) UNSIGNED DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `events`
--

INSERT INTO `events` (`id`, `name`, `description`, `starts_at`, `ends_at`, `location`, `status`, `created_by`, `created_at`, `updated_at`) VALUES
(1, 'Mass Production', 'Worship is a vital component of spiritual growth, defined not merely as singing or ritual, but as a holistic lifestyle of self-surrender and adoration that reorients the heart toward God.  It serves as a means of transformation, renewing the mind and conforming the believer to the image of Christ through both corporate and personal practices.', '2026-09-03 10:00:00', '2026-09-03 17:00:00', 'Main Hall', 'scheduled', 1, '2026-09-03 23:30:44', '2026-09-03 23:30:44');

-- --------------------------------------------------------

--
-- Table structure for table `growth_updates`
--

CREATE TABLE `growth_updates` (
  `id` int(11) UNSIGNED NOT NULL,
  `participant_id` int(11) UNSIGNED NOT NULL,
  `note_encrypted` text DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `migrations`
--

CREATE TABLE `migrations` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `version` varchar(255) NOT NULL,
  `class` varchar(255) NOT NULL,
  `group` varchar(255) NOT NULL,
  `namespace` varchar(255) NOT NULL,
  `time` int(11) NOT NULL,
  `batch` int(11) UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `migrations`
--

INSERT INTO `migrations` (`id`, `version`, `class`, `group`, `namespace`, `time`, `batch`) VALUES
(1, '20260707120000', 'App\\Database\\Migrations\\CreateCoreTables', 'default', 'App', 1783431646, 1),
(2, '20260707130000', 'App\\Database\\Migrations\\AddSensitiveFieldsAndLogs', 'default', 'App', 1783438638, 2),
(3, '20260707140000', 'App\\Database\\Migrations\\CreateQrManagementTables', 'default', 'App', 1783440814, 3),
(4, '20260816002000', 'App\\Database\\Migrations\\AddParticipantRegistrationFields', 'default', 'App', 1786812268, 4);

-- --------------------------------------------------------

--
-- Table structure for table `participants`
--

CREATE TABLE `participants` (
  `id` int(11) UNSIGNED NOT NULL,
  `participant_type` varchar(50) NOT NULL,
  `full_name_encrypted` text DEFAULT NULL,
  `date_of_birth_encrypted` text DEFAULT NULL,
  `gender` varchar(20) DEFAULT NULL,
  `phone_encrypted` text DEFAULT NULL,
  `address_encrypted` text DEFAULT NULL,
  `sponsor_id` int(11) UNSIGNED DEFAULT NULL,
  `passcode_hash` varchar(255) DEFAULT NULL,
  `medical_notes_encrypted` text DEFAULT NULL,
  `weight_encrypted` varchar(255) DEFAULT NULL,
  `height_encrypted` varchar(255) DEFAULT NULL,
  `status` varchar(30) NOT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  `emergency_contact_name_encrypted` text DEFAULT NULL,
  `emergency_contact_phone_encrypted` text DEFAULT NULL,
  `medical_conditions_encrypted` text DEFAULT NULL,
  `special_needs_encrypted` text DEFAULT NULL,
  `sponsor_name_encrypted` text DEFAULT NULL,
  `sponsor_contact_encrypted` text DEFAULT NULL,
  `sponsorship_start_date` date DEFAULT NULL,
  `sponsorship_status` varchar(32) DEFAULT 'active',
  `sponsor_family_name_encrypted` text DEFAULT NULL,
  `communication_history_encrypted` text DEFAULT NULL,
  `donation_history_encrypted` longtext DEFAULT NULL,
  `sponsorship_payments_encrypted` longtext DEFAULT NULL,
  `growth_metrics_encrypted` longtext DEFAULT NULL,
  `failed_passcode_attempts` int(11) DEFAULT 0,
  `locked_until` datetime DEFAULT NULL,
  `last_passcode_attempt_at` datetime DEFAULT NULL,
  `participant_code` varchar(50) DEFAULT NULL,
  `citizenship_encrypted` text DEFAULT NULL,
  `father_name_encrypted` text DEFAULT NULL,
  `mother_name_encrypted` text DEFAULT NULL,
  `guardian_name_encrypted` text DEFAULT NULL,
  `parent_contact_encrypted` text DEFAULT NULL,
  `sponsor_email_encrypted` text DEFAULT NULL,
  `sponsor_address_encrypted` text DEFAULT NULL,
  `sponsorship_type` varchar(64) DEFAULT NULL,
  `enrollment_date` date DEFAULT NULL,
  `program_affiliation_encrypted` text DEFAULT NULL,
  `letters_sent_encrypted` longtext DEFAULT NULL,
  `letters_received_encrypted` longtext DEFAULT NULL,
  `last_letter_date` date DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `participants`
--

INSERT INTO `participants` (`id`, `participant_type`, `full_name_encrypted`, `date_of_birth_encrypted`, `gender`, `phone_encrypted`, `address_encrypted`, `sponsor_id`, `passcode_hash`, `medical_notes_encrypted`, `weight_encrypted`, `height_encrypted`, `status`, `created_at`, `updated_at`, `emergency_contact_name_encrypted`, `emergency_contact_phone_encrypted`, `medical_conditions_encrypted`, `special_needs_encrypted`, `sponsor_name_encrypted`, `sponsor_contact_encrypted`, `sponsorship_start_date`, `sponsorship_status`, `sponsor_family_name_encrypted`, `communication_history_encrypted`, `donation_history_encrypted`, `sponsorship_payments_encrypted`, `growth_metrics_encrypted`, `failed_passcode_attempts`, `locked_until`, `last_passcode_attempt_at`, `participant_code`, `citizenship_encrypted`, `father_name_encrypted`, `mother_name_encrypted`, `guardian_name_encrypted`, `parent_contact_encrypted`, `sponsor_email_encrypted`, `sponsor_address_encrypted`, `sponsorship_type`, `enrollment_date`, `program_affiliation_encrypted`, `letters_sent_encrypted`, `letters_received_encrypted`, `last_letter_date`) VALUES
(1, 'goer', 'MgUdSTqPrGZYzEiC.AHh9f15JisufPkCQXQtk2g.5dr8lDIk6FHNT_M-noM', 'MpOInEO1a5itjD-Z.MHhfMnxjMhyHQMFVUvp7gA.F0hom0o_xuu7ww', 'Male', 'Ct-s6zRiP_ZALpO5.9b2FLEZyMOB2fMNoIaHhgw.pYeDFDQqnl_NtkQ', 'fpvbim2aBL-kpl4M.S7ITEJ8tmql4sMLSmBb6JQ.4uv9ovvVhZ6eDUAGjdedNtRhF5Yr4uwdDwqE4PuAnhjg5FyINHdo72pMIaVMn_KENYfjw-6nBnUkJWA7JUY', 0, '$2y$10$buampFypYnjI/H9G1tq0E.uGUFD/A/Wn/J2Zj7uEtxGku48358KUO', NULL, NULL, NULL, 'deleted', NULL, '2026-08-26 00:56:19', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'active', NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
(2, 'goer', 'wUNq4wDaBaeah6P4.9aZdcOOXqB46oXFqQlklGg.HuFlaLslHu8i2i_ij8aT', 'H7D2AhJx7nene8mE.jJwNDvFLVca22ONIqiwJaw._y9_61KUndkBPA', 'Male', 'GSoSJ5s3pV8ctiXF.8-igYp57683oxpXpkQyXKg.6rvDtgK8tDmBMq4', 'kJMnzLedYd_NVm8l.8VhLxLOqIM2W1Gi5m89uQg.DqXZz_3ZZZTspEYl-BYNjJvK3DWvOvzKuOjVNLcgXhae1QfPbhI', 0, '$2y$10$X/pSomN/mUwENN1Ri.SqtOd/CRdDBQBqLFNJWXyPQhEsqkFG0aqKu', NULL, NULL, NULL, 'deleted', NULL, '2026-08-26 01:05:57', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'active', NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
(3, 'goer', '5lQctaGPRwdQSCtH.VDE2iTtHV4unCdx-XQlfPg.hZ_yBcLOHxVx2SFlDkeixo0DLwo', 'mQac_qY-vg5RJo2U.p6AXwyhxK4FbXc7Gxt2loQ.YGq5B-v7WULSMg', 'Female', 'gwOi8U2nREN_uxxc.xjte0cRyIsGLYnAOzEg4cA.hGGMlyBHLQL2ShY', 'xxYvcB7_d4iOF0gC.ls_IWiDr0xy-UWjn2Ry-Jw._4OR3bNSxECn40SAjfPgtFnjkfmY2dKwQJmhRFtp9ah-rI523PimmpYQXlcZbfChfH65r1NvpknfLCylG5o', NULL, '$2y$10$DPa.MiGLNjgw2F9IR52q7.z5Bx7wUVWTKUQNQRsRSY0n.GCRtR9M2', NULL, NULL, NULL, 'deleted', '2026-08-15 18:57:47', '2026-08-26 01:06:04', NULL, NULL, NULL, NULL, NULL, NULL, '2026-08-15', 'active', 'c0dGb3FONzBGSWJsYm9makh1ZTlRdz09', NULL, NULL, NULL, 'TUFyNDRxYnBxb0k4ejlIVFhray95UHFYcHFiYzVMWmRndDZ3VkxqOW13M3hqSkFHdDYxTW54MEdlUnQ1Ukk3RDJiYS9yYlBMZUhvakc2WURDZ0RIY05NODdjVHpWekJwSFd0NndzVnIzTjVZd1F1ZXEzVzV0dEw3c1dlSGxMRnhyV2VJL3J5NTFCdWFSS3BjQmlCSEFnPT0=', 0, NULL, NULL, 'FMC-2026-0003', 'TVZtaVBPODdkZFMrWHJnVGhJNEtQQT09', 'Ulp4WGJMVnBpZnpmSm53eUJjaVl6QT09', 'UUppclVOM1lWWURTYkxoNEI3ak1SUT09', 'U2pNUWoza041UzZiZDM0RHFEMVJ3UT09', 'Q1hNQWlySm5NbWhrZFNOMnhsVVdqUT09', 'Vmc0dXRtQ1lnNTFjSWpvbXE5TDF4bUFzejNtSDNNL2RhSDBwR3dqQmowbz0=', 'NjFqZGNYNHpDYTZiWWdIM2FRNStMZz09', NULL, NULL, NULL, NULL, NULL, NULL),
(4, 'sponsored_child', '7je4Pfdqk2qDfCDZ.Y36fAE-VbKjQ0mO9mv_PGA.h9WWk-VatFyqOrtITOiHIaD4Hexo', 'q_6VBXAXoG-f-_s8.oXJ1s5cAB942wi6oKEsejw.Tm_-BJBAj-lMAA', 'Female', '2MbDb72wGMOG-pv5.MDnJwQM5ZVk9UJzCimExTw.GEVCH8V7lMHMWOqdOg', 'O6m4rvanUefZvebJ.PK1EB9lhAUNGV43ETBaGQw.m7IiYnGT7VKJ5umY7GyViB7g8OPRFZdZsr8Wrj14hw', NULL, '$2b$12$vlqTGdARsabbWkfjwOSkg.X4nmrB3R6dJOZ3eI1wQPoj/bKSyuPP2', NULL, 'jmsXcWQ-5KoCsSkn.Ybo1zD4GRYiFVaHBDRxzmw.CZU', 'kL-kB21TcxofiJzy.vT7ZZmlUXszC09EYR4He-A.1PNE', 'active', '2026-08-25 20:11:53', '2026-08-25 21:22:36', 'xP4hFxoONbhWPS9L.Yw1uAw2Lv7vK_ENcfYjzyA.KZ4s8kzljwdBxDj3', '7CjAv4r7vgzwYGI8.PpAkOkC3gZdQze1qbBdddg.oG_fR75xt7C17kknVQ', 'KA-Au8xDwGDfuf_c.uAgm9XusGcFTEJxiv4fXLQ.xQVnEg', NULL, 'P8BW6PoCZzuyTOgM.IEfSUhlGqAzW41Co_yfRYg.chZmBmzVEul3Go_hHD8e7A0u1YiD', 'rYyb7buzDVkO_2bA.ZEHnfNlGqDkyBk9Mod0mbw.3Mfh71vAVc_fV_AFatcu', NULL, 'active', NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL, 'FMC-2026-34A73F', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Child Development Sponsorship', '2023-06-10', 'GIDkHWqg6AOfmWU5.U-Z0eKREOLH3Ch1oBr5mCQ.Yr4B9u7R2XovXZAQc79QM6bRqLQlebcixNg', NULL, NULL, NULL),
(5, 'sponsored_child', '_v5KhbQq5NHyiGHW.5ynapaMJjOxIgIUnBv0HhQ.KP7_Atp-FzaxSNrMw0IaLAA8nP1HB98', '2sIijllQX9YZTC3W.zq7cVo-W0OiBiz8Dvb-D8g.gLOWDfJGHkqV_g', 'Male', 'mMpltLXOf3vux9yn.lvoCc_FkvPOWgm2jN_noOA.4MBccapmgwEaTcVU7g', 'QvcsYoOpSk8jEW6a.0jDA1nYBrfB2SEiHq_4gkg.VuO9xxhSCDJfCmGbX9FIunb3Ci9HUjdFk-KZG_pzKg', NULL, '$2b$12$cBGOahq0nvz31RC7WXqGSOyZBcFSe7vPNd//QowOTCtokOGiOB9W6', 'BTIa8xBYKCRwu1gA.hl0fYWh8Z0pPDnFqzZVNog.AETc_Zeh', 'da1z4u0k3FHfAl9B.L96Fom-sqeDLkI77iz2MXA.CI0', 'qsT8Rt9ZHxzT8Dyr.d49J8MudL1x1h7Vf_Cl2Lg.wf7F', 'active', '2026-08-25 20:23:49', '2026-09-03 00:29:59', 'L7-hgj3ppLzER6RD.bQRBgvrK5olbF7XPH0CO8w.S0k_83PYfY-e5WrvUK8AZaM', '3id-x6CKmt6z1d9z.z-z5gY4D8x-OYBOdOwUxEg.9fihnMKPhA35PC5xQw', '-0oo4A1bpu4XAjix.UjUdMKzxZJQlS6aNiQoopg.g4i9RBYL', NULL, 'DXd0T-JMb5Qqn-2Q.y4QNHXGdg7gxO5nf4M4MEw.O7_iwxuB4MAlwjCwwL0UpKPdyA', '5YE0wIbnXXxKDi7J.EJRyLrXspAy7dB8SGX5HQg.nKcZPEE6Bxz5nEPaWsu7', NULL, 'active', NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL, 'FMC-2026-17B9DA', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Child Development Sponsorship', '2024-06-27', '1Yl2lxnYxon5ZMwq.vAeE_dPILQECN0INSK6aEg.hlS_JQqZkIbYKrPjDxnlpWlcBhPmEdN4WjQ', NULL, NULL, NULL),
(6, 'goer', 'qwMZ2l55NNzTYqvh.Xh6c0FIu_4Bf2o8mRhR7aA.8zdmjrtxthjlxscASjIddcs', 'KdQQ6RBmzHdoAFYl.NgMfH81O9ZkNOwJKba_f1g.', 'Female', 'jfIj_4O9dqMpiqt1.Sff4n5C4tylc-S5MtbJdNA.7l4Nepg0YGv5AhU', 'uNFY8Av_d_ztNY5_.af6SL7FyGad_UlzvpSs38g.-iyxLdrjaocmIg_B3HT969gCs4MSVG7914jGsxoSLytV', NULL, NULL, NULL, 'yPx75MBvXuBv5_mO.cOuhbAZA_Y1j8mqWHrI9UQ.', 'PUSrFxeEB5o_B_qa.ooRB-F8-P4qp4VeXDog4zw.', 'active', '2026-09-02 23:49:53', '2026-09-03 00:36:38', '67XiPPLSo5OG0H5Z.72ZsHZukfYZq8xJtzwSXIw.', 'v-CQPsozNiuxznQ_.LYZ5ov5oemZWSAcrvFRhyA.', 'RgwQi3yqxgqSpv7F.UAiQP6kmGi6T2_AYPaPn3A.', NULL, 'XoZGTLuGZiBksDYz.XTEX65B_N4DMWo3ztQVywA.', 'bHvBfw6BuRlIX8CW.My2CQIg1xYeyySZz_EJpWQ.', NULL, 'active', NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL, 'FMC-2026-A0945F', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'WNgimcUagH16xNO2.MUqvQR1dHbuAZI0sJFJV6A.', NULL, NULL, NULL);

-- --------------------------------------------------------

--
-- Table structure for table `predictive_risk_scores`
--

CREATE TABLE `predictive_risk_scores` (
  `id` int(11) UNSIGNED NOT NULL,
  `participant_id` int(11) UNSIGNED NOT NULL,
  `risk_score` decimal(5,2) NOT NULL,
  `risk_level` varchar(20) NOT NULL,
  `model_version` varchar(50) NOT NULL,
  `computed_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `qr_codes`
--

CREATE TABLE `qr_codes` (
  `id` int(11) UNSIGNED NOT NULL,
  `participant_id` int(11) UNSIGNED NOT NULL,
  `qr_uid` varchar(255) NOT NULL,
  `qr_code_image` varchar(255) DEFAULT NULL,
  `status` enum('active','inactive','revoked') NOT NULL DEFAULT 'active',
  `assigned_at` datetime DEFAULT NULL,
  `last_scanned_at` datetime DEFAULT NULL,
  `scan_count` int(11) NOT NULL DEFAULT 0,
  `created_by` int(11) UNSIGNED DEFAULT NULL,
  `revoked_at` datetime DEFAULT NULL,
  `revoked_reason` text DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `qr_codes`
--

INSERT INTO `qr_codes` (`id`, `participant_id`, `qr_uid`, `qr_code_image`, `status`, `assigned_at`, `last_scanned_at`, `scan_count`, `created_by`, `revoked_at`, `revoked_reason`, `created_at`, `updated_at`) VALUES
(1, 1, 'eyJ1aWQiOiJRV1I1U0ZWeFdraDNUMWRQYzBsQmRVMUNLMjlRWVhkNVYxcDVTbEZyT1doMlVESkxjVU4xT1dSRll6MD0iLCJ0eXBlIjoicGFydGljaXBhbnQiLCJpc3N1ZWRfYXQiOiIyMDI2LTA3LTA3VDE2OjQyOjA4KzAwOjAwIn0=', 'uploads/qr_codes/qr_1_1783442528.png', 'revoked', '2026-07-07 16:42:10', NULL, 0, 1, '2026-08-26 00:56:19', NULL, '2026-07-07 16:42:10', NULL),
(2, 1, 'eyJ1aWQiOiJXamRGWkdSVlJHcGlkVkkzUTFCcU1tRktlV2hzVFcxTFR5ODVjbUYwVjJSS1FsZHRlVUZCTmxWa1dUMD0iLCJ0eXBlIjoicGFydGljaXBhbnQiLCJpc3N1ZWRfYXQiOiIyMDI2LTA3LTA3VDE2OjQ3OjIxKzAwOjAwIn0=', 'uploads/qr_codes/qr_batch_1_1783442841.png', 'revoked', '2026-07-07 16:47:23', NULL, 0, 1, '2026-08-26 00:56:19', NULL, '2026-07-07 16:47:23', NULL),
(3, 1, 'eyJ1aWQiOiJjRGhNTUVSd1ptTmhSWEp1U0ZWMmFDODRhUzlOVTB0UVlUWm1SVXRXYmpWSldURjBiR3hrZWt0cFNUMD0iLCJ0eXBlIjoicGFydGljaXBhbnQiLCJpc3N1ZWRfYXQiOiIyMDI2LTA3LTA3VDE2OjQ3OjIzKzAwOjAwIn0=', 'uploads/qr_codes/qr_batch_1_1783442843.png', 'revoked', '2026-07-07 16:47:25', NULL, 0, 1, '2026-08-26 00:56:19', NULL, '2026-07-07 16:47:25', NULL),
(4, 3, 'eyJ1aWQiOiJNa3BxTmxrNGNFNUNaRTltY0ZGSmJESkRLMUJNU0dJdmNYRnNaV2hSU0dwUlUxSkhaM3AyZGxWWk9EMD0iLCJ0eXBlIjoicGFydGljaXBhbnQiLCJpc3N1ZWRfYXQiOiIyMDI2LTA4LTE1VDE3OjE1OjM5KzAwOjAwIn0=', 'uploads/qr_codes/qr_3_1786814139.png', 'revoked', '2026-08-15 17:15:41', NULL, 0, 1, '2026-08-26 01:06:04', NULL, '2026-08-15 17:15:41', NULL),
(5, 2, 'eyJ1aWQiOiJhR2RYVjBNNVRqRTRXVkJwYVRGdGQxRkpTM2MyTm5CcFNIbzBSRFk0VWs1bU5rdE5OSFZuTjNZNFp6MD0iLCJ0eXBlIjoicGFydGljaXBhbnQiLCJpc3N1ZWRfYXQiOiIyMDI2LTA4LTI1VDA5OjA2OjU4KzAwOjAwIn0=', 'uploads/qr_codes/qr_2_1787648818.png', 'revoked', '2026-08-25 09:07:00', NULL, 0, 1, '2026-08-26 01:05:57', NULL, '2026-08-25 09:07:00', NULL),
(6, 2, 'eyJ1aWQiOiJWVkpyY0d0M2JraEtZWFZvUXpKSmNFdDFPVkJJU1habU5tVjBiRGh3VjFvclVWaERaM2N4WW5obVNUMD0iLCJ0eXBlIjoicGFydGljaXBhbnQiLCJpc3N1ZWRfYXQiOiIyMDI2LTA4LTI1VDA5OjA3OjE3KzAwOjAwIn0=', 'uploads/qr_codes/qr_2_1787648837.png', 'revoked', '2026-08-25 09:07:19', NULL, 0, 1, '2026-08-26 01:05:57', NULL, '2026-08-25 09:07:19', NULL),
(7, 2, 'eyJ1aWQiOiJabmh0VjNKbFlUQkJPQ3RDTUU5dmFIZFJVbVpxVURaQ05WUXZOMWhGUjBwQmNGVlVMMmxTZUZsNFZUMD0iLCJ0eXBlIjoicGFydGljaXBhbnQiLCJpc3N1ZWRfYXQiOiIyMDI2LTA4LTI1VDA5OjA3OjE5KzAwOjAwIn0=', 'uploads/qr_codes/qr_2_1787648839.png', 'revoked', '2026-08-25 09:07:21', NULL, 0, 1, '2026-08-26 01:05:57', NULL, '2026-08-25 09:07:21', NULL),
(8, 2, 'eyJ1aWQiOiJORkJqWkRjclRVZHhPRWhaVW1wVFRtWnNjVWhDVTBsWVJGUTVhMDh4VWtKaEwySlBhVlJ1TUdGaU5EMD0iLCJ0eXBlIjoicGFydGljaXBhbnQiLCJpc3N1ZWRfYXQiOiIyMDI2LTA4LTI1VDA5OjA3OjM1KzAwOjAwIn0=', 'uploads/qr_codes/qr_2_1787648855.png', 'revoked', '2026-08-25 09:07:37', NULL, 0, 1, '2026-08-26 01:05:57', NULL, '2026-08-25 09:07:37', NULL),
(9, 1, 'eyJ1aWQiOiJaWEZCUzFkTk1sRnNMMDlYVFROdmMwNHpNVTlwVjBKRGJucExaak16WVVSYVVFRkJVSHB5YmxwT2N6MD0iLCJ0eXBlIjoicGFydGljaXBhbnQiLCJpc3N1ZWRfYXQiOiIyMDI2LTA4LTI1VDA5OjA3OjM5KzAwOjAwIn0=', 'uploads/qr_codes/qr_1_1787648859.png', 'revoked', '2026-08-25 09:07:41', NULL, 0, 1, '2026-08-26 00:56:19', NULL, '2026-08-25 09:07:41', NULL),
(10, 4, 'GB-mo4obcqtg2j2f.fwqxrqJWcumR57WjJaku0A.nppEe7OI9tUzMXrixIZpthO6cXsD83gpInRA5Qo7AExRZvIA', 'uploads/qr_codes/qr_4_1787659913016.png', 'active', '2026-08-25 20:11:53', '2026-09-03 23:38:36', 7, 1, NULL, NULL, '2026-08-25 20:11:53', NULL),
(11, 5, 'DxnsLCAYaS5CPAAz.W05QrJ3XdyJ8ryRtc1U39g.U9cJqaEBrOt9x22rTSb6yeRHehXziZUZkqSXsWeKZEGMI2Ra', 'uploads/qr_codes/qr_5_1787660629986.png', 'active', '2026-08-25 20:23:50', '2026-09-03 23:38:40', 12, 1, NULL, NULL, '2026-08-25 20:23:50', NULL),
(12, 6, 'QOPJHEkcRLtyq2eI.pd9eyZJ-9cHAuRfTIs10xg.0vZw5oyCpSmQ2BjyTPwGlArdj4mfObK6OQ4Cm7_aPLhSc3AZ', 'uploads/qr_codes/qr_6_1788364193380.png', 'active', '2026-09-02 23:49:53', '2026-09-03 23:38:48', 9, 1, NULL, NULL, '2026-09-02 23:49:53', NULL);

-- --------------------------------------------------------

--
-- Table structure for table `qr_code_ids`
--

CREATE TABLE `qr_code_ids` (
  `id` int(11) UNSIGNED NOT NULL,
  `participant_id` int(11) UNSIGNED NOT NULL,
  `code_value` varchar(100) NOT NULL,
  `code_type` varchar(50) NOT NULL,
  `issued_at` datetime DEFAULT NULL,
  `expires_at` datetime DEFAULT NULL,
  `status` varchar(30) NOT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `qr_scan_logs`
--

CREATE TABLE `qr_scan_logs` (
  `id` int(11) UNSIGNED NOT NULL,
  `qr_code_id` int(11) UNSIGNED NOT NULL,
  `participant_id` int(11) UNSIGNED NOT NULL,
  `event_type` varchar(50) DEFAULT NULL,
  `location` varchar(100) DEFAULT NULL,
  `scanner_device` varchar(100) DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `scan_timestamp` datetime DEFAULT NULL,
  `status` enum('success','failed','blocked') NOT NULL DEFAULT 'success',
  `error_message` text DEFAULT NULL,
  `created_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `sensitive_access_logs`
--

CREATE TABLE `sensitive_access_logs` (
  `id` int(11) UNSIGNED NOT NULL,
  `participant_id` int(11) DEFAULT NULL,
  `user_id` int(11) DEFAULT NULL,
  `action` varchar(128) NOT NULL,
  `success` tinyint(1) NOT NULL DEFAULT 0,
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` text DEFAULT NULL,
  `details` longtext DEFAULT NULL,
  `created_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `sensitive_access_logs`
--

INSERT INTO `sensitive_access_logs` (`id`, `participant_id`, `user_id`, `action`, `success`, `ip_address`, `user_agent`, `details`, `created_at`) VALUES
(1, 3, 1, 'staff_view_sensitive', 1, '::1', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36', 'null', '2026-08-15 17:15:47'),
(2, 3, 1, 'staff_view_sensitive', 1, '::1', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36', 'null', '2026-08-15 17:15:53'),
(3, 3, 1, 'staff_view_sensitive', 1, '::1', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36', 'null', '2026-08-15 17:24:20'),
(4, 3, 1, 'staff_view_sensitive', 1, '::1', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36', 'null', '2026-08-15 17:30:16'),
(5, 3, 1, 'staff_view_sensitive', 1, '::1', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36', 'null', '2026-08-15 17:30:23'),
(6, 1, 1, 'staff_view_sensitive', 1, '::1', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36', 'null', '2026-08-15 17:33:50'),
(7, 2, 1, 'staff_view_sensitive', 1, '::1', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36', 'null', '2026-08-25 09:07:26');

-- --------------------------------------------------------

--
-- Table structure for table `sponsors`
--

CREATE TABLE `sponsors` (
  `id` int(11) UNSIGNED NOT NULL,
  `name_encrypted` text DEFAULT NULL,
  `phone_encrypted` text DEFAULT NULL,
  `email_encrypted` text DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `system_logs`
--

CREATE TABLE `system_logs` (
  `id` int(11) UNSIGNED NOT NULL,
  `user_id` int(11) UNSIGNED DEFAULT NULL,
  `action` varchar(150) NOT NULL,
  `entity_type` varchar(50) NOT NULL,
  `entity_id` int(11) UNSIGNED DEFAULT NULL,
  `details` text DEFAULT NULL,
  `created_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `system_logs`
--

INSERT INTO `system_logs` (`id`, `user_id`, `action`, `entity_type`, `entity_id`, `details`, `created_at`) VALUES
(1, NULL, 'GET /api/health', 'request', NULL, '{\"status\":200,\"durationMs\":953}', '2026-08-25 19:18:49'),
(2, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":503}', '2026-08-25 19:40:50'),
(3, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":347}', '2026-08-25 19:41:30'),
(4, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":85}', '2026-08-25 19:41:30'),
(5, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":9}', '2026-08-25 19:41:30'),
(6, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":46}', '2026-08-25 19:42:12'),
(7, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":9}', '2026-08-25 19:42:12'),
(8, 1, 'GET /api/risk-scores', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-25 19:42:28'),
(9, 1, 'GET /api/risk-scores', 'request', NULL, '{\"status\":304,\"durationMs\":4}', '2026-08-25 19:42:28'),
(10, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":38}', '2026-08-25 19:42:43'),
(11, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":13}', '2026-08-25 19:42:43'),
(12, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":354}', '2026-08-25 19:43:01'),
(13, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":16}', '2026-08-25 19:43:32'),
(14, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":28}', '2026-08-25 19:43:32'),
(15, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":25}', '2026-08-25 19:52:33'),
(16, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":11}', '2026-08-25 19:53:58'),
(17, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":12}', '2026-08-25 19:53:58'),
(18, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":8}', '2026-08-25 19:56:23'),
(19, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":8}', '2026-08-25 19:56:23'),
(20, NULL, 'GET /api/dashboard', 'request', NULL, '{\"status\":401,\"durationMs\":2}', '2026-08-25 20:03:41'),
(21, NULL, 'GET /api/dashboard', 'request', NULL, '{\"status\":401,\"durationMs\":3}', '2026-08-25 20:03:41'),
(22, NULL, 'POST /api/participants', 'request', NULL, '{\"status\":401,\"durationMs\":1}', '2026-08-25 20:09:47'),
(23, NULL, 'GET /api/dashboard', 'request', NULL, '{\"status\":401,\"durationMs\":2}', '2026-08-25 20:10:01'),
(24, NULL, 'GET /api/dashboard', 'request', NULL, '{\"status\":401,\"durationMs\":3}', '2026-08-25 20:10:01'),
(25, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":500}', '2026-08-25 20:11:52'),
(26, 1, 'POST /api/participants', 'request', NULL, '{\"status\":201,\"durationMs\":666}', '2026-08-25 20:11:53'),
(27, NULL, 'GET /api/dashboard', 'request', NULL, '{\"status\":401,\"durationMs\":1}', '2026-08-25 20:13:04'),
(28, NULL, 'GET /api/dashboard', 'request', NULL, '{\"status\":401,\"durationMs\":2}', '2026-08-25 20:13:04'),
(29, NULL, 'GET /api/dashboard', 'request', NULL, '{\"status\":401,\"durationMs\":3}', '2026-08-25 20:13:10'),
(30, NULL, 'GET /api/dashboard', 'request', NULL, '{\"status\":401,\"durationMs\":4}', '2026-08-25 20:13:10'),
(31, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":359}', '2026-08-25 20:13:19'),
(32, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-08-25 20:13:19'),
(33, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":13}', '2026-08-25 20:13:19'),
(34, 1, 'GET /api/risk-scores', 'request', NULL, '{\"status\":304,\"durationMs\":8}', '2026-08-25 20:13:31'),
(35, 1, 'GET /api/risk-scores', 'request', NULL, '{\"status\":304,\"durationMs\":102}', '2026-08-25 20:13:31'),
(36, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":16}', '2026-08-25 20:13:46'),
(37, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":25}', '2026-08-25 20:13:46'),
(38, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":460}', '2026-08-25 20:16:17'),
(39, NULL, 'GET /api/participants/4', 'request', NULL, '{\"status\":404,\"durationMs\":5}', '2026-08-25 20:16:17'),
(40, NULL, 'GET /api/health', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-08-25 20:18:04'),
(41, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":580}', '2026-08-25 20:19:01'),
(42, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":200,\"durationMs\":27}', '2026-08-25 20:19:01'),
(43, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":39}', '2026-08-25 20:19:48'),
(44, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":27}', '2026-08-25 20:19:48'),
(45, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":7}', '2026-08-25 20:19:51'),
(46, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":3}', '2026-08-25 20:19:51'),
(47, 1, 'GET /api/participants/1', 'request', NULL, '{\"status\":500,\"durationMs\":5}', '2026-08-25 20:19:58'),
(48, 1, 'GET /api/participants/2', 'request', NULL, '{\"status\":500,\"durationMs\":5}', '2026-08-25 20:20:00'),
(49, 1, 'GET /api/participants/3', 'request', NULL, '{\"status\":500,\"durationMs\":4}', '2026-08-25 20:20:01'),
(50, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-25 20:20:02'),
(51, 1, 'POST /api/participants', 'request', NULL, '{\"status\":201,\"durationMs\":450}', '2026-08-25 20:23:50'),
(52, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":845}', '2026-08-25 20:27:24'),
(53, 1, 'GET /api/participants/2', 'request', NULL, '{\"status\":200,\"durationMs\":18}', '2026-08-25 20:27:24'),
(54, 1, 'GET /api/participants/3', 'request', NULL, '{\"status\":200,\"durationMs\":12}', '2026-08-25 20:27:24'),
(55, NULL, 'GET /api/dashboard', 'request', NULL, '{\"status\":401,\"durationMs\":7}', '2026-08-25 20:28:35'),
(56, NULL, 'GET /api/dashboard', 'request', NULL, '{\"status\":401,\"durationMs\":5}', '2026-08-25 20:28:35'),
(57, NULL, 'GET /api/dashboard', 'request', NULL, '{\"status\":401,\"durationMs\":5}', '2026-08-25 20:28:52'),
(58, NULL, 'GET /api/dashboard', 'request', NULL, '{\"status\":401,\"durationMs\":6}', '2026-08-25 20:28:52'),
(59, NULL, 'GET /api/participants', 'request', NULL, '{\"status\":401,\"durationMs\":2}', '2026-08-25 20:28:57'),
(60, NULL, 'GET /api/participants', 'request', NULL, '{\"status\":401,\"durationMs\":2}', '2026-08-25 20:28:57'),
(61, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":356}', '2026-08-25 20:29:02'),
(62, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-08-25 20:29:02'),
(63, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":4}', '2026-08-25 20:29:02'),
(64, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":2}', '2026-08-25 20:29:10'),
(65, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":5}', '2026-08-25 20:29:10'),
(66, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-25 20:29:14'),
(67, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":30}', '2026-08-25 20:30:51'),
(68, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":652}', '2026-08-25 20:31:17'),
(69, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":9}', '2026-08-25 20:31:26'),
(70, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":7}', '2026-08-25 20:31:26'),
(71, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":304,\"durationMs\":10}', '2026-08-25 20:31:29'),
(72, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":304,\"durationMs\":7}', '2026-08-25 20:31:30'),
(73, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":304,\"durationMs\":9}', '2026-08-25 20:31:34'),
(74, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":6}', '2026-08-25 20:31:39'),
(75, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":7}', '2026-08-25 20:31:39'),
(76, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":304,\"durationMs\":8}', '2026-08-25 20:31:40'),
(77, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":395}', '2026-08-25 20:32:05'),
(78, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":8}', '2026-08-25 20:32:05'),
(79, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":43}', '2026-08-25 20:32:05'),
(80, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":2}', '2026-08-25 20:32:07'),
(81, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":4}', '2026-08-25 20:32:07'),
(82, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":304,\"durationMs\":4}', '2026-08-25 20:32:09'),
(83, 1, 'GET /api/participants/3', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-08-25 20:32:11'),
(84, 1, 'GET /api/participants/2', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-08-25 20:32:12'),
(85, 1, 'GET /api/participants/1', 'request', NULL, '{\"status\":200,\"durationMs\":2}', '2026-08-25 20:32:12'),
(86, 1, 'GET /api/participants/2', 'request', NULL, '{\"status\":304,\"durationMs\":3}', '2026-08-25 20:32:13'),
(87, 1, 'GET /api/participants/3', 'request', NULL, '{\"status\":304,\"durationMs\":7}', '2026-08-25 20:32:14'),
(88, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":304,\"durationMs\":7}', '2026-08-25 20:32:15'),
(89, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":304,\"durationMs\":4}', '2026-08-25 20:32:16'),
(90, 1, 'GET /api/participants/3', 'request', NULL, '{\"status\":304,\"durationMs\":3}', '2026-08-25 20:32:18'),
(91, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":4}', '2026-08-25 20:32:22'),
(92, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":5}', '2026-08-25 20:32:22'),
(93, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":304,\"durationMs\":5}', '2026-08-25 20:32:23'),
(94, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":304,\"durationMs\":4}', '2026-08-25 20:32:28'),
(95, 1, 'PUT /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":23}', '2026-08-25 20:32:31'),
(96, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":3}', '2026-08-25 20:32:31'),
(97, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":304,\"durationMs\":3}', '2026-08-25 20:32:38'),
(98, 1, 'GET /api/participants/3', 'request', NULL, '{\"status\":304,\"durationMs\":2}', '2026-08-25 20:32:41'),
(99, 1, 'GET /api/participants/2', 'request', NULL, '{\"status\":304,\"durationMs\":3}', '2026-08-25 20:32:44'),
(100, 1, 'GET /api/participants/1', 'request', NULL, '{\"status\":304,\"durationMs\":3}', '2026-08-25 20:32:45'),
(101, 1, 'GET /api/participants/2', 'request', NULL, '{\"status\":304,\"durationMs\":3}', '2026-08-25 20:32:45'),
(102, 1, 'GET /api/participants/3', 'request', NULL, '{\"status\":304,\"durationMs\":3}', '2026-08-25 20:32:46'),
(103, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":304,\"durationMs\":2}', '2026-08-25 20:32:47'),
(104, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-08-25 20:32:47'),
(105, 1, 'PUT /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":23}', '2026-08-25 20:33:25'),
(106, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":4}', '2026-08-25 20:33:25'),
(107, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-08-25 20:33:28'),
(108, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":398}', '2026-08-25 20:33:45'),
(109, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":5}', '2026-08-25 20:33:45'),
(110, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":11}', '2026-08-25 20:33:45'),
(111, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":2}', '2026-08-25 20:33:46'),
(112, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":2}', '2026-08-25 20:33:46'),
(113, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":304,\"durationMs\":7}', '2026-08-25 20:33:53'),
(114, 1, 'PUT /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":28}', '2026-08-25 20:34:18'),
(115, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":19}', '2026-08-25 20:34:18'),
(116, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":304,\"durationMs\":5}', '2026-08-25 20:34:28'),
(117, 1, 'GET /api/risk-scores', 'request', NULL, '{\"status\":304,\"durationMs\":5}', '2026-08-25 20:34:38'),
(118, 1, 'GET /api/risk-scores', 'request', NULL, '{\"status\":304,\"durationMs\":3}', '2026-08-25 20:34:38'),
(119, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":7}', '2026-08-25 20:34:43'),
(120, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":31}', '2026-08-25 20:34:43'),
(121, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-25 20:34:45'),
(122, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":5}', '2026-08-25 20:39:22'),
(123, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":304,\"durationMs\":4}', '2026-08-25 20:40:50'),
(124, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":304,\"durationMs\":13}', '2026-08-25 20:40:52'),
(125, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":304,\"durationMs\":4}', '2026-08-25 20:40:55'),
(126, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":412}', '2026-08-25 20:40:59'),
(127, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":2}', '2026-08-25 20:40:59'),
(128, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":3}', '2026-08-25 20:40:59'),
(129, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":304,\"durationMs\":3}', '2026-08-25 20:41:02'),
(130, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":304,\"durationMs\":4}', '2026-08-25 20:41:04'),
(131, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":304,\"durationMs\":4}', '2026-08-25 20:41:13'),
(132, 1, 'PUT /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":96}', '2026-08-25 20:41:29'),
(133, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":2}', '2026-08-25 20:41:29'),
(134, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":304,\"durationMs\":41}', '2026-08-25 20:41:31'),
(135, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":15}', '2026-08-25 20:41:31'),
(136, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":1536}', '2026-08-25 20:42:50'),
(137, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":50}', '2026-08-25 20:42:50'),
(138, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":758}', '2026-08-25 20:45:00'),
(139, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":200,\"durationMs\":39}', '2026-08-25 20:45:00'),
(140, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":662}', '2026-08-25 20:45:53'),
(141, 1, 'GET /api/participants/1', 'request', NULL, '{\"status\":200,\"durationMs\":273}', '2026-08-25 20:45:54'),
(142, 1, 'GET /api/participants/2', 'request', NULL, '{\"status\":200,\"durationMs\":65}', '2026-08-25 20:45:54'),
(143, 1, 'GET /api/participants/3', 'request', NULL, '{\"status\":200,\"durationMs\":153}', '2026-08-25 20:45:54'),
(144, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":26}', '2026-08-25 20:45:54'),
(145, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":38}', '2026-08-25 20:46:59'),
(146, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":19}', '2026-08-25 20:46:59'),
(147, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-08-25 20:47:01'),
(148, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":6}', '2026-08-25 20:47:01'),
(149, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":8}', '2026-08-25 20:47:02'),
(150, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-08-25 20:47:03'),
(151, 1, 'GET /api/participants/3', 'request', NULL, '{\"status\":200,\"durationMs\":7}', '2026-08-25 20:47:04'),
(152, 1, 'GET /api/participants/2', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-25 20:47:05'),
(153, 1, 'GET /api/participants/1', 'request', NULL, '{\"status\":200,\"durationMs\":7}', '2026-08-25 20:47:07'),
(154, 1, 'GET /api/participants/2', 'request', NULL, '{\"status\":304,\"durationMs\":5}', '2026-08-25 20:47:08'),
(155, 1, 'GET /api/participants/1', 'request', NULL, '{\"status\":304,\"durationMs\":9}', '2026-08-25 20:47:15'),
(156, 1, 'PUT /api/participants/1', 'request', NULL, '{\"status\":200,\"durationMs\":33}', '2026-08-25 20:48:01'),
(157, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":9}', '2026-08-25 20:48:01'),
(158, 1, 'GET /api/participants/2', 'request', NULL, '{\"status\":304,\"durationMs\":13}', '2026-08-25 20:48:04'),
(159, 1, 'GET /api/participants/1', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-08-25 20:48:05'),
(160, 1, 'GET /api/participants/2', 'request', NULL, '{\"status\":304,\"durationMs\":4}', '2026-08-25 20:48:09'),
(161, 1, 'PUT /api/participants/2', 'request', NULL, '{\"status\":200,\"durationMs\":23}', '2026-08-25 20:49:00'),
(162, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":8}', '2026-08-25 20:49:01'),
(163, 1, 'GET /api/participants/1', 'request', NULL, '{\"status\":304,\"durationMs\":5}', '2026-08-25 20:49:02'),
(164, 1, 'PUT /api/participants/1', 'request', NULL, '{\"status\":200,\"durationMs\":32}', '2026-08-25 20:49:13'),
(165, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":5}', '2026-08-25 20:49:13'),
(166, 1, 'GET /api/participants/2', 'request', NULL, '{\"status\":200,\"durationMs\":97}', '2026-08-25 20:49:14'),
(167, 1, 'GET /api/participants/3', 'request', NULL, '{\"status\":304,\"durationMs\":7}', '2026-08-25 20:49:15'),
(168, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":304,\"durationMs\":44}', '2026-08-25 20:49:16'),
(169, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":304,\"durationMs\":25}', '2026-08-25 20:49:18'),
(170, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":304,\"durationMs\":4}', '2026-08-25 20:49:20'),
(171, 1, 'GET /api/participants/3', 'request', NULL, '{\"status\":304,\"durationMs\":5}', '2026-08-25 20:49:21'),
(172, 1, 'PUT /api/participants/3', 'request', NULL, '{\"status\":200,\"durationMs\":23}', '2026-08-25 20:50:15'),
(173, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-08-25 20:50:15'),
(174, 1, 'GET /api/participants/2', 'request', NULL, '{\"status\":304,\"durationMs\":4}', '2026-08-25 20:50:18'),
(175, 1, 'GET /api/participants/1', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-25 20:50:21'),
(176, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":304,\"durationMs\":21}', '2026-08-25 20:50:25'),
(177, 1, 'PUT /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":38}', '2026-08-25 20:50:47'),
(178, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":2}', '2026-08-25 20:50:47'),
(179, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":304,\"durationMs\":4}', '2026-08-25 20:50:52'),
(180, 1, 'PUT /api/participants/4', 'request', NULL, '{\"status\":200,\"durationMs\":40}', '2026-08-25 20:52:07'),
(181, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":8}', '2026-08-25 20:52:07'),
(182, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-25 20:52:10'),
(183, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-25 20:52:10'),
(184, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":304,\"durationMs\":4}', '2026-08-25 20:52:16'),
(185, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":304,\"durationMs\":7}', '2026-08-25 20:52:22'),
(186, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":304,\"durationMs\":5}', '2026-08-25 20:52:23'),
(187, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":304,\"durationMs\":6}', '2026-08-25 20:52:26'),
(188, 1, 'GET /api/participants/3', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-25 20:52:27'),
(189, 1, 'GET /api/participants/2', 'request', NULL, '{\"status\":304,\"durationMs\":4}', '2026-08-25 20:52:28'),
(190, 1, 'GET /api/participants/1', 'request', NULL, '{\"status\":304,\"durationMs\":3}', '2026-08-25 20:52:28'),
(191, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":304,\"durationMs\":4}', '2026-08-25 20:52:36'),
(192, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":6}', '2026-08-25 20:53:10'),
(193, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":6}', '2026-08-25 20:53:10'),
(194, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":304,\"durationMs\":4}', '2026-08-25 20:53:12'),
(195, 1, 'PUT /api/participants/4', 'request', NULL, '{\"status\":200,\"durationMs\":28}', '2026-08-25 20:53:33'),
(196, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":29}', '2026-08-25 20:53:33'),
(197, 1, 'GET /api/participants/3', 'request', NULL, '{\"status\":304,\"durationMs\":5}', '2026-08-25 20:53:38'),
(198, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-25 20:53:38'),
(199, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":30}', '2026-08-25 20:54:06'),
(200, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":36}', '2026-08-25 20:54:06'),
(201, 1, 'GET /api/risk-scores', 'request', NULL, '{\"status\":304,\"durationMs\":8}', '2026-08-25 20:54:19'),
(202, 1, 'GET /api/risk-scores', 'request', NULL, '{\"status\":304,\"durationMs\":11}', '2026-08-25 20:54:19'),
(203, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":16}', '2026-08-25 20:54:28'),
(204, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":17}', '2026-08-25 20:54:28'),
(205, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":2}', '2026-08-25 20:55:28'),
(206, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":2}', '2026-08-25 20:55:28'),
(207, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":6}', '2026-08-25 20:55:29'),
(208, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":6}', '2026-08-25 20:55:29'),
(209, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":6}', '2026-08-25 20:55:32'),
(210, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":5}', '2026-08-25 20:55:32'),
(211, NULL, 'GET /api/participants', 'request', NULL, '{\"status\":401,\"durationMs\":2}', '2026-08-25 20:55:59'),
(212, NULL, 'GET /api/participants', 'request', NULL, '{\"status\":401,\"durationMs\":2}', '2026-08-25 20:55:59'),
(213, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":327}', '2026-08-25 20:56:06'),
(214, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":2}', '2026-08-25 20:56:06'),
(215, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":3}', '2026-08-25 20:56:06'),
(216, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":12}', '2026-08-25 20:59:15'),
(217, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":9}', '2026-08-25 20:59:15'),
(218, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":5}', '2026-08-25 21:00:20'),
(219, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":6}', '2026-08-25 21:00:20'),
(220, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":304,\"durationMs\":5}', '2026-08-25 21:00:24'),
(221, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":75}', '2026-08-25 21:02:27'),
(222, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":14}', '2026-08-25 21:02:27'),
(223, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":14}', '2026-08-25 21:02:30'),
(224, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":3}', '2026-08-25 21:02:30'),
(225, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":304,\"durationMs\":9}', '2026-08-25 21:02:32'),
(226, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":4}', '2026-08-25 21:04:16'),
(227, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":275}', '2026-08-25 21:04:17'),
(228, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":304,\"durationMs\":5}', '2026-08-25 21:04:18'),
(229, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":536}', '2026-08-25 21:08:40'),
(230, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":200,\"durationMs\":10}', '2026-08-25 21:08:41'),
(231, NULL, 'POST /api/portal/profile', 'request', NULL, '{\"status\":404,\"durationMs\":3}', '2026-08-25 21:08:41'),
(232, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":514}', '2026-08-25 21:09:03'),
(233, NULL, 'POST /api/portal/profile', 'request', NULL, '{\"status\":404,\"durationMs\":1}', '2026-08-25 21:09:03'),
(234, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":668}', '2026-08-25 21:09:42'),
(235, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":200,\"durationMs\":705}', '2026-08-25 21:09:42'),
(236, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":427}', '2026-08-25 21:11:31'),
(237, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":18}', '2026-08-25 21:11:31'),
(238, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":24}', '2026-08-25 21:11:31'),
(239, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":200,\"durationMs\":350}', '2026-08-25 21:15:07'),
(240, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":200,\"durationMs\":383}', '2026-08-25 21:18:21'),
(241, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":16}', '2026-08-25 21:18:56'),
(242, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":9}', '2026-08-25 21:18:57'),
(243, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":304,\"durationMs\":12}', '2026-08-25 21:18:58'),
(244, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":304,\"durationMs\":4}', '2026-08-25 21:19:01'),
(245, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":896}', '2026-08-25 21:24:35'),
(246, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":200,\"durationMs\":54}', '2026-08-25 21:24:35'),
(247, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":115}', '2026-08-25 21:26:12'),
(248, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":17}', '2026-08-25 21:26:12'),
(249, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":6}', '2026-08-25 21:26:14'),
(250, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":5}', '2026-08-25 21:26:14'),
(251, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":16}', '2026-08-25 21:26:15'),
(252, NULL, 'PUT /api/participants/5', 'request', NULL, '{\"status\":401,\"durationMs\":4}', '2026-08-25 21:26:36'),
(253, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":392}', '2026-08-25 21:26:43'),
(254, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":10}', '2026-08-25 21:26:43'),
(255, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":19}', '2026-08-25 21:26:43'),
(256, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":3}', '2026-08-25 21:26:45'),
(257, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":5}', '2026-08-25 21:26:45'),
(258, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":8}', '2026-08-25 21:26:46'),
(259, 1, 'PUT /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":30}', '2026-08-25 21:26:54'),
(260, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":9}', '2026-08-25 21:26:54'),
(261, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-25 21:26:57'),
(262, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-25 21:26:57'),
(263, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":304,\"durationMs\":6}', '2026-08-25 21:27:00'),
(264, 1, 'GET /api/participants/3', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-25 21:27:06'),
(265, 1, 'GET /api/participants/2', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-25 21:27:11'),
(266, 1, 'GET /api/participants/1', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-25 21:27:15'),
(267, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":304,\"durationMs\":5}', '2026-08-25 21:27:18'),
(268, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":304,\"durationMs\":6}', '2026-08-25 21:27:19'),
(269, 1, 'GET /api/participants/3', 'request', NULL, '{\"status\":304,\"durationMs\":6}', '2026-08-25 21:27:20'),
(270, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":304,\"durationMs\":6}', '2026-08-25 21:27:20'),
(271, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":304,\"durationMs\":5}', '2026-08-25 21:27:21'),
(272, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":304,\"durationMs\":4}', '2026-08-25 21:27:22'),
(273, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":304,\"durationMs\":5}', '2026-08-25 21:27:22'),
(274, 1, 'GET /api/participants/3', 'request', NULL, '{\"status\":304,\"durationMs\":5}', '2026-08-25 21:27:23'),
(275, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":304,\"durationMs\":5}', '2026-08-25 21:27:25'),
(276, 1, 'GET /api/participants/1', 'request', NULL, '{\"status\":304,\"durationMs\":4}', '2026-08-25 21:27:37'),
(277, 1, 'PUT /api/participants/1', 'request', NULL, '{\"status\":200,\"durationMs\":20}', '2026-08-25 21:27:44'),
(278, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":8}', '2026-08-25 21:27:44'),
(279, 1, 'GET /api/participants/2', 'request', NULL, '{\"status\":304,\"durationMs\":4}', '2026-08-25 21:27:45'),
(280, 1, 'PUT /api/participants/2', 'request', NULL, '{\"status\":200,\"durationMs\":24}', '2026-08-25 21:27:52'),
(281, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-08-25 21:27:52'),
(282, 1, 'GET /api/participants/3', 'request', NULL, '{\"status\":304,\"durationMs\":4}', '2026-08-25 21:27:54'),
(283, 1, 'PUT /api/participants/3', 'request', NULL, '{\"status\":200,\"durationMs\":27}', '2026-08-25 21:28:00'),
(284, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":8}', '2026-08-25 21:28:00'),
(285, 1, 'GET /api/participants/2', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-25 21:28:01'),
(286, 1, 'GET /api/participants/3', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-25 21:28:02'),
(287, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":304,\"durationMs\":5}', '2026-08-25 21:28:14'),
(288, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":304,\"durationMs\":4}', '2026-08-25 21:28:15'),
(289, 1, 'GET /api/risk-scores', 'request', NULL, '{\"status\":304,\"durationMs\":10}', '2026-08-25 21:28:21'),
(290, 1, 'GET /api/risk-scores', 'request', NULL, '{\"status\":304,\"durationMs\":11}', '2026-08-25 21:28:22'),
(291, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":16}', '2026-08-25 21:28:22'),
(292, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":26}', '2026-08-25 21:28:22'),
(293, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":973}', '2026-08-25 21:32:27'),
(294, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":200,\"durationMs\":86}', '2026-08-25 21:32:27'),
(295, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":403,\"durationMs\":942}', '2026-08-25 21:32:28'),
(296, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":58}', '2026-08-25 21:33:01'),
(297, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":64}', '2026-08-25 21:33:01'),
(298, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":359}', '2026-08-25 21:33:05'),
(299, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":7}', '2026-08-25 21:33:05'),
(300, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":15}', '2026-08-25 21:33:05'),
(301, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":200,\"durationMs\":13}', '2026-08-25 21:33:55'),
(302, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":30}', '2026-08-25 21:34:20'),
(303, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":14}', '2026-08-25 21:34:20'),
(304, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":200,\"durationMs\":13}', '2026-08-25 21:34:25'),
(305, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":403,\"durationMs\":590}', '2026-08-25 21:34:41'),
(306, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":70}', '2026-08-25 21:36:30'),
(307, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":39}', '2026-08-25 21:36:30'),
(308, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":403,\"durationMs\":1630}', '2026-08-25 21:36:37'),
(309, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":200,\"durationMs\":470}', '2026-08-25 21:36:47'),
(310, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":19}', '2026-08-25 21:39:22'),
(311, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":9}', '2026-08-25 21:39:22'),
(312, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":403,\"durationMs\":537}', '2026-08-25 21:39:32'),
(313, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":200,\"durationMs\":392}', '2026-08-25 21:39:40'),
(314, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":114}', '2026-08-25 21:42:20'),
(315, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":38}', '2026-08-25 21:42:20'),
(316, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":403,\"durationMs\":612}', '2026-08-25 21:42:46'),
(317, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":200,\"durationMs\":358}', '2026-08-25 21:42:52'),
(318, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":9}', '2026-08-25 21:43:29'),
(319, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":5}', '2026-08-25 21:43:29'),
(320, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":304,\"durationMs\":7}', '2026-08-25 21:43:31'),
(321, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":304,\"durationMs\":5}', '2026-08-25 21:43:32'),
(322, 1, 'GET /api/participants/3', 'request', NULL, '{\"status\":304,\"durationMs\":4}', '2026-08-25 21:43:32'),
(323, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":304,\"durationMs\":4}', '2026-08-25 21:43:34'),
(324, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":304,\"durationMs\":5}', '2026-08-25 21:43:39'),
(325, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":304,\"durationMs\":6}', '2026-08-25 21:44:12'),
(326, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":304,\"durationMs\":6}', '2026-08-25 21:44:19'),
(327, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":304,\"durationMs\":5}', '2026-08-25 21:44:22'),
(328, 1, 'PUT /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":22}', '2026-08-25 21:44:33'),
(329, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":6}', '2026-08-25 21:44:33'),
(330, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":304,\"durationMs\":7}', '2026-08-25 21:44:34'),
(331, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-25 21:44:35'),
(332, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":304,\"durationMs\":5}', '2026-08-25 21:44:43'),
(333, 1, 'GET /api/participants/3', 'request', NULL, '{\"status\":304,\"durationMs\":42}', '2026-08-25 21:44:44'),
(334, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":304,\"durationMs\":6}', '2026-08-25 21:44:45'),
(335, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":304,\"durationMs\":4}', '2026-08-25 21:44:45'),
(336, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":304,\"durationMs\":6}', '2026-08-25 21:44:46'),
(337, 1, 'GET /api/participants/3', 'request', NULL, '{\"status\":304,\"durationMs\":5}', '2026-08-25 21:44:46'),
(338, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":304,\"durationMs\":5}', '2026-08-25 21:44:47'),
(339, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":304,\"durationMs\":6}', '2026-08-25 21:44:48'),
(340, 1, 'GET /api/participants/2', 'request', NULL, '{\"status\":304,\"durationMs\":4}', '2026-08-25 21:44:50'),
(341, 1, 'GET /api/participants/1', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-08-25 21:44:52'),
(342, 1, 'GET /api/participants/2', 'request', NULL, '{\"status\":304,\"durationMs\":4}', '2026-08-25 21:44:53'),
(343, 1, 'GET /api/risk-scores', 'request', NULL, '{\"status\":304,\"durationMs\":12}', '2026-08-25 21:45:01'),
(344, 1, 'GET /api/risk-scores', 'request', NULL, '{\"status\":304,\"durationMs\":30}', '2026-08-25 21:45:01'),
(345, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":49}', '2026-08-25 21:45:20'),
(346, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":127}', '2026-08-25 21:45:20'),
(347, NULL, 'GET /api/dashboard', 'request', NULL, '{\"status\":401,\"durationMs\":2}', '2026-08-25 21:54:26'),
(348, NULL, 'GET /api/dashboard', 'request', NULL, '{\"status\":401,\"durationMs\":1}', '2026-08-25 21:54:26'),
(349, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":379}', '2026-08-25 21:57:19'),
(350, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":5}', '2026-08-25 21:57:19'),
(351, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":10}', '2026-08-25 21:57:19'),
(352, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":36}', '2026-08-25 21:59:37'),
(353, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":13}', '2026-08-25 21:59:38'),
(354, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":352}', '2026-08-25 21:59:49'),
(355, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":5}', '2026-08-25 21:59:49'),
(356, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":5}', '2026-08-25 21:59:49'),
(357, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":4}', '2026-08-25 21:59:52'),
(358, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":3}', '2026-08-25 21:59:52'),
(359, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":304,\"durationMs\":9}', '2026-08-25 21:59:55'),
(360, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":304,\"durationMs\":3}', '2026-08-25 21:59:57'),
(361, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":304,\"durationMs\":5}', '2026-08-25 21:59:58'),
(362, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":304,\"durationMs\":9}', '2026-08-25 21:59:58'),
(363, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":4}', '2026-08-25 22:01:12'),
(364, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":9}', '2026-08-25 22:01:12'),
(365, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":9}', '2026-08-25 22:01:13'),
(366, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":25}', '2026-08-25 22:01:13'),
(367, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":12}', '2026-08-25 22:01:17'),
(368, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":10}', '2026-08-25 22:01:17'),
(369, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":463}', '2026-08-25 22:07:37'),
(370, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":39}', '2026-08-25 22:07:37'),
(371, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":12}', '2026-08-25 22:07:37'),
(372, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":8}', '2026-08-25 22:07:39'),
(373, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":4}', '2026-08-25 22:07:39'),
(374, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":3}', '2026-08-25 22:07:40'),
(375, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":8}', '2026-08-25 22:07:40'),
(376, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":7}', '2026-08-25 22:07:41'),
(377, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":10}', '2026-08-25 22:07:41'),
(378, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":470}', '2026-08-25 22:08:02'),
(379, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":19}', '2026-08-25 22:08:02'),
(380, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":13}', '2026-08-25 22:08:02'),
(381, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":2}', '2026-08-25 22:08:22'),
(382, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":7}', '2026-08-25 22:08:22'),
(383, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":17}', '2026-08-25 22:09:49'),
(384, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":9}', '2026-08-25 22:09:49'),
(385, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":3}', '2026-08-25 22:09:53'),
(386, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":4}', '2026-08-25 22:09:53'),
(387, 1, 'GET /api/risk-scores', 'request', NULL, '{\"status\":304,\"durationMs\":9}', '2026-08-25 22:09:58'),
(388, 1, 'GET /api/risk-scores', 'request', NULL, '{\"status\":304,\"durationMs\":6}', '2026-08-25 22:09:58'),
(389, 1, 'GET /api/risk-scores', 'request', NULL, '{\"status\":304,\"durationMs\":8}', '2026-08-25 22:09:59'),
(390, 1, 'GET /api/risk-scores', 'request', NULL, '{\"status\":304,\"durationMs\":13}', '2026-08-25 22:09:59'),
(391, 1, 'GET /api/risk-scores', 'request', NULL, '{\"status\":304,\"durationMs\":5}', '2026-08-25 22:10:05'),
(392, 1, 'GET /api/risk-scores', 'request', NULL, '{\"status\":304,\"durationMs\":4}', '2026-08-25 22:10:05'),
(393, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":8}', '2026-08-25 22:10:08'),
(394, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":9}', '2026-08-25 22:10:08'),
(395, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":19}', '2026-08-25 22:12:43'),
(396, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":13}', '2026-08-25 22:12:43'),
(397, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":41}', '2026-08-25 22:17:14'),
(398, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":17}', '2026-08-25 22:17:14'),
(399, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":306}', '2026-08-25 22:19:10'),
(400, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-08-25 22:19:10'),
(401, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":7}', '2026-08-25 22:19:10'),
(402, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":13}', '2026-08-25 22:20:03'),
(403, 1, 'GET /api/participants', 'request', NULL, '{\"status\":304,\"durationMs\":6}', '2026-08-25 22:20:03'),
(404, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":14}', '2026-08-25 22:20:06'),
(405, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":356}', '2026-08-25 22:57:27'),
(406, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":35}', '2026-08-25 22:57:27'),
(407, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":13}', '2026-08-25 22:57:27'),
(408, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":582}', '2026-08-25 22:57:48'),
(409, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":49}', '2026-08-25 22:57:48'),
(410, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":9}', '2026-08-25 22:57:48'),
(411, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":10}', '2026-08-25 22:57:53'),
(412, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-08-25 22:57:53'),
(413, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":11}', '2026-08-25 22:57:54'),
(414, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":403,\"durationMs\":338}', '2026-08-25 22:58:01'),
(415, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":403,\"durationMs\":319}', '2026-08-25 22:58:02'),
(416, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":403,\"durationMs\":326}', '2026-08-25 22:58:02'),
(417, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":403,\"durationMs\":307}', '2026-08-25 22:58:03'),
(418, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":403,\"durationMs\":319}', '2026-08-25 22:58:04'),
(419, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":403,\"durationMs\":357}', '2026-08-25 22:58:04'),
(420, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-25 22:58:17'),
(421, 1, 'GET /api/participants/3', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-25 22:58:26'),
(422, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":200,\"durationMs\":7}', '2026-08-25 22:58:28'),
(423, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-25 22:58:48'),
(424, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-08-25 22:58:55'),
(425, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-08-25 22:58:55'),
(426, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":9}', '2026-08-25 22:58:56'),
(427, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":7}', '2026-08-25 22:58:56'),
(428, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-08-25 22:58:56'),
(429, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-08-25 22:58:56'),
(430, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-25 22:59:05'),
(431, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":2}', '2026-08-25 22:59:05'),
(432, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-08-25 23:00:09'),
(433, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-08-25 23:00:09'),
(434, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-25 23:00:10'),
(435, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":184}', '2026-08-25 23:00:37'),
(436, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":109}', '2026-08-25 23:00:37'),
(437, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":14}', '2026-08-25 23:00:40'),
(438, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":10}', '2026-08-25 23:00:40'),
(439, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":348}', '2026-08-25 23:10:13'),
(440, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":22}', '2026-08-25 23:10:14'),
(441, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":11}', '2026-08-25 23:10:14'),
(442, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":9}', '2026-08-25 23:10:20'),
(443, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-08-25 23:10:20'),
(444, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-08-25 23:10:22'),
(445, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":8}', '2026-08-25 23:10:22'),
(446, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":10}', '2026-08-25 23:10:23'),
(447, 1, 'GET /api/participants/1', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-08-25 23:10:41'),
(448, 1, 'GET /api/participants/2', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-25 23:10:45'),
(449, 1, 'GET /api/participants/3', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-25 23:10:45'),
(450, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-25 23:10:46');
INSERT INTO `system_logs` (`id`, `user_id`, `action`, `entity_type`, `entity_id`, `details`, `created_at`) VALUES
(451, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-25 23:10:47'),
(452, 1, 'PUT /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":403}', '2026-08-25 23:10:55'),
(453, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-08-25 23:10:55'),
(454, 1, 'GET /api/participants/3', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-08-25 23:11:02'),
(455, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-25 23:11:02'),
(456, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-25 23:11:06'),
(457, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-25 23:11:07'),
(458, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":403,\"durationMs\":306}', '2026-08-25 23:11:24'),
(459, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":403,\"durationMs\":329}', '2026-08-25 23:11:24'),
(460, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":403,\"durationMs\":315}', '2026-08-25 23:11:24'),
(461, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":403,\"durationMs\":318}', '2026-08-25 23:11:25'),
(462, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":403,\"durationMs\":310}', '2026-08-25 23:11:25'),
(463, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":403,\"durationMs\":302}', '2026-08-25 23:11:26'),
(464, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":403,\"durationMs\":302}', '2026-08-25 23:11:26'),
(465, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":403,\"durationMs\":322}', '2026-08-25 23:11:27'),
(466, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":403,\"durationMs\":319}', '2026-08-25 23:11:27'),
(467, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":403,\"durationMs\":302}', '2026-08-25 23:11:28'),
(468, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":403,\"durationMs\":320}', '2026-08-25 23:11:28'),
(469, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":403,\"durationMs\":315}', '2026-08-25 23:11:29'),
(470, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":403,\"durationMs\":302}', '2026-08-25 23:11:29'),
(471, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":200,\"durationMs\":318}', '2026-08-25 23:11:37'),
(472, NULL, 'GET /api/dashboard', 'request', NULL, '{\"status\":401,\"durationMs\":2}', '2026-08-25 23:18:48'),
(473, NULL, 'GET /api/dashboard', 'request', NULL, '{\"status\":401,\"durationMs\":1}', '2026-08-25 23:18:48'),
(474, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":309}', '2026-08-25 23:18:59'),
(475, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-25 23:18:59'),
(476, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-25 23:18:59'),
(477, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":8}', '2026-08-25 23:19:34'),
(478, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":11}', '2026-08-25 23:19:34'),
(479, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-08-25 23:19:38'),
(480, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-25 23:19:38'),
(481, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-25 23:19:40'),
(482, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":200,\"durationMs\":10}', '2026-08-25 23:19:50'),
(483, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-25 23:20:12'),
(484, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-25 23:20:12'),
(485, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-25 23:20:18'),
(486, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-08-25 23:20:18'),
(487, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":403,\"durationMs\":323}', '2026-08-25 23:20:31'),
(488, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":403,\"durationMs\":316}', '2026-08-25 23:20:32'),
(489, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":403,\"durationMs\":312}', '2026-08-25 23:20:33'),
(490, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":403,\"durationMs\":308}', '2026-08-25 23:20:33'),
(491, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":403,\"durationMs\":304}', '2026-08-25 23:20:34'),
(492, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":403,\"durationMs\":306}', '2026-08-25 23:20:34'),
(493, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":403,\"durationMs\":311}', '2026-08-25 23:20:35'),
(494, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":200,\"durationMs\":320}', '2026-08-25 23:20:40'),
(495, NULL, 'GET /api/participants/1', 'request', NULL, '{\"status\":401,\"durationMs\":1}', '2026-08-25 23:27:08'),
(496, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":316}', '2026-08-25 23:27:17'),
(497, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-08-25 23:27:17'),
(498, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":2}', '2026-08-25 23:27:17'),
(499, 1, 'GET /api/participants/1', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-25 23:27:20'),
(500, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":500,\"durationMs\":17}', '2026-08-25 23:27:35'),
(501, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":2}', '2026-08-25 23:27:52'),
(502, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-08-25 23:27:52'),
(503, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":7}', '2026-08-25 23:27:53'),
(504, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-25 23:27:53'),
(505, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":11}', '2026-08-25 23:32:47'),
(506, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-08-25 23:32:47'),
(507, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":64}', '2026-08-25 23:32:56'),
(508, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-25 23:32:56'),
(509, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":333}', '2026-08-25 23:33:16'),
(510, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-25 23:33:16'),
(511, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-25 23:33:16'),
(512, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":74}', '2026-08-25 23:34:26'),
(513, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":7}', '2026-08-25 23:34:26'),
(514, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":481}', '2026-08-25 23:35:00'),
(515, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":8}', '2026-08-25 23:35:00'),
(516, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-08-25 23:35:00'),
(517, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":8}', '2026-08-25 23:35:03'),
(518, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":13}', '2026-08-25 23:35:03'),
(519, 1, 'GET /api/participants/1', 'request', NULL, '{\"status\":200,\"durationMs\":9}', '2026-08-25 23:35:05'),
(520, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":500,\"durationMs\":7}', '2026-08-25 23:35:10'),
(521, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":500,\"durationMs\":6}', '2026-08-25 23:35:12'),
(522, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":500,\"durationMs\":5}', '2026-08-25 23:35:19'),
(523, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":8}', '2026-08-25 23:35:22'),
(524, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":7}', '2026-08-25 23:35:23'),
(525, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":27}', '2026-08-25 23:35:25'),
(526, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-08-25 23:35:25'),
(527, 1, 'GET /api/participants/2', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-25 23:35:37'),
(528, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":500,\"durationMs\":19}', '2026-08-25 23:35:39'),
(529, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":500,\"durationMs\":3}', '2026-08-25 23:35:44'),
(530, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":8}', '2026-08-25 23:35:56'),
(531, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":7}', '2026-08-25 23:35:56'),
(532, 1, 'GET /api/participants/1', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-25 23:36:02'),
(533, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":500,\"durationMs\":3}', '2026-08-25 23:36:04'),
(534, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":500,\"durationMs\":3}', '2026-08-25 23:36:12'),
(535, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":63}', '2026-08-25 23:41:32'),
(536, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":16}', '2026-08-25 23:41:32'),
(537, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-25 23:41:33'),
(538, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-08-25 23:41:33'),
(539, 1, 'GET /api/participants/1', 'request', NULL, '{\"status\":200,\"durationMs\":11}', '2026-08-25 23:41:36'),
(540, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-08-25 23:41:42'),
(541, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":8}', '2026-08-25 23:41:42'),
(542, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-08-25 23:41:49'),
(543, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":10}', '2026-08-25 23:41:49'),
(544, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":9}', '2026-08-25 23:41:52'),
(545, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":7}', '2026-08-25 23:41:52'),
(546, 1, 'GET /api/participants/1', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-25 23:41:59'),
(547, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":500,\"durationMs\":6}', '2026-08-25 23:42:01'),
(548, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":7}', '2026-08-25 23:42:06'),
(549, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":15}', '2026-08-25 23:42:06'),
(550, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-08-25 23:42:09'),
(551, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-25 23:42:09'),
(552, 1, 'GET /api/participants/2', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-25 23:42:10'),
(553, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":500,\"durationMs\":4}', '2026-08-25 23:42:12'),
(554, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":500,\"durationMs\":3}', '2026-08-25 23:42:13'),
(555, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":500,\"durationMs\":4}', '2026-08-25 23:42:15'),
(556, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":500,\"durationMs\":4}', '2026-08-25 23:42:17'),
(557, 1, 'GET /api/participants/3', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-25 23:42:21'),
(558, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":500,\"durationMs\":2}', '2026-08-25 23:42:22'),
(559, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":500,\"durationMs\":30}', '2026-08-25 23:42:23'),
(560, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":500,\"durationMs\":3}', '2026-08-25 23:42:25'),
(561, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":500,\"durationMs\":4}', '2026-08-25 23:42:27'),
(562, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":500,\"durationMs\":3}', '2026-08-25 23:42:27'),
(563, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":500,\"durationMs\":3}', '2026-08-25 23:42:29'),
(564, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-25 23:42:32'),
(565, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":200,\"durationMs\":31}', '2026-08-25 23:42:33'),
(566, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":200,\"durationMs\":18}', '2026-08-25 23:42:35'),
(567, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-25 23:42:37'),
(568, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":200,\"durationMs\":20}', '2026-08-25 23:42:40'),
(569, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":200,\"durationMs\":16}', '2026-08-25 23:42:42'),
(570, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-25 23:42:43'),
(571, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":16}', '2026-08-25 23:42:44'),
(572, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-25 23:42:44'),
(573, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-25 23:42:47'),
(574, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-08-25 23:42:47'),
(575, 1, 'GET /api/participants/1', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-25 23:42:49'),
(576, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":500,\"durationMs\":2}', '2026-08-25 23:42:53'),
(577, 1, 'GET /api/participants/2', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-08-25 23:42:58'),
(578, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":346}', '2026-08-25 23:44:09'),
(579, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":47}', '2026-08-25 23:44:09'),
(580, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":8}', '2026-08-25 23:44:19'),
(581, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":16}', '2026-08-25 23:44:19'),
(582, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-25 23:47:07'),
(583, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-25 23:47:08'),
(584, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":8}', '2026-08-25 23:47:17'),
(585, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":200,\"durationMs\":25}', '2026-08-25 23:47:24'),
(586, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":200,\"durationMs\":24}', '2026-08-25 23:47:27'),
(587, NULL, 'GET /api/dashboard', 'request', NULL, '{\"status\":401,\"durationMs\":1}', '2026-08-25 23:50:39'),
(588, NULL, 'GET /api/dashboard', 'request', NULL, '{\"status\":401,\"durationMs\":3}', '2026-08-25 23:50:39'),
(589, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":316}', '2026-08-25 23:50:46'),
(590, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-25 23:50:46'),
(591, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":8}', '2026-08-25 23:50:46'),
(592, NULL, 'GET /api/dashboard', 'request', NULL, '{\"status\":401,\"durationMs\":2}', '2026-08-25 23:50:53'),
(593, NULL, 'GET /api/dashboard', 'request', NULL, '{\"status\":401,\"durationMs\":2}', '2026-08-25 23:50:53'),
(594, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":340}', '2026-08-25 23:51:01'),
(595, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-25 23:51:01'),
(596, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-25 23:51:01'),
(597, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-25 23:51:05'),
(598, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-08-25 23:51:05'),
(599, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-08-25 23:52:31'),
(600, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-08-25 23:52:31'),
(601, 1, 'GET /api/participants/1', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-25 23:52:33'),
(602, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":500,\"durationMs\":6}', '2026-08-25 23:52:38'),
(603, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":14}', '2026-08-25 23:52:50'),
(604, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":7}', '2026-08-25 23:52:50'),
(605, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-08-25 23:52:52'),
(606, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-08-25 23:52:52'),
(607, 1, 'GET /api/participants/1', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-25 23:52:54'),
(608, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":500,\"durationMs\":3}', '2026-08-25 23:52:59'),
(609, 1, 'GET /api/participants/2', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-25 23:53:04'),
(610, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":500,\"durationMs\":2}', '2026-08-25 23:53:06'),
(611, 1, 'GET /api/participants/3', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-25 23:53:10'),
(612, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":500,\"durationMs\":2}', '2026-08-25 23:53:12'),
(613, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-08-25 23:53:16'),
(614, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":200,\"durationMs\":12}', '2026-08-25 23:53:17'),
(615, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-25 23:53:20'),
(616, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":200,\"durationMs\":17}', '2026-08-25 23:53:22'),
(617, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":200,\"durationMs\":19}', '2026-08-25 23:53:26'),
(618, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-08-25 23:53:30'),
(619, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-08-25 23:53:30'),
(620, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-08-25 23:57:35'),
(621, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-08-25 23:57:35'),
(622, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-08-25 23:57:58'),
(623, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":7}', '2026-08-25 23:57:58'),
(624, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-25 23:57:59'),
(625, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":200,\"durationMs\":22}', '2026-08-25 23:58:01'),
(626, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-25 23:58:05'),
(627, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":8}', '2026-08-25 23:58:05'),
(628, NULL, 'GET /api/participants', 'request', NULL, '{\"status\":401,\"durationMs\":13}', '2026-08-26 00:08:32'),
(629, NULL, 'GET /api/participants', 'request', NULL, '{\"status\":401,\"durationMs\":9}', '2026-08-26 00:08:32'),
(630, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":326}', '2026-08-26 00:08:38'),
(631, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":7}', '2026-08-26 00:08:38'),
(632, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-26 00:08:38'),
(633, 1, 'GET /api/participants/1', 'request', NULL, '{\"status\":200,\"durationMs\":10}', '2026-08-26 00:08:45'),
(634, NULL, 'GET /api/dashboard', 'request', NULL, '{\"status\":401,\"durationMs\":3}', '2026-08-26 00:08:54'),
(635, NULL, 'GET /api/dashboard', 'request', NULL, '{\"status\":401,\"durationMs\":2}', '2026-08-26 00:08:54'),
(636, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":314}', '2026-08-26 00:09:02'),
(637, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":8}', '2026-08-26 00:09:02'),
(638, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":7}', '2026-08-26 00:09:02'),
(639, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":500,\"durationMs\":5}', '2026-08-26 00:10:43'),
(640, 1, 'GET /api/participants/2', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-26 00:10:47'),
(641, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":500,\"durationMs\":4}', '2026-08-26 00:10:49'),
(642, 1, 'GET /api/participants/3', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-26 00:10:51'),
(643, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":500,\"durationMs\":7}', '2026-08-26 00:10:53'),
(644, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-26 00:10:56'),
(645, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":200,\"durationMs\":28}', '2026-08-26 00:10:58'),
(646, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-08-26 00:11:00'),
(647, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":200,\"durationMs\":11}', '2026-08-26 00:11:02'),
(648, 1, 'GET /api/participants/1', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-26 00:11:12'),
(649, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":500,\"durationMs\":6}', '2026-08-26 00:11:13'),
(650, 1, 'GET /api/participants/1', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-26 00:11:27'),
(651, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":500,\"durationMs\":2}', '2026-08-26 00:11:30'),
(652, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":119}', '2026-08-26 00:13:06'),
(653, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":29}', '2026-08-26 00:13:06'),
(654, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-26 00:13:28'),
(655, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-26 00:13:28'),
(656, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":22}', '2026-08-26 00:13:42'),
(657, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":37}', '2026-08-26 00:13:42'),
(658, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-08-26 00:18:47'),
(659, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-08-26 00:18:47'),
(660, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":326}', '2026-08-26 00:19:00'),
(661, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":7}', '2026-08-26 00:19:00'),
(662, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-08-26 00:19:00'),
(663, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":2}', '2026-08-26 00:19:02'),
(664, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-08-26 00:19:02'),
(665, 1, 'GET /api/participants/1', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-26 00:19:53'),
(666, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":500,\"durationMs\":2}', '2026-08-26 00:19:56'),
(667, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":8}', '2026-08-26 00:20:15'),
(668, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":7}', '2026-08-26 00:20:15'),
(669, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":13}', '2026-08-26 00:21:53'),
(670, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":144}', '2026-08-26 00:21:53'),
(671, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":465}', '2026-08-26 00:22:11'),
(672, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":24}', '2026-08-26 00:22:11'),
(673, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":12}', '2026-08-26 00:22:11'),
(674, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":31}', '2026-08-26 00:22:38'),
(675, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":11}', '2026-08-26 00:22:38'),
(676, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":12}', '2026-08-26 00:22:43'),
(677, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-08-26 00:22:43'),
(678, 1, 'GET /api/participants/2', 'request', NULL, '{\"status\":200,\"durationMs\":11}', '2026-08-26 00:22:48'),
(679, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":500,\"durationMs\":12}', '2026-08-26 00:22:51'),
(680, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":80}', '2026-08-26 00:23:57'),
(681, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":8}', '2026-08-26 00:23:58'),
(682, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":22}', '2026-08-26 00:23:58'),
(683, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":7}', '2026-08-26 00:24:00'),
(684, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-08-26 00:24:00'),
(685, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":7}', '2026-08-26 00:24:01'),
(686, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-08-26 00:24:01'),
(687, NULL, 'GET /api/participants', 'request', NULL, '{\"status\":401,\"durationMs\":2}', '2026-08-26 00:24:05'),
(688, NULL, 'GET /api/participants', 'request', NULL, '{\"status\":401,\"durationMs\":4}', '2026-08-26 00:24:05'),
(689, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":345}', '2026-08-26 00:24:16'),
(690, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-08-26 00:24:16'),
(691, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-08-26 00:24:16'),
(692, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":52}', '2026-08-26 00:24:42'),
(693, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":16}', '2026-08-26 00:24:42'),
(694, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-08-26 00:24:44'),
(695, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-08-26 00:24:44'),
(696, 1, 'GET /api/participants/1', 'request', NULL, '{\"status\":200,\"durationMs\":10}', '2026-08-26 00:24:45'),
(697, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":500,\"durationMs\":6}', '2026-08-26 00:25:00'),
(698, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":8}', '2026-08-26 00:25:08'),
(699, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":9}', '2026-08-26 00:25:08'),
(700, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":500,\"durationMs\":4}', '2026-08-26 00:26:35'),
(701, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":173}', '2026-08-26 00:36:35'),
(702, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":61}', '2026-08-26 00:36:35'),
(703, 1, 'GET /api/participants/1', 'request', NULL, '{\"status\":200,\"durationMs\":16}', '2026-08-26 00:36:36'),
(704, NULL, 'GET /api/dashboard', 'request', NULL, '{\"status\":401,\"durationMs\":23}', '2026-08-26 00:56:02'),
(705, NULL, 'GET /api/dashboard', 'request', NULL, '{\"status\":401,\"durationMs\":2}', '2026-08-26 00:56:02'),
(706, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":337}', '2026-08-26 00:56:09'),
(707, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":13}', '2026-08-26 00:56:09'),
(708, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":13}', '2026-08-26 00:56:09'),
(709, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":8}', '2026-08-26 00:56:12'),
(710, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-08-26 00:56:12'),
(711, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":11}', '2026-08-26 00:56:13'),
(712, 1, 'GET /api/participants/1', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-26 00:56:15'),
(713, 1, 'DELETE /api/participants/1', 'request', NULL, '{\"status\":200,\"durationMs\":25}', '2026-08-26 00:56:19'),
(714, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":8}', '2026-08-26 00:56:19'),
(715, 1, 'GET /api/participants/1', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-26 00:56:21'),
(716, 1, 'GET /api/participants/2', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-08-26 00:56:28'),
(717, 1, 'GET /api/participants/1', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-26 00:56:28'),
(718, 1, 'GET /api/participants/2', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-26 00:56:29'),
(719, 1, 'GET /api/participants/3', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-08-26 00:56:29'),
(720, 1, 'GET /api/participants/1', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-26 00:56:30'),
(721, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":115}', '2026-08-26 00:56:33'),
(722, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":15}', '2026-08-26 00:56:33'),
(723, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-26 00:56:35'),
(724, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-08-26 00:56:35'),
(725, 1, 'GET /api/participants/1', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-26 00:56:36'),
(726, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":99}', '2026-08-26 01:05:50'),
(727, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":12}', '2026-08-26 01:05:50'),
(728, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-26 01:05:52'),
(729, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":2}', '2026-08-26 01:05:52'),
(730, 1, 'GET /api/participants/2', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-08-26 01:05:54'),
(731, 1, 'DELETE /api/participants/2', 'request', NULL, '{\"status\":200,\"durationMs\":28}', '2026-08-26 01:05:57'),
(732, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":13}', '2026-08-26 01:05:57'),
(733, 1, 'GET /api/participants/3', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-26 01:05:59'),
(734, 1, 'DELETE /api/participants/3', 'request', NULL, '{\"status\":200,\"durationMs\":30}', '2026-08-26 01:06:04'),
(735, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":10}', '2026-08-26 01:06:04'),
(736, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-26 01:06:06'),
(737, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-26 01:06:07'),
(738, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":200,\"durationMs\":7}', '2026-08-26 01:06:07'),
(739, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-26 01:06:07'),
(740, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-08-26 01:06:08'),
(741, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-26 01:06:08'),
(742, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-08-26 01:06:08'),
(743, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-26 01:06:09'),
(744, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-26 01:06:17'),
(745, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-08-26 01:06:17'),
(746, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":14}', '2026-08-26 01:06:19'),
(747, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":23}', '2026-08-26 01:06:19'),
(748, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":424}', '2026-09-02 00:01:35'),
(749, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":41}', '2026-09-02 00:01:35'),
(750, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":11}', '2026-09-02 00:01:35'),
(751, 1, 'GET /api/risk-scores', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-09-02 00:01:37'),
(752, 1, 'GET /api/risk-scores', 'request', NULL, '{\"status\":200,\"durationMs\":10}', '2026-09-02 00:01:37'),
(753, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":7}', '2026-09-02 00:01:46'),
(754, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-09-02 00:01:46'),
(755, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":430}', '2026-09-02 23:44:48'),
(756, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":37}', '2026-09-02 23:44:49'),
(757, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":9}', '2026-09-02 23:44:49'),
(758, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":8}', '2026-09-02 23:44:52'),
(759, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-09-02 23:44:52'),
(760, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":30}', '2026-09-02 23:45:21'),
(761, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":63}', '2026-09-02 23:45:21'),
(762, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-09-02 23:45:25'),
(763, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-09-02 23:45:25'),
(764, 1, 'POST /api/participants', 'request', NULL, '{\"status\":201,\"durationMs\":121}', '2026-09-02 23:49:53'),
(765, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":8}', '2026-09-02 23:49:55'),
(766, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-09-02 23:49:55'),
(767, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":332}', '2026-09-03 00:04:04'),
(768, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":30}', '2026-09-03 00:04:04'),
(769, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":7}', '2026-09-03 00:04:04'),
(770, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":356}', '2026-09-03 00:04:17'),
(771, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":7}', '2026-09-03 00:04:17'),
(772, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":7}', '2026-09-03 00:04:17'),
(773, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":7}', '2026-09-03 00:04:40'),
(774, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":7}', '2026-09-03 00:04:40'),
(775, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":9}', '2026-09-03 00:05:30'),
(776, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":304,\"durationMs\":9}', '2026-09-03 00:05:30'),
(777, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":620}', '2026-09-03 00:07:58'),
(778, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":15}', '2026-09-03 00:07:58'),
(779, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":24}', '2026-09-03 00:07:58'),
(780, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":384}', '2026-09-03 00:17:15'),
(781, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":18}', '2026-09-03 00:17:16'),
(782, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":9}', '2026-09-03 00:17:16'),
(783, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":363}', '2026-09-03 00:17:48'),
(784, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":12}', '2026-09-03 00:17:48'),
(785, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":7}', '2026-09-03 00:17:48'),
(786, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-09-03 00:17:50'),
(787, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":7}', '2026-09-03 00:17:50'),
(788, 1, 'GET /api/participants/6', 'request', NULL, '{\"status\":200,\"durationMs\":20}', '2026-09-03 00:17:52'),
(789, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":200,\"durationMs\":25}', '2026-09-03 00:17:55'),
(790, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":10}', '2026-09-03 00:18:01'),
(791, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":10}', '2026-09-03 00:18:01'),
(792, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-09-03 00:18:25'),
(793, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-09-03 00:18:25'),
(794, 1, 'GET /api/participants/6', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-09-03 00:18:26'),
(795, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":200,\"durationMs\":18}', '2026-09-03 00:18:29'),
(796, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":14}', '2026-09-03 00:18:33'),
(797, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":11}', '2026-09-03 00:18:33'),
(798, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-09-03 00:18:46'),
(799, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-09-03 00:18:46'),
(800, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-09-03 00:18:48'),
(801, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":200,\"durationMs\":11}', '2026-09-03 00:18:50'),
(802, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":7}', '2026-09-03 00:18:53'),
(803, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":32}', '2026-09-03 00:18:53'),
(804, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-09-03 00:18:57'),
(805, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":2}', '2026-09-03 00:18:57'),
(806, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-09-03 00:18:58'),
(807, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":200,\"durationMs\":14}', '2026-09-03 00:19:00'),
(808, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-09-03 00:19:02'),
(809, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":200,\"durationMs\":17}', '2026-09-03 00:19:04'),
(810, 1, 'GET /api/participants/6', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-09-03 00:19:07'),
(811, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":200,\"durationMs\":7}', '2026-09-03 00:19:08'),
(812, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":7}', '2026-09-03 00:19:13'),
(813, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":10}', '2026-09-03 00:19:13'),
(814, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-09-03 00:19:50'),
(815, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-09-03 00:19:50'),
(816, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":386}', '2026-09-03 00:25:32'),
(817, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":8}', '2026-09-03 00:25:32'),
(818, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-09-03 00:25:32'),
(819, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":11}', '2026-09-03 00:26:56'),
(820, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":12}', '2026-09-03 00:26:56'),
(821, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-09-03 00:27:50'),
(822, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-09-03 00:27:50'),
(823, 1, 'GET /api/participants/6', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-09-03 00:27:54'),
(824, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":339}', '2026-09-03 00:28:32'),
(825, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":10}', '2026-09-03 00:28:32'),
(826, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-09-03 00:28:32'),
(827, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-09-03 00:28:46'),
(828, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-09-03 00:28:46'),
(829, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":200,\"durationMs\":16}', '2026-09-03 00:28:55'),
(830, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":200,\"durationMs\":9}', '2026-09-03 00:28:56'),
(831, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":200,\"durationMs\":9}', '2026-09-03 00:28:58'),
(832, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-09-03 00:29:00'),
(833, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-09-03 00:29:28'),
(834, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-09-03 00:29:28'),
(835, 1, 'GET /api/participants/6', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-09-03 00:29:32'),
(836, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-09-03 00:29:33'),
(837, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":403,\"durationMs\":329}', '2026-09-03 00:29:34'),
(838, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":403,\"durationMs\":318}', '2026-09-03 00:29:35'),
(839, 1, 'GET /api/participants/6', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-09-03 00:29:47'),
(840, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-09-03 00:29:50'),
(841, 1, 'PUT /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":455}', '2026-09-03 00:29:59'),
(842, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":7}', '2026-09-03 00:29:59'),
(843, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-09-03 00:30:01'),
(844, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-09-03 00:30:02'),
(845, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":403,\"durationMs\":329}', '2026-09-03 00:30:13'),
(846, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":403,\"durationMs\":327}', '2026-09-03 00:30:13'),
(847, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":200,\"durationMs\":333}', '2026-09-03 00:30:20'),
(848, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":8}', '2026-09-03 00:30:29'),
(849, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":8}', '2026-09-03 00:30:29'),
(850, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":403,\"durationMs\":342}', '2026-09-03 00:30:35'),
(851, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":403,\"durationMs\":326}', '2026-09-03 00:30:35'),
(852, 1, 'POST /api/portal/profile', 'request', NULL, '{\"status\":200,\"durationMs\":316}', '2026-09-03 00:30:40'),
(853, 1, 'GET /api/risk-scores', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-09-03 00:31:14'),
(854, 1, 'GET /api/risk-scores', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-09-03 00:31:14'),
(855, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":7}', '2026-09-03 00:31:16'),
(856, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":13}', '2026-09-03 00:31:16'),
(857, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-09-03 00:35:01'),
(858, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-09-03 00:35:01'),
(859, 1, 'GET /api/participants/6', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-09-03 00:35:02'),
(860, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-09-03 00:35:32'),
(861, 1, 'GET /api/participants/6', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-09-03 00:36:26'),
(862, 1, 'PUT /api/participants/6', 'request', NULL, '{\"status\":200,\"durationMs\":21}', '2026-09-03 00:36:38'),
(863, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-09-03 00:36:38'),
(864, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-09-03 00:36:40'),
(865, 1, 'GET /api/participants/6', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-09-03 00:36:41'),
(866, 1, 'GET /api/participants/6', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-09-03 00:36:46'),
(867, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-09-03 00:36:46'),
(868, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-09-03 00:36:48'),
(869, 1, 'GET /api/participants/6', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-09-03 00:36:48'),
(870, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-09-03 00:36:51'),
(871, 1, 'GET /api/participants/6', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-09-03 00:36:51'),
(872, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":200,\"durationMs\":17}', '2026-09-03 00:36:52'),
(873, NULL, 'GET /api/dashboard', 'request', NULL, '{\"status\":401,\"durationMs\":3}', '2026-09-03 23:08:43'),
(874, NULL, 'GET /api/dashboard', 'request', NULL, '{\"status\":401,\"durationMs\":15}', '2026-09-03 23:08:43'),
(875, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":340}', '2026-09-03 23:08:48'),
(876, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":27}', '2026-09-03 23:08:49'),
(877, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":7}', '2026-09-03 23:08:49'),
(878, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":339}', '2026-09-03 23:19:43'),
(879, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":29}', '2026-09-03 23:19:43'),
(880, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":7}', '2026-09-03 23:19:43'),
(881, 1, 'GET /api/events', 'request', NULL, '{\"status\":200,\"durationMs\":7}', '2026-09-03 23:19:47'),
(882, 1, 'GET /api/events', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-09-03 23:19:47'),
(883, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":446}', '2026-09-03 23:21:43'),
(884, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":16}', '2026-09-03 23:21:43'),
(885, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":9}', '2026-09-03 23:21:43'),
(886, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":16}', '2026-09-03 23:21:46'),
(887, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-09-03 23:21:46'),
(888, 1, 'GET /api/events', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-09-03 23:21:50'),
(889, 1, 'GET /api/events', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-09-03 23:21:50'),
(890, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":196}', '2026-09-03 23:22:53'),
(891, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":73}', '2026-09-03 23:22:54'),
(892, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-09-03 23:22:55'),
(893, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":7}', '2026-09-03 23:22:55'),
(894, 1, 'GET /api/events', 'request', NULL, '{\"status\":200,\"durationMs\":133}', '2026-09-03 23:23:05'),
(895, 1, 'GET /api/events', 'request', NULL, '{\"status\":200,\"durationMs\":71}', '2026-09-03 23:23:09'),
(896, 1, 'GET /api/events', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-09-03 23:23:10'),
(897, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":320}', '2026-09-03 23:23:19'),
(898, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":41}', '2026-09-03 23:23:19'),
(899, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":143}', '2026-09-03 23:26:34'),
(900, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":34}', '2026-09-03 23:26:34'),
(901, 1, 'GET /api/events', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-09-03 23:26:35'),
(902, 1, 'GET /api/events', 'request', NULL, '{\"status\":200,\"durationMs\":2}', '2026-09-03 23:26:35'),
(903, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-09-03 23:26:44'),
(904, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-09-03 23:26:44');
INSERT INTO `system_logs` (`id`, `user_id`, `action`, `entity_type`, `entity_id`, `details`, `created_at`) VALUES
(905, 1, 'GET /api/events', 'request', NULL, '{\"status\":200,\"durationMs\":9}', '2026-09-03 23:26:46'),
(906, 1, 'GET /api/events', 'request', NULL, '{\"status\":200,\"durationMs\":14}', '2026-09-03 23:26:46'),
(907, 1, 'GET /api/events', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-09-03 23:26:54'),
(908, 1, 'GET /api/events', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-09-03 23:26:54'),
(909, 1, 'POST /api/events', 'request', NULL, '{\"status\":201,\"durationMs\":23}', '2026-09-03 23:30:44'),
(910, 1, 'GET /api/events', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-09-03 23:30:44'),
(911, 1, 'GET /api/events/1/attendance', 'request', NULL, '{\"status\":200,\"durationMs\":15}', '2026-09-03 23:30:54'),
(912, 1, 'GET /api/events/1/attendance', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-09-03 23:30:57'),
(913, 1, 'GET /api/events/1/attendance', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-09-03 23:30:57'),
(914, 1, 'GET /api/events/1/attendance', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-09-03 23:30:58'),
(915, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-09-03 23:31:02'),
(916, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":28}', '2026-09-03 23:31:02'),
(917, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":7}', '2026-09-03 23:31:03'),
(918, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":7}', '2026-09-03 23:31:03'),
(919, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-09-03 23:31:04'),
(920, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-09-03 23:31:04'),
(921, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":7}', '2026-09-03 23:31:07'),
(922, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":7}', '2026-09-03 23:31:07'),
(923, 1, 'GET /api/events', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-09-03 23:33:00'),
(924, 1, 'GET /api/events', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-09-03 23:33:01'),
(925, NULL, 'GET /api/participants', 'request', NULL, '{\"status\":401,\"durationMs\":2}', '2026-09-03 23:36:44'),
(926, NULL, 'GET /api/participants', 'request', NULL, '{\"status\":401,\"durationMs\":1}', '2026-09-03 23:36:44'),
(927, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":321}', '2026-09-03 23:36:54'),
(928, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":7}', '2026-09-03 23:36:54'),
(929, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":7}', '2026-09-03 23:36:54'),
(930, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-09-03 23:36:56'),
(931, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-09-03 23:36:56'),
(932, 1, 'GET /api/events', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-09-03 23:36:58'),
(933, 1, 'GET /api/events', 'request', NULL, '{\"status\":200,\"durationMs\":2}', '2026-09-03 23:36:58'),
(934, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-09-03 23:36:59'),
(935, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":12}', '2026-09-03 23:36:59'),
(936, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":337}', '2026-09-03 23:37:58'),
(937, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":9}', '2026-09-03 23:37:58'),
(938, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-09-03 23:37:58'),
(939, 1, 'GET /api/events', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-09-03 23:38:01'),
(940, 1, 'GET /api/events', 'request', NULL, '{\"status\":200,\"durationMs\":2}', '2026-09-03 23:38:01'),
(941, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-09-03 23:38:26'),
(942, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-09-03 23:38:26'),
(943, 1, 'GET /api/participants/4', 'request', NULL, '{\"status\":200,\"durationMs\":18}', '2026-09-03 23:38:30'),
(944, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":200,\"durationMs\":32}', '2026-09-03 23:38:36'),
(945, 1, 'GET /api/participants/5', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-09-03 23:38:38'),
(946, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":200,\"durationMs\":15}', '2026-09-03 23:38:40'),
(947, 1, 'GET /api/participants/6', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-09-03 23:38:42'),
(948, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":200,\"durationMs\":22}', '2026-09-03 23:38:44'),
(949, 1, 'POST /api/checkin', 'request', NULL, '{\"status\":200,\"durationMs\":10}', '2026-09-03 23:38:48'),
(950, 1, 'GET /api/events', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-09-03 23:38:51'),
(951, 1, 'GET /api/events', 'request', NULL, '{\"status\":200,\"durationMs\":2}', '2026-09-03 23:38:51'),
(952, 1, 'GET /api/events/1/attendance', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-09-03 23:38:53'),
(953, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":9}', '2026-09-03 23:39:31'),
(954, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":6}', '2026-09-03 23:39:31'),
(955, 1, 'GET /api/risk-scores', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-09-03 23:39:43'),
(956, 1, 'GET /api/risk-scores', 'request', NULL, '{\"status\":200,\"durationMs\":3}', '2026-09-03 23:39:43'),
(957, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":37}', '2026-09-03 23:43:27'),
(958, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":7}', '2026-09-03 23:43:27'),
(959, NULL, 'GET /api/dashboard', 'request', NULL, '{\"status\":401,\"durationMs\":18}', '2026-09-14 00:52:45'),
(960, NULL, 'GET /api/dashboard', 'request', NULL, '{\"status\":401,\"durationMs\":3}', '2026-09-14 00:52:45'),
(961, NULL, 'POST /api/auth/login', 'request', NULL, '{\"status\":200,\"durationMs\":381}', '2026-09-14 00:52:57'),
(962, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":28}', '2026-09-14 00:52:57'),
(963, 1, 'GET /api/dashboard', 'request', NULL, '{\"status\":200,\"durationMs\":7}', '2026-09-14 00:52:57'),
(964, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":10}', '2026-09-14 00:53:00'),
(965, 1, 'GET /api/participants', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-09-14 00:53:00'),
(966, 1, 'GET /api/events', 'request', NULL, '{\"status\":200,\"durationMs\":16}', '2026-09-14 00:53:02'),
(967, 1, 'GET /api/events', 'request', NULL, '{\"status\":200,\"durationMs\":5}', '2026-09-14 00:53:02'),
(968, 1, 'GET /api/events/1/attendance', 'request', NULL, '{\"status\":200,\"durationMs\":8}', '2026-09-14 00:53:06'),
(969, 1, 'GET /api/events/1/attendance', 'request', NULL, '{\"status\":200,\"durationMs\":4}', '2026-09-14 00:53:10');

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `id` int(11) UNSIGNED NOT NULL,
  `username` varchar(100) NOT NULL,
  `email` varchar(150) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `role` varchar(50) NOT NULL,
  `status` varchar(30) NOT NULL,
  `last_login_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `users`
--

INSERT INTO `users` (`id`, `username`, `email`, `password_hash`, `role`, `status`, `last_login_at`, `created_at`, `updated_at`) VALUES
(1, 'admin', 'admin@gmail.com', '$2b$12$NeGH3QLnIJnFiDJ3nPGvq.OfEdyS7nJ2GVeAWmTxsBtXrI7XGpy8a', 'Admin', 'active', '2026-09-14 00:52:57', '2026-07-07 14:45:01', '2026-08-25 19:39:46');

--
-- Indexes for dumped tables
--

--
-- Indexes for table `check_in_logs`
--
ALTER TABLE `check_in_logs`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `events`
--
ALTER TABLE `events`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_events_name_starts_at` (`name`,`starts_at`),
  ADD KEY `idx_events_starts_at` (`starts_at`);

--
-- Indexes for table `growth_updates`
--
ALTER TABLE `growth_updates`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `migrations`
--
ALTER TABLE `migrations`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `participants`
--
ALTER TABLE `participants`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `predictive_risk_scores`
--
ALTER TABLE `predictive_risk_scores`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `qr_codes`
--
ALTER TABLE `qr_codes`
  ADD PRIMARY KEY (`id`),
  ADD KEY `qr_uid` (`qr_uid`);

--
-- Indexes for table `qr_code_ids`
--
ALTER TABLE `qr_code_ids`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `qr_scan_logs`
--
ALTER TABLE `qr_scan_logs`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `sensitive_access_logs`
--
ALTER TABLE `sensitive_access_logs`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `sponsors`
--
ALTER TABLE `sponsors`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `system_logs`
--
ALTER TABLE `system_logs`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `check_in_logs`
--
ALTER TABLE `check_in_logs`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=16;

--
-- AUTO_INCREMENT for table `events`
--
ALTER TABLE `events`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `growth_updates`
--
ALTER TABLE `growth_updates`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `migrations`
--
ALTER TABLE `migrations`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- AUTO_INCREMENT for table `participants`
--
ALTER TABLE `participants`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=7;

--
-- AUTO_INCREMENT for table `predictive_risk_scores`
--
ALTER TABLE `predictive_risk_scores`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `qr_codes`
--
ALTER TABLE `qr_codes`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=13;

--
-- AUTO_INCREMENT for table `qr_code_ids`
--
ALTER TABLE `qr_code_ids`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `qr_scan_logs`
--
ALTER TABLE `qr_scan_logs`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `sensitive_access_logs`
--
ALTER TABLE `sensitive_access_logs`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=8;

--
-- AUTO_INCREMENT for table `sponsors`
--
ALTER TABLE `sponsors`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `system_logs`
--
ALTER TABLE `system_logs`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=970;

--
-- AUTO_INCREMENT for table `users`
--
ALTER TABLE `users`
  MODIFY `id` int(11) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
