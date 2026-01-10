import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, json } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  /** Quadratic voting credits available (default 100) */
  votingCredits: int("votingCredits").default(100).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Topics (议题池) - The main discussion containers
 */
export const topics = mysqlTable("topics", {
  id: int("id").autoincrement().primaryKey(),
  /** URL-friendly slug for deep linking */
  slug: varchar("slug", { length: 128 }).notNull().unique(),
  /** Topic title */
  title: varchar("title", { length: 512 }).notNull(),
  /** Topic description (rich text, stored as HTML) */
  description: text("description"),
  /** Creator user ID */
  creatorId: int("creatorId").notNull(),
  /** Topic status */
  status: mysqlEnum("status", ["draft", "active", "archived"]).default("active").notNull(),
  /** AI-generated report (JSON structure) */
  aiReport: json("aiReport"),
  /** Last time AI report was updated */
  reportUpdatedAt: timestamp("reportUpdatedAt"),
  /** Theme mode: whether to display viewpoints grouped by theme (host-controlled) */
  themeMode: mysqlEnum("themeMode", ["flat", "grouped"]).default("flat").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Topic = typeof topics.$inferSelect;
export type InsertTopic = typeof topics.$inferInsert;

/**
 * Viewpoints (观点) - Individual thoughts/arguments within a topic
 * These form the nodes of the sunburst chart
 */
export const viewpoints = mysqlTable("viewpoints", {
  id: int("id").autoincrement().primaryKey(),
  /** Parent topic */
  topicId: int("topicId").notNull(),
  /** Parent viewpoint (for nested discussions, null for root viewpoints) */
  parentId: int("parentId"),
  /** Author user ID */
  authorId: int("authorId").notNull(),
  /** Viewpoint title/summary */
  title: varchar("title", { length: 512 }).notNull(),
  /** Full content (rich text, stored as HTML) */
  content: text("content"),
  /** AI-detected theme/category for sunburst grouping */
  theme: varchar("theme", { length: 128 }),
  /** AI-detected sentiment score (-1 to 1, stored as integer -100 to 100) */
  sentimentScore: int("sentimentScore"),
  /** AI-detected keywords (JSON array) */
  keywords: json("keywords"),
  /** Depth level in the hierarchy (0 for root) */
  depth: int("depth").default(0).notNull(),
  /** Total quadratic votes received */
  totalVotes: int("totalVotes").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Viewpoint = typeof viewpoints.$inferSelect;
export type InsertViewpoint = typeof viewpoints.$inferInsert;

/**
 * Quadratic Votes (二次方投票)
 * Users spend credits quadratically: 1 vote = 1 credit, 2 votes = 4 credits, etc.
 */
export const votes = mysqlTable("votes", {
  id: int("id").autoincrement().primaryKey(),
  /** Voter user ID */
  userId: int("userId").notNull(),
  /** Viewpoint being voted on */
  viewpointId: int("viewpointId").notNull(),
  /** Number of votes cast (can be negative for opposition) */
  voteCount: int("voteCount").default(0).notNull(),
  /** Credits spent (voteCount^2) */
  creditsSpent: int("creditsSpent").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Vote = typeof votes.$inferSelect;
export type InsertVote = typeof votes.$inferInsert;

/**
 * Comments/Replies on viewpoints
 * For threaded discussions within a specific viewpoint
 */
export const comments = mysqlTable("comments", {
  id: int("id").autoincrement().primaryKey(),
  /** Parent viewpoint */
  viewpointId: int("viewpointId").notNull(),
  /** Parent comment (for nested replies, null for direct comments) */
  parentId: int("parentId"),
  /** Author user ID */
  authorId: int("authorId").notNull(),
  /** Comment content (rich text) */
  content: text("content").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Comment = typeof comments.$inferSelect;
export type InsertComment = typeof comments.$inferInsert;