/**
 * React Query Hooks for Shared Infrastructure (Cloud-Version)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sharedApi } from '../lib/api';
import { toast } from 'sonner';

// =====================================================
// Queries
// =====================================================

/**
 * Get shared infrastructure status (auto-refresh every 15s)
 */
export const useSharedStatus = () =>
  useQuery({
    queryKey: ['shared', 'status'],
    queryFn: sharedApi.getStatus,
    refetchInterval: 15000,
    retry: 1,
  });

/**
 * Get all project databases in the shared cluster
 */
export const useSharedDatabases = () =>
  useQuery({
    queryKey: ['shared', 'databases'],
    queryFn: sharedApi.getDatabases,
    refetchInterval: 30000,
  });

/**
 * Get recent logs for all shared services or one selected service.
 */
export const useSharedLogs = (service?: string, tail = 500, enabled = false) =>
  useQuery({
    queryKey: ['shared', 'logs', service, tail],
    queryFn: () => sharedApi.getLogs(service, tail),
    enabled: enabled,
    refetchInterval: enabled ? 15000 : false,
  });

/**
 * Restart one shared infrastructure service.
 */
export const useRestartSharedService = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (service: string) => sharedApi.restartService(service),
    onSuccess: (_, service) => {
      queryClient.invalidateQueries({ queryKey: ['shared'] });
      toast.success(`${service} restarted`);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to restart shared service');
    },
  });
};

// =====================================================
// Mutations
// =====================================================

/**
 * Start shared infrastructure
 */
export const useStartSharedInfra = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: sharedApi.start,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shared'] });
    },
  });
};

/**
 * Stop shared infrastructure
 */
export const useStopSharedInfra = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: sharedApi.stop,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shared'] });
    },
  });
};

/**
 * Create a project database
 */
export const useCreateDatabase = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (projectName: string) => sharedApi.createDatabase(projectName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shared', 'databases'] });
    },
  });
};

/**
 * Delete a project database
 */
export const useDeleteDatabase = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => sharedApi.deleteDatabase(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shared', 'databases'] });
    },
  });
};
