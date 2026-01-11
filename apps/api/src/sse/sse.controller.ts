/**
 * @file sse.controller.ts
 * @description SSE endpoint: GET /v1/sse/:topicId
 */
import { Controller, Get, Headers, Param, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { SseService } from './sse.service.js';
import { TopicPrivacyGuard } from '../topic/topic-privacy.guard.js';

@Controller('v1/sse')
export class SseController {
  constructor(private readonly sseService: SseService) {}

  @Get(':topicId')
  @UseGuards(TopicPrivacyGuard)
  async subscribe(
    @Param('topicId') topicId: string,
    @Headers('last-event-id') lastEventId: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const abortController = new AbortController();
    req.once('close', () => abortController.abort());

    try {
      for await (const chunk of this.sseService.streamTopicEvents({
        topicId,
        lastEventId,
        signal: abortController.signal,
      })) {
        res.write(chunk);
      }
    } catch {
      // Ignore errors during disconnect (e.g., aborted request)
    } finally {
      res.end();
    }
  }
}
