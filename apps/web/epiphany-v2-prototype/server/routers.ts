import { COOKIE_NAME } from "../shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import * as db from "./db";
import { invokeLLM } from "./_core/llm";

// ============ TOPIC ROUTER ============
const topicRouter = router({
  // List all active topics
  list: publicProcedure
    .input(z.object({
      status: z.enum(["draft", "active", "archived"]).optional()
    }).optional())
    .query(async ({ input }) => {
      return db.listTopics(input?.status);
    }),

  // Get a single topic by slug
  getBySlug: publicProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ input }) => {
      const topic = await db.getTopicBySlug(input.slug);
      if (!topic) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Topic not found" });
      }
      return topic;
    }),

  // Get topic with stats
  getWithStats: publicProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ input }) => {
      const topic = await db.getTopicBySlug(input.slug);
      if (!topic) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Topic not found" });
      }
      const stats = await db.getTopicStats(topic.id);
      const themeDistribution = await db.getThemeDistribution(topic.id);
      return { ...topic, stats, themeDistribution };
    }),

  // Create a new topic
  create: protectedProcedure
    .input(z.object({
      title: z.string().min(1).max(512),
      description: z.string().optional()
    }))
    .mutation(async ({ ctx, input }) => {
      const slug = nanoid(10);
      const topic = await db.createTopic({
        slug,
        title: input.title,
        description: input.description ?? null,
        creatorId: ctx.user.id
      });
      return topic;
    }),

  // Generate AI report for topic
  generateReport: publicProcedure
    .input(z.object({ topicId: z.number() }))
    .mutation(async ({ input }) => {
      const topic = await db.getTopicById(input.topicId);
      if (!topic) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Topic not found" });
      }

      const viewpoints = await db.listViewpointsByTopic(input.topicId);
      if (viewpoints.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "还没有观点，无法生成报告" });
      }

      // Prepare viewpoints data for LLM
      const viewpointsData = viewpoints.map(v => ({
        title: v.title,
        content: v.content?.replace(/<[^>]*>/g, '') || '', // Strip HTML
        votes: v.totalVotes,
        theme: v.theme
      }));

      const prompt = `你是一个议题分析专家。请分析以下议题和观点，生成一份简洁的共识/分歧报告。

议题：${topic.title}
${topic.description ? `描述：${topic.description}` : ''}

观点列表：
${viewpointsData.map((v, i) => `${i + 1}. 「${v.title}」
   内容：${v.content.slice(0, 200)}${v.content.length > 200 ? '...' : ''}
   投票数：${v.votes}
   主题：${v.theme || '未分类'}`).join('\n\n')}

请用中文输出以下内容：
1. 核心共识（大多数人认同的观点）
2. 主要分歧（争议较大的观点）
3. 关键洞察（有价值的发现）
4. 建议下一步（讨论可以如何深入）

请保持简洁，每个部分不超过2-3句话。`;

      try {
        const result = await invokeLLM({
          messages: [
            { role: "system", content: "你是一个专业的议题分析师，擅长总结共识和分歧。" },
            { role: "user", content: prompt }
          ],
          maxTokens: 2000
        });

        const reportContent = result.choices[0]?.message?.content || '报告生成失败';
        
        const report = {
          content: typeof reportContent === 'string' ? reportContent : JSON.stringify(reportContent),
          generatedAt: new Date().toISOString(),
          viewpointCount: viewpoints.length,
          totalVotes: viewpoints.reduce((sum, v) => sum + v.totalVotes, 0)
        };

        await db.updateTopicReport(input.topicId, report);
        
        return report;
      } catch (error) {
        console.error('AI report generation failed:', error);
        throw new TRPCError({ 
          code: "INTERNAL_SERVER_ERROR", 
          message: "AI 报告生成失败，请稍后重试" 
        });
      }
    }),

  // Get existing AI report
  getReport: publicProcedure
    .input(z.object({ topicId: z.number() }))
    .query(async ({ input }) => {
      const topic = await db.getTopicById(input.topicId);
      if (!topic) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Topic not found" });
      }
      return {
        report: topic.aiReport as { content: string; generatedAt: string; viewpointCount: number; totalVotes: number } | null,
        reportUpdatedAt: topic.reportUpdatedAt
      };
    }),

  // Toggle theme mode (host only)
  setThemeMode: protectedProcedure
    .input(z.object({
      topicId: z.number(),
      themeMode: z.enum(["flat", "grouped"])
    }))
    .mutation(async ({ ctx, input }) => {
      const topic = await db.getTopicById(input.topicId);
      if (!topic) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Topic not found" });
      }
      
      // Check if user is the topic creator (host)
      if (topic.creatorId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the host can change theme mode" });
      }
      
      await db.updateTopicThemeMode(input.topicId, input.themeMode);
      return { success: true };
    }),
});

// ============ VIEWPOINT ROUTER ============
const viewpointRouter = router({
  // List viewpoints for a topic
  listByTopic: publicProcedure
    .input(z.object({ topicId: z.number() }))
    .query(async ({ input }) => {
      return db.listViewpointsByTopic(input.topicId);
    }),

  // Get viewpoints for sunburst (hierarchical structure)
  // Supports two modes: flat (no grouping) and themed (grouped by theme)
  getSunburstData: publicProcedure
    .input(z.object({ 
      topicId: z.number(),
      groupByTheme: z.boolean().optional().default(false)
    }))
    .query(async ({ input }) => {
      const viewpoints = await db.listViewpointsByTopic(input.topicId);
      
      // Get author info for each viewpoint
      const viewpointsWithAuthors = await Promise.all(
        viewpoints.map(async (v) => {
          const author = await db.getUserById(v.authorId);
          return { ...v, authorName: author?.name || "Anonymous" };
        })
      );
      
      // Build hierarchical structure for sunburst with full info for hover card
      const buildHierarchy = (parentId: number | null): any[] => {
        return viewpointsWithAuthors
          .filter(v => v.parentId === parentId)
          .map(v => ({
            id: v.id,
            name: v.title,
            theme: v.theme,
            content: v.content ? v.content.slice(0, 200) : null,
            authorName: v.authorName,
            voteScore: v.totalVotes,
            value: Math.max(1, v.totalVotes + 1),
            sentiment: v.sentimentScore,
            children: buildHierarchy(v.id)
          }));
      };

      const rootViewpoints = viewpointsWithAuthors.filter(v => v.parentId === null);
      
      // Theme grouping mode
      if (input.groupByTheme) {
        // Group root viewpoints by theme
        const themeGroups: Record<string, typeof rootViewpoints> = {};
        for (const v of rootViewpoints) {
          const theme = v.theme || null;
          if (theme) {
            if (!themeGroups[theme]) {
              themeGroups[theme] = [];
            }
            themeGroups[theme].push(v);
          }
        }
        
        // Get viewpoints without theme
        const unthemedViewpoints = rootViewpoints.filter(v => !v.theme);
        
        // Build themed structure
        const themedChildren = Object.entries(themeGroups).map(([theme, vps]) => ({
          id: -1, // Theme nodes have negative IDs
          name: theme,
          isTheme: true,
          theme: theme,
          value: vps.reduce((sum, v) => sum + Math.max(1, v.totalVotes + 1), 0),
          children: vps.map(v => ({
            id: v.id,
            name: v.title,
            theme: v.theme,
            content: v.content ? v.content.slice(0, 200) : null,
            authorName: v.authorName,
            voteScore: v.totalVotes,
            value: Math.max(1, v.totalVotes + 1),
            sentiment: v.sentimentScore,
            children: buildHierarchy(v.id)
          }))
        }));
        
        // Add unthemed viewpoints directly
        const unthemedChildren = unthemedViewpoints.map(v => ({
          id: v.id,
          name: v.title,
          theme: null,
          content: v.content ? v.content.slice(0, 200) : null,
          authorName: v.authorName,
          voteScore: v.totalVotes,
          value: Math.max(1, v.totalVotes + 1),
          sentiment: v.sentimentScore,
          children: buildHierarchy(v.id)
        }));
        
        return {
          name: "root",
          children: [...themedChildren, ...unthemedChildren]
        };
      }
      
      // Flat mode (no grouping)
      return {
        name: "root",
        children: rootViewpoints.map(v => ({
          id: v.id,
          name: v.title,
          theme: v.theme,
          content: v.content ? v.content.slice(0, 200) : null,
          authorName: v.authorName,
          voteScore: v.totalVotes,
          value: Math.max(1, v.totalVotes + 1),
          sentiment: v.sentimentScore,
          children: buildHierarchy(v.id)
        }))
      };
    }),

  // Get a single viewpoint with its comments
  getById: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const viewpoint = await db.getViewpointById(input.id);
      if (!viewpoint) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Viewpoint not found" });
      }
      const comments = await db.listCommentsByViewpoint(input.id);
      const author = await db.getUserById(viewpoint.authorId);
      return { ...viewpoint, comments, author };
    }),

  // Set theme for a viewpoint (host only)
  setTheme: protectedProcedure
    .input(z.object({
      viewpointId: z.number(),
      theme: z.string().max(128).nullable()
    }))
    .mutation(async ({ ctx, input }) => {
      const viewpoint = await db.getViewpointById(input.viewpointId);
      if (!viewpoint) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Viewpoint not found" });
      }
      
      // Check if user is the topic creator (host)
      const topic = await db.getTopicById(viewpoint.topicId);
      if (!topic || topic.creatorId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the host can set themes" });
      }
      
      await db.updateViewpointTheme(input.viewpointId, input.theme);
      return { success: true };
    }),

  // Get all themes for a topic
  getThemes: publicProcedure
    .input(z.object({ topicId: z.number() }))
    .query(async ({ input }) => {
      return db.getTopicThemes(input.topicId);
    }),

  // Create a new viewpoint
  create: protectedProcedure
    .input(z.object({
      topicId: z.number(),
      parentId: z.number().nullable().optional(),
      title: z.string().min(1).max(512),
      content: z.string().optional()
    }))
    .mutation(async ({ ctx, input }) => {
      let depth = 0;
      if (input.parentId) {
        const parent = await db.getViewpointById(input.parentId);
        if (parent) {
          depth = parent.depth + 1;
        }
      }

      const viewpoint = await db.createViewpoint({
        topicId: input.topicId,
        parentId: input.parentId ?? null,
        authorId: ctx.user.id,
        title: input.title,
        content: input.content ?? null,
        depth
      });

      return viewpoint;
    }),
});

// ============ VOTE ROUTER ============
const voteRouter = router({
  // Get user's vote on a viewpoint
  getUserVote: protectedProcedure
    .input(z.object({ viewpointId: z.number() }))
    .query(async ({ ctx, input }) => {
      return db.getUserVote(ctx.user.id, input.viewpointId);
    }),

  // Cast a quadratic vote
  cast: protectedProcedure
    .input(z.object({
      viewpointId: z.number(),
      voteCount: z.number().min(-10).max(10)
    }))
    .mutation(async ({ ctx, input }) => {
      const user = await db.getUserById(ctx.user.id);
      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      const existingVote = await db.getUserVote(ctx.user.id, input.viewpointId);
      const previousCreditsSpent = existingVote?.creditsSpent || 0;
      const newCreditsNeeded = input.voteCount * input.voteCount;
      const creditsDelta = newCreditsNeeded - previousCreditsSpent;

      if (creditsDelta > user.votingCredits) {
        throw new TRPCError({ 
          code: "BAD_REQUEST", 
          message: `Not enough voting credits. Need ${creditsDelta}, have ${user.votingCredits}` 
        });
      }

      await db.updateUserVotingCredits(ctx.user.id, user.votingCredits - creditsDelta);

      const vote = await db.upsertVote({
        userId: ctx.user.id,
        viewpointId: input.viewpointId,
        voteCount: input.voteCount,
        creditsSpent: newCreditsNeeded
      });

      const viewpoint = await db.getViewpointById(input.viewpointId);
      if (viewpoint) {
        const allVotes = await db.getVotesByViewpoint(input.viewpointId);
        const totalVotes = allVotes.reduce((sum, v) => sum + v.voteCount, 0);
        await db.updateViewpointVotes(input.viewpointId, totalVotes);
      }

      return vote;
    }),

  // Get user's remaining credits
  getCredits: protectedProcedure
    .query(async ({ ctx }) => {
      const user = await db.getUserById(ctx.user.id);
      return { credits: user?.votingCredits ?? 100 };
    }),
});

// ============ COMMENT ROUTER ============
const commentRouter = router({
  // List comments for a viewpoint
  listByViewpoint: publicProcedure
    .input(z.object({ viewpointId: z.number() }))
    .query(async ({ input }) => {
      return db.listCommentsByViewpoint(input.viewpointId);
    }),

  // Create a comment
  create: protectedProcedure
    .input(z.object({
      viewpointId: z.number(),
      parentId: z.number().nullable().optional(),
      content: z.string().min(1)
    }))
    .mutation(async ({ ctx, input }) => {
      const comment = await db.createComment({
        viewpointId: input.viewpointId,
        parentId: input.parentId ?? null,
        authorId: ctx.user.id,
        content: input.content
      });
      return comment;
    }),
});

// ============ MAIN ROUTER ============
export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  topic: topicRouter,
  viewpoint: viewpointRouter,
  vote: voteRouter,
  comment: commentRouter,
});

export type AppRouter = typeof appRouter;
