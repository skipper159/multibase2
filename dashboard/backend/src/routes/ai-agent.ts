import { Router, Request, Response } from 'express';
import { AiAgentService, StreamChunk } from '../services/AiAgentService';
import { encrypt, decrypt } from '../utils/AiEncryption';
import AuthService from '../services/AuthService';
import { logger } from '../utils/logger';
import { PrismaClient } from '@prisma/client';
import { requireScope } from '../middleware/requireScope';
import { SCOPES } from '../constants/scopes';
import { auditLog } from '../middleware/auditLog';

export function createAiAgentRoutes(aiAgentService: AiAgentService, prisma: PrismaClient) {
  const router = Router();

  // Rate limit tracking (simple in-memory)
  const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
  const RATE_LIMIT = 50; // messages per hour
  const RATE_WINDOW = 60 * 60 * 1000; // 1 hour

  function checkRateLimit(userId: string): boolean {
    const now = Date.now();
    const entry = rateLimitMap.get(userId);

    if (!entry || now > entry.resetAt) {
      rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_WINDOW });
      return true;
    }

    if (entry.count >= RATE_LIMIT) {
      return false;
    }

    entry.count++;
    return true;
  }

  // Helper to get authenticated user
  async function getAuthUser(req: Request): Promise<any> {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return null;
    const session = await AuthService.validateSession(token);
    return session?.user || null;
  }

  // =====================================================
  // AI API Key Management
  // =====================================================

  /**
   * GET /api/ai-agent/api-key/status
   * Check if user has an AI API key configured
   */
  router.get('/api-key/status', requireScope(SCOPES.AI_AGENT.READ), async (req: Request, res: Response): Promise<any> => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { aiProvider: true, aiApiKeyEncrypted: true, aiModel: true },
      });

      res.json({
        configured: !!(dbUser?.aiProvider && dbUser?.aiApiKeyEncrypted),
        provider: dbUser?.aiProvider || null,
        model: dbUser?.aiModel || null,
      });
    } catch (error) {
      logger.error('Error getting AI key status:', error);
      res.status(500).json({ error: 'Failed to get AI key status' });
    }
  });

  /**
   * PUT /api/ai-agent/api-key
   * Save AI provider and API key
   */
  router.put('/api-key', requireScope(SCOPES.AI_AGENT.USE), auditLog('AI_KEY_SAVE', { includeBody: false }), async (req: Request, res: Response): Promise<any> => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      (req as any).user = user;

      const { provider, apiKey, model } = req.body;

      if (!provider || !apiKey) {
        return res.status(400).json({ error: 'Provider and apiKey are required' });
      }

      if (!['openai', 'gemini', 'anthropic', 'openrouter'].includes(provider)) {
        return res
          .status(400)
          .json({ error: 'Invalid provider. Must be openai, gemini, anthropic, or openrouter' });
      }

      const encrypted = encrypt(apiKey);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          aiProvider: provider,
          aiApiKeyEncrypted: encrypted,
          aiModel: model || null,
        },
      });

      res.json({ message: 'AI configuration saved successfully', provider, model });
    } catch (error) {
      logger.error('Error saving AI key:', error);
      res.status(500).json({ error: 'Failed to save AI API key' });
    }
  });

  /**
   * DELETE /api/ai-agent/api-key
   * Remove AI API key
   */
  router.delete('/api-key', requireScope(SCOPES.AI_AGENT.USE), auditLog('AI_KEY_DELETE'), async (req: Request, res: Response): Promise<any> => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      (req as any).user = user;

      await prisma.user.update({
        where: { id: user.id },
        data: {
          aiProvider: null,
          aiApiKeyEncrypted: null,
          aiModel: null,
        },
      });

      res.json({ message: 'AI API key removed successfully' });
    } catch (error) {
      logger.error('Error removing AI key:', error);
      res.status(500).json({ error: 'Failed to remove AI API key' });
    }
  });

  // =====================================================
  // Chat Sessions
  // =====================================================

  /**
   * GET /api/ai-agent/sessions
   * List chat sessions
   */
  router.get('/sessions', requireScope(SCOPES.AI_AGENT.READ), async (req: Request, res: Response): Promise<any> => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const sessions = await aiAgentService.getSessions(user.id);
      res.json({ sessions });
    } catch (error) {
      logger.error('Error listing sessions:', error);
      res.status(500).json({ error: 'Failed to list sessions' });
    }
  });

  /**
   * POST /api/ai-agent/sessions
   * Create new chat session
   */
  router.post('/sessions', requireScope(SCOPES.AI_AGENT.USE), async (req: Request, res: Response): Promise<any> => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const session = await aiAgentService.createSession(user.id);
      res.json({ session });
    } catch (error) {
      logger.error('Error creating session:', error);
      res.status(500).json({ error: 'Failed to create session' });
    }
  });

  /**
   * GET /api/ai-agent/sessions/:id
   * Get session with messages
   */
  router.get('/sessions/:id', requireScope(SCOPES.AI_AGENT.READ), async (req: Request, res: Response): Promise<any> => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const session = await aiAgentService.getSession(req.params.id, user.id);
      res.json({ session });
    } catch (error) {
      logger.error('Error getting session:', error);
      res.status(500).json({ error: 'Failed to get session' });
    }
  });

  /**
   * DELETE /api/ai-agent/sessions/:id
   * Delete a chat session
   */
  router.delete('/sessions/:id', requireScope(SCOPES.AI_AGENT.USE), async (req: Request, res: Response): Promise<any> => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      await aiAgentService.deleteSession(req.params.id, user.id);
      res.json({ message: 'Session deleted' });
    } catch (error) {
      logger.error('Error deleting session:', error);
      res.status(500).json({ error: 'Failed to delete session' });
    }
  });

  // =====================================================
  // Chat (SSE Streaming)
  // =====================================================

  /**
   * GET /api/ai-agent/models
   * Get available models for the configured provider
   */
  router.get('/models', requireScope(SCOPES.AI_AGENT.READ), async (req: Request, res: Response): Promise<any> => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const config = await aiAgentService.getUserAiConfig(user.id);
      if (!config) {
        return res.json({ models: [] });
      }

      let models: { id: string; name: string }[] = [];

      switch (config.provider) {
        case 'openai':
          models = [
            { id: 'gpt-5.5', name: 'GPT-5.5' },
            { id: 'gpt-5.4', name: 'GPT-5.4' },
            { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini' },
            { id: 'gpt-5.4-nano', name: 'GPT-5.4 Nano' },
            { id: 'gpt-5-mini', name: 'GPT-5 Mini' },
            { id: 'gpt-5-nano', name: 'GPT-5 Nano' },
            { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
            { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
            { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna' },
          ];
          break;
        case 'anthropic':
          models = [
            { id: 'claude-fable-5', name: 'Claude Fable 5' },
            { id: 'claude-opus-5', name: 'Claude Opus 5' },
            { id: 'claude-sonnet-5', name: 'Claude Sonnet 5' },
            { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
            { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
            { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' },
            { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku' },
          ];
          break;
        case 'gemini':
          models = [
            { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash' },
            { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash' },
            { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite' },
            { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro' },
            { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
            { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
            { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
            { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
            { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
          ];
          break;
        case 'openrouter':
          try {
            const response = await fetch('https://openrouter.ai/api/v1/models');
            if (response.ok) {
              const data = (await response.json()) as any;
              if (data && data.data) {
                models = data.data
                  .map((m: any) => ({
                    id: m.id,
                    name: m.name,
                  }))
                  .sort((a: any, b: any) => a.name.localeCompare(b.name));
              }
            }
          } catch (error) {
            logger.error('Failed to fetch OpenRouter models:', error);
          }
          break;
      }

      res.json({ models });
    } catch (error) {
      logger.error('Error fetching models:', error);
      res.status(500).json({ error: 'Failed to fetch models' });
    }
  });

  /**
   * POST /api/ai-agent/chat
   * Send a message and receive SSE streaming response
   */
  router.post('/chat', requireScope(SCOPES.AI_AGENT.USE), async (req: Request, res: Response): Promise<any> => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      // Rate limiting
      if (!checkRateLimit(user.id)) {
        return res.status(429).json({ error: 'Rate limit exceeded. Max 50 messages per hour.' });
      }

      const { sessionId, message, image, model } = req.body;

      if (!sessionId || !message) {
        return res.status(400).json({ error: 'sessionId and message are required' });
      }

      // Verify session belongs to user
      try {
        await aiAgentService.getSession(sessionId, user.id);
      } catch {
        return res.status(404).json({ error: 'Session not found' });
      }

      // Set up SSE
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

      const sendEvent = (data: StreamChunk) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      try {
        await aiAgentService.chat(user.id, sessionId, message, sendEvent, image, model);
      } catch (chatError: any) {
        sendEvent({ type: 'error', error: chatError.message });
      }

      res.write('data: [DONE]\n\n');
      res.end();
    } catch (error) {
      logger.error('Error in chat route:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Chat failed' });
      }
    }
  });

  /**
   * POST /api/ai-agent/confirm-tool
   * Confirm and execute a destructive tool call, then continue chat
   */
  router.post('/confirm-tool', requireScope(SCOPES.AI_AGENT.USE), auditLog('AI_TOOL_CONFIRM', { includeBody: true, getResource: (req) => req.body?.toolCall?.name || 'unknown' }), async (req: Request, res: Response): Promise<any> => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      (req as any).user = user;

      const { sessionId, toolCall } = req.body;

      if (!sessionId || !toolCall) {
        return res.status(400).json({ error: 'sessionId and toolCall are required' });
      }

      // Verify session belongs to user
      try {
        await aiAgentService.getSession(sessionId, user.id);
      } catch {
        return res.status(404).json({ error: 'Session not found' });
      }

      // Set up SSE
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      const sendEvent = (data: StreamChunk) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      try {
        // 1. Execute the tool
        const result = await aiAgentService.executeConfirmedTool(user.id, sessionId, toolCall);

        // Send the result to client immediately so UI updates
        sendEvent({
          type: 'tool_result',
          toolResult: { toolCallId: toolCall.id, name: toolCall.name, result },
        });

        // 2. Continue the chat (AI responds to the tool result)
        await aiAgentService.continueChat(user.id, sessionId, sendEvent);
      } catch (execError: any) {
        logger.error('Tool execution error:', execError);
        sendEvent({
          type: 'tool_result',
          toolResult: {
            toolCallId: toolCall.id,
            name: toolCall.name,
            result: { error: execError.message },
          },
        });
        // We still continue chat so AI knows it failed
        await aiAgentService.continueChat(user.id, sessionId, sendEvent);
      }

      res.write('data: [DONE]\n\n');
      res.end();
    } catch (error) {
      logger.error('Error in confirm-tool route:', error);
      if (!res.headersSent) res.status(500).json({ error: 'Tool confirmation failed' });
    }
  });

  /**
   * POST /api/ai-agent/confirm-tools
   * Confirm and execute MULTIPLE destructive tool calls, then continue chat ONCE
   */
  router.post('/confirm-tools', requireScope(SCOPES.AI_AGENT.USE), auditLog('AI_TOOLS_CONFIRM', { includeBody: true }), async (req: Request, res: Response): Promise<any> => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      (req as any).user = user;

      const { sessionId, toolCalls } = req.body;

      if (!sessionId || !toolCalls || !Array.isArray(toolCalls)) {
        return res.status(400).json({ error: 'sessionId and toolCalls array are required' });
      }

      // Verify session belongs to user
      try {
        await aiAgentService.getSession(sessionId, user.id);
      } catch {
        return res.status(404).json({ error: 'Session not found' });
      }

      // Set up SSE
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      const sendEvent = (data: StreamChunk) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      try {
        // 1. Execute ALL tools
        // We do this sequentially or in parallel?
        // Service handles execution and returns array of results
        const results = await aiAgentService.executeConfirmedTools(user.id, sessionId, toolCalls);

        // Send ALL results to client immediately so UI updates
        for (const result of results) {
          sendEvent({
            type: 'tool_result',
            toolResult: result,
          });
        }

        // 2. Continue the chat ONCE (AI responds to all tool results)
        await aiAgentService.continueChat(user.id, sessionId, sendEvent);
      } catch (execError: any) {
        logger.error('Batch tool execution error:', execError);
        sendEvent({ type: 'error', error: execError.message });
      }

      res.write('data: [DONE]\n\n');
      res.end();
    } catch (error) {
      logger.error('Error in confirm-tools route:', error);
      if (!res.headersSent) res.status(500).json({ error: 'Batch confirmation failed' });
    }
  });

  return router;
}
