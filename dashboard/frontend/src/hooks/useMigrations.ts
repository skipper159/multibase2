import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { migrationsApi } from '../lib/api';
import { toast } from 'sonner';

export interface MigrationHistoryItem {
  id: string;
  instanceId: string;
  sql: string;
  success: boolean;
  rowsAffected: number;
  error?: string;
  executedAt: string;
  executedBy: string;
}

export interface SqlTemplate {
  id?: number | string;
  name: string;
  description: string;
  sql: string;
  category?: 'system' | 'custom';
}

export function useMigrationHistory(instanceId?: string) {
  return useQuery({
    queryKey: ['migrations', 'history', instanceId],
    queryFn: () => migrationsApi.getHistory(instanceId),
    staleTime: 1000 * 30, // 30 seconds
  });
}

export function useMigrationTemplates() {
  return useQuery({
    queryKey: ['migrations', 'templates'],
    queryFn: migrationsApi.getTemplates,
    staleTime: 1000 * 60 * 60, // 1 hour
  });
}

export function useCreateTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: migrationsApi.createTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['migrations', 'templates'] });
      toast.success('Template created successfully');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to create template');
    },
  });
}

export function useDeleteTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: migrationsApi.deleteTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['migrations', 'templates'] });
      toast.success('Template deleted successfully');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to delete template');
    },
  });
}

export function useExecuteMigration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: migrationsApi.execute,
    onSuccess: (data) => {
      // Invalidate history query to show new migration
      queryClient.invalidateQueries({ queryKey: ['migrations', 'history'] });

      if (!data.dryRun) {
        toast.success('Migration executed successfully');
      } else {
        toast.success('Dry run validation successful');
      }
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to execute migration');
    },
  });
}

export function useValidateSql() {
  return useMutation({
    mutationFn: migrationsApi.validate,
    onError: (error: any) => {
      // Usually we handle validation errors inline, but global error toast if network fails
      toast.error(error.message || 'Failed to validate SQL');
    },
  });
}
