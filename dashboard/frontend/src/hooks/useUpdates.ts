/**
 * React Query hooks for the Update System.
 *
 * useUpdateStatus   — fetches GET /api/updates/status (cached 5 min on server side; no background polling)
 * useCheckUpdates   — forces a fresh check via POST /api/updates/check
 * useUpdateMultibase — triggers a Multibase self-update
 * useUpdateDocker   — triggers Docker image pulls for shared services
 * useUpdateLogs     — subscribes to live Socket.IO update events
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { io, Socket } from 'socket.io-client';
import { updatesApi, UpdateStatus, DockerUpdateRequest } from '../lib/api';

const SOCKET_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ──────────────────────────────────────────────
// Query Keys
// ──────────────────────────────────────────────

export const updateKeys = {
  all: ['updates'] as const,
  status: () => [...updateKeys.all, 'status'] as const,
};

// ──────────────────────────────────────────────
// Queries
// ──────────────────────────────────────────────

export const useUpdateStatus = () =>
  useQuery<UpdateStatus>({
    queryKey: updateKeys.status(),
    queryFn: updatesApi.getStatus,
    staleTime: 1000 * 60 * 5, // 5 minutes – mirrors server-side cache
    retry: 1,
  });

// ──────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────

export const useCheckUpdates = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updatesApi.check,
    onSuccess: (data) => {
      queryClient.setQueryData(updateKeys.status(), data);
    },
  });
};

export const useUpdateMultibase = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updatesApi.updateMultibase,
    onSuccess: () => {
      // Status will be re-fetched once server comes back up after PM2 restart
      setTimeout(() => queryClient.invalidateQueries({ queryKey: updateKeys.all }), 15_000);
    },
  });
};

export const useUpdateDocker = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: DockerUpdateRequest) =>
      updatesApi.updateDocker(request.services, {
        confirmSafetyGate: request.confirmSafetyGate,
        createBackup: request.createBackup,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: updateKeys.all });
    },
  });
};

export const useUpdatePostgres = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updatesApi.updatePostgres,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: updateKeys.all });
    },
  });
};

// ──────────────────────────────────────────────
// Socket.IO live log hook
// ──────────────────────────────────────────────

export interface UpdateLogEntry {
  line: string;
  ts: number;
}

export interface UpdateProgress {
  step: string;
  index: number;
  total: number;
}

export interface UpdateBackupInfo {
  id: string;
  name: string;
  type: string;
  path: string;
  size: number;
  createdAt: string;
}

export interface ImageUpdateResult {
  service: string;
  status: 'updated' | 'rolled_back' | 'rollback_failed' | 'skipped';
  previousTag?: string;
  targetTag?: string;
  error?: string;
}

export interface UpdateLiveState {
  isRunning: boolean;
  type: 'multibase' | 'docker' | 'tenantDocker' | null;
  mode: 'update' | 'rollback' | null;
  steps: string[];
  currentStep: number;
  logs: UpdateLogEntry[];
  error: string | null;
  completed: boolean;
  outcome: 'success' | 'partial' | 'failed' | null;
  serviceResults: Record<string, ImageUpdateResult>;
  backup: UpdateBackupInfo | null;
  clearLogs: () => void;
}

export const useUpdateLogs = (): UpdateLiveState => {
  const [isRunning, setIsRunning] = useState(false);
  const [type, setType] = useState<'multibase' | 'docker' | 'tenantDocker' | null>(null);
  const [mode, setMode] = useState<'update' | 'rollback' | null>(null);
  const [steps, setSteps] = useState<string[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [logs, setLogs] = useState<UpdateLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [outcome, setOutcome] = useState<'success' | 'partial' | 'failed' | null>(null);
  const [serviceResults, setServiceResults] = useState<Record<string, ImageUpdateResult>>({});
  const [backup, setBackup] = useState<UpdateBackupInfo | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const clearLogs = useCallback(() => {
    setLogs([]);
    setError(null);
    setCompleted(false);
    setOutcome(null);
    setServiceResults({});
    setIsRunning(false);
    setType(null);
    setMode(null);
    setSteps([]);
    setCurrentStep(0);
    setBackup(null);
  }, []);

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      path: '/socket.io/',
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('update:start', (data: { type: 'multibase' | 'docker' | 'tenantDocker'; mode?: 'update' | 'rollback'; steps?: string[]; services?: string[] }) => {
      setIsRunning(true);
      setCompleted(false);
      setOutcome(null);
      setServiceResults({});
      setError(null);
      setType(data.type);
      setMode(data.mode ?? 'update');
      setSteps(data.steps || data.services || []);
      setCurrentStep(0);
      setLogs([]);
      setBackup(null);
    });

    socket.on('update:step', (data: UpdateProgress) => {
      setCurrentStep(data.index);
    });

    socket.on('update:log', (data: { line: string }) => {
      setLogs((prev) => [...prev, { line: data.line, ts: Date.now() }]);
    });

    socket.on('update:backup', (data: UpdateBackupInfo) => {
      setBackup(data);
    });

    socket.on('update:serviceResult', (data: ImageUpdateResult) => {
      setServiceResults((previous) => ({ ...previous, [data.service]: data }));
    });

    socket.on('update:complete', (data?: {
      outcome?: 'success' | 'partial' | 'failed';
      results?: ImageUpdateResult[];
    }) => {
      setIsRunning(false);
      setCompleted(true);
      setOutcome(data?.outcome ?? 'success');
      if (data?.results) {
        setServiceResults(Object.fromEntries(data.results.map((result) => [result.service, result])));
      }
    });

    socket.on('update:error', (data: { error: string }) => {
      setIsRunning(false);
      setError(data.error);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  return {
    isRunning, type, mode, steps, currentStep, logs, error, completed, outcome,
    serviceResults, backup, clearLogs,
  };
};
