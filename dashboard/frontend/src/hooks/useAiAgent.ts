import { useState, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface AiMessage {
  id?: number;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  createdAt?: string;
}

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

interface ToolResult {
  toolCallId: string;
  name: string;
  result: any;
}

interface StreamChunk {
  type: 'text' | 'tool_call' | 'tool_result' | 'done' | 'error';
  content?: string;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  error?: string;
}

interface AiSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  _count?: { messages: number };
}

interface AiKeyStatus {
  configured: boolean;
  provider: string | null;
  model: string | null;
}

function getAuthHeaders() {
  const token = localStorage.getItem('auth_token'); // Key used in AuthContext
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

// ============================================================
// API Key Status
// ============================================================

export function useAiKeyStatus() {
  return useQuery<AiKeyStatus>({
    queryKey: ['ai-key-status'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/ai-agent/api-key/status`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to get AI key status');
      return res.json();
    },
  });
}

export function useSaveAiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      provider,
      apiKey,
      model,
    }: {
      provider: string;
      apiKey: string;
      model?: string;
    }) => {
      const res = await fetch(`${API_URL}/api/ai-agent/api-key`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ provider, apiKey, model }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save API key');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-key-status'] });
    },
  });
}

export function useDeleteAiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_URL}/api/ai-agent/api-key`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to delete API key');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-key-status'] });
    },
  });
}

// ============================================================
// Sessions
// ============================================================

export function useAiSessions() {
  return useQuery<AiSession[]>({
    queryKey: ['ai-sessions'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/ai-agent/sessions`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to list sessions');
      const data = await res.json();
      return data.sessions;
    },
  });
}

export function useCreateAiSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_URL}/api/ai-agent/sessions`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to create session');
      const data = await res.json();
      return data.session as AiSession;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-sessions'] });
    },
  });
}

export function useDeleteAiSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await fetch(`${API_URL}/api/ai-agent/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to delete session');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-sessions'] });
    },
  });
}

export function useAiSessionMessages(sessionId: string | null) {
  return useQuery<AiMessage[]>({
    queryKey: ['ai-session-messages', sessionId],
    queryFn: async () => {
      if (!sessionId) return [];
      const res = await fetch(`${API_URL}/api/ai-agent/sessions/${sessionId}`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to get session');
      const data = await res.json();
      return (data.session.messages || []).map((m: any) => ({
        ...m,
        toolCalls: m.toolCalls ? JSON.parse(m.toolCalls) : undefined,
        toolResults: m.toolResults ? JSON.parse(m.toolResults) : undefined,
      }));
    },
    enabled: !!sessionId,
  });
}

// ============================================================
// Chat (SSE)
// ============================================================

export function useAiModels() {
  return useQuery<{ id: string; name: string }[]>({
    queryKey: ['ai-models'],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/ai-agent/models`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to list models');
      const data = await res.json();
      return data.models;
    },
    staleTime: 1000 * 60 * 60, // 1 hour
  });
}

export function useAiChat() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState<string>('');
  const [pendingToolCalls, setPendingToolCalls] = useState<ToolCall[]>([]);
  const [toolResults, setToolResults] = useState<ToolResult[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();

  const processStream = useCallback(async (res: Response) => {
    if (!res.body) throw new Error('No response body');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          let chunk: StreamChunk;
          try {
            chunk = JSON.parse(data);
          } catch {
            // Ignore malformed SSE payloads, but never swallow application errors.
            continue;
          }

          switch (chunk.type) {
              case 'text':
                if (chunk.content) {
                  setStreamingMessage(chunk.content);
                }
                break;
              case 'tool_call':
                if (chunk.toolCall) {
                  setPendingToolCalls((prev) => [...prev, chunk.toolCall!]);
                }
                break;
              case 'tool_result':
                if (chunk.toolResult) {
                  setToolResults((prev) => [...prev, chunk.toolResult!]);
                }
                break;
              case 'error':
                throw new Error(chunk.error || 'AI error');
              case 'done':
                break;
          }
        }
      }
    }
  }, []);

  // ... existing code ...

  const sendMessage = useCallback(
    async (sessionId: string, message: string, file?: File, model?: string) => {
      setIsStreaming(true);
      setStreamingMessage('');
      setPendingToolCalls([]);
      setToolResults([]);

      const abortController = new AbortController();
      abortRef.current = abortController;

      try {
        let body: any = { sessionId, message };

        if (model) {
          body.model = model;
        }

        if (file) {
          // Convert to base64
          const base64Promise = new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = (error) => reject(error);
          });
          const base64Data = await base64Promise;
          body.image = base64Data;
        }

        const res = await fetch(`${API_URL}/api/ai-agent/chat`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify(body),
          signal: abortController.signal,
        });

        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.error || 'Chat failed');
        }

        await processStream(res);
      } catch (error: any) {
        if (error.name !== 'AbortError') {
          setStreamingMessage(`**Error:** ${error.message}`);
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
        // Refresh messages & sessions
        queryClient.invalidateQueries({ queryKey: ['ai-session-messages', sessionId] });
        queryClient.invalidateQueries({ queryKey: ['ai-sessions'] });
      }
    },
    [queryClient, processStream]
  );

  const confirmTool = useCallback(
    async (sessionId: string, toolCall: ToolCall) => {
      setIsStreaming(true);
      // Don't clear previous streaming message as we are continuing
      // But actually, streamingMessage is transient for the CURRENT turn.
      // The previous turn is already in 'messages'.
      setStreamingMessage('');

      const abortController = new AbortController();
      abortRef.current = abortController;

      try {
        const res = await fetch(`${API_URL}/api/ai-agent/confirm-tool`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ sessionId, toolCall }),
          signal: abortController.signal,
        });

        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.error || 'Failed to confirm tool');
        }

        // Remove from pending immediately to update UI
        setPendingToolCalls((prev) => prev.filter((tc) => tc.id !== toolCall.id));

        await processStream(res);
      } catch (error: any) {
        console.error('Error confirming tool:', error);
        toast.error(error.message || 'Tool execution failed');
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
        queryClient.invalidateQueries({ queryKey: ['ai-session-messages', sessionId] });
      }
    },
    [queryClient, processStream]
  );

  const confirmBatchTools = useCallback(
    async (sessionId: string, toolCalls: ToolCall[]) => {
      setIsStreaming(true);
      setStreamingMessage(''); // Clear any previous streaming message

      const abortController = new AbortController();
      abortRef.current = abortController;

      try {
        const res = await fetch(`${API_URL}/api/ai-agent/confirm-tools`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ sessionId, toolCalls }),
          signal: abortController.signal,
        });

        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.error || 'Failed to confirm tools');
        }

        // Remove confirmed tools from pending immediately
        const confirmedIds = new Set(toolCalls.map((tc) => tc.id));
        setPendingToolCalls((prev) => prev.filter((tc) => !confirmedIds.has(tc.id)));

        await processStream(res);
      } catch (error: any) {
        console.error('Error confirming tools:', error);
        toast.error(error.message || 'Batch execution failed');
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
        queryClient.invalidateQueries({ queryKey: ['ai-session-messages', sessionId] });
      }
    },
    [queryClient, processStream]
  );

  const cancelStream = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return {
    sendMessage,
    confirmTool,
    confirmBatchTools,
    cancelStream,
    isStreaming,
    streamingMessage,
    pendingToolCalls,
    toolResults,
  };
}

export type { AiMessage, ToolCall, ToolResult, StreamChunk, AiSession, AiKeyStatus };
