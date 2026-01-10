import { eq, and, desc, asc, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { 
  InsertUser, users, 
  topics, InsertTopic, Topic,
  viewpoints, InsertViewpoint, Viewpoint,
  votes, InsertVote, Vote,
  comments, InsertComment, Comment
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateUserVotingCredits(userId: number, credits: number) {
  const db = await getDb();
  if (!db) return;
  
  await db.update(users).set({ votingCredits: credits }).where(eq(users.id, userId));
}

// ============ TOPIC QUERIES ============

export async function createTopic(topic: InsertTopic): Promise<Topic | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.insert(topics).values(topic);
  const insertId = result[0].insertId;
  
  const created = await db.select().from(topics).where(eq(topics.id, insertId)).limit(1);
  return created[0];
}

export async function getTopicBySlug(slug: string): Promise<Topic | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(topics).where(eq(topics.slug, slug)).limit(1);
  return result[0];
}

export async function getTopicById(id: number): Promise<Topic | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(topics).where(eq(topics.id, id)).limit(1);
  return result[0];
}

export async function listTopics(status?: "draft" | "active" | "archived"): Promise<Topic[]> {
  const db = await getDb();
  if (!db) return [];
  
  if (status) {
    return db.select().from(topics).where(eq(topics.status, status)).orderBy(desc(topics.createdAt));
  }
  return db.select().from(topics).orderBy(desc(topics.createdAt));
}

export async function updateTopicReport(topicId: number, report: unknown) {
  const db = await getDb();
  if (!db) return;
  
  await db.update(topics).set({ 
    aiReport: report,
    reportUpdatedAt: new Date()
  }).where(eq(topics.id, topicId));
}

export async function updateTopicThemeMode(topicId: number, themeMode: "flat" | "grouped") {
  const db = await getDb();
  if (!db) return;
  
  await db.update(topics).set({ themeMode }).where(eq(topics.id, topicId));
}

// ============ VIEWPOINT QUERIES ============

export async function createViewpoint(viewpoint: InsertViewpoint): Promise<Viewpoint | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.insert(viewpoints).values(viewpoint);
  const insertId = result[0].insertId;
  
  const created = await db.select().from(viewpoints).where(eq(viewpoints.id, insertId)).limit(1);
  return created[0];
}

export async function getViewpointById(id: number): Promise<Viewpoint | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(viewpoints).where(eq(viewpoints.id, id)).limit(1);
  return result[0];
}

export async function listViewpointsByTopic(topicId: number): Promise<Viewpoint[]> {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(viewpoints)
    .where(eq(viewpoints.topicId, topicId))
    .orderBy(asc(viewpoints.depth), desc(viewpoints.totalVotes));
}

export async function listViewpointsByParent(parentId: number | null, topicId: number): Promise<Viewpoint[]> {
  const db = await getDb();
  if (!db) return [];
  
  if (parentId === null) {
    return db.select().from(viewpoints)
      .where(and(eq(viewpoints.topicId, topicId), sql`${viewpoints.parentId} IS NULL`))
      .orderBy(desc(viewpoints.totalVotes));
  }
  
  return db.select().from(viewpoints)
    .where(and(eq(viewpoints.topicId, topicId), eq(viewpoints.parentId, parentId)))
    .orderBy(desc(viewpoints.totalVotes));
}

export async function updateViewpointAIAnalysis(
  viewpointId: number, 
  analysis: { theme?: string; sentimentScore?: number; keywords?: string[] }
) {
  const db = await getDb();
  if (!db) return;
  
  await db.update(viewpoints).set({
    theme: analysis.theme,
    sentimentScore: analysis.sentimentScore,
    keywords: analysis.keywords
  }).where(eq(viewpoints.id, viewpointId));
}

export async function updateViewpointVotes(viewpointId: number, totalVotes: number) {
  const db = await getDb();
  if (!db) return;
  
  await db.update(viewpoints).set({ totalVotes }).where(eq(viewpoints.id, viewpointId));
}

export async function updateViewpointTheme(viewpointId: number, theme: string | null) {
  const db = await getDb();
  if (!db) return;
  
  await db.update(viewpoints).set({ theme }).where(eq(viewpoints.id, viewpointId));
}

export async function getTopicThemes(topicId: number): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  
  const viewpointList = await listViewpointsByTopic(topicId);
  const themes = new Set<string>();
  
  for (const vp of viewpointList) {
    if (vp.theme) {
      themes.add(vp.theme);
    }
  }
  
  return Array.from(themes).sort();
}

// ============ VOTE QUERIES ============

export async function getUserVote(userId: number, viewpointId: number): Promise<Vote | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(votes)
    .where(and(eq(votes.userId, userId), eq(votes.viewpointId, viewpointId)))
    .limit(1);
  return result[0];
}

export async function upsertVote(vote: InsertVote): Promise<Vote | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  
  await db.insert(votes).values(vote).onDuplicateKeyUpdate({
    set: {
      voteCount: vote.voteCount,
      creditsSpent: vote.creditsSpent,
      updatedAt: new Date()
    }
  });
  
  return getUserVote(vote.userId, vote.viewpointId);
}

export async function getVotesByViewpoint(viewpointId: number): Promise<Vote[]> {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(votes).where(eq(votes.viewpointId, viewpointId));
}

// ============ COMMENT QUERIES ============

export async function createComment(comment: InsertComment): Promise<Comment | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.insert(comments).values(comment);
  const insertId = result[0].insertId;
  
  const created = await db.select().from(comments).where(eq(comments.id, insertId)).limit(1);
  return created[0];
}

export async function listCommentsByViewpoint(viewpointId: number): Promise<Comment[]> {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(comments)
    .where(eq(comments.viewpointId, viewpointId))
    .orderBy(asc(comments.createdAt));
}

// ============ AGGREGATION QUERIES ============

export async function getTopicStats(topicId: number) {
  const db = await getDb();
  if (!db) return { viewpointCount: 0, participantCount: 0, totalVotes: 0 };
  
  const viewpointList = await listViewpointsByTopic(topicId);
  const viewpointCount = viewpointList.length;
  
  // Get unique authors
  const authorIds = new Set(viewpointList.map(v => v.authorId));
  const participantCount = authorIds.size;
  
  // Sum total votes
  const totalVotes = viewpointList.reduce((sum, v) => sum + v.totalVotes, 0);
  
  return { viewpointCount, participantCount, totalVotes };
}

export async function getThemeDistribution(topicId: number): Promise<Record<string, number>> {
  const db = await getDb();
  if (!db) return {};
  
  const viewpointList = await listViewpointsByTopic(topicId);
  const distribution: Record<string, number> = {};
  
  for (const vp of viewpointList) {
    const theme = vp.theme || "Uncategorized";
    distribution[theme] = (distribution[theme] || 0) + 1;
  }
  
  return distribution;
}
