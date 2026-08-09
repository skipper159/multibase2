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

export function useSqlDumps() {
  return useQuery({
    queryKey: ['migrations', 'dumps'],
    queryFn: migrationsApi.listDumps,
    staleTime: 1000 * 10,
  });
}

export function useDeleteSqlDump() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: migrationsApi.deleteDump,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['migrations', 'dumps'] });
      toast.success('SQL dump deleted successfully');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to delete SQL dump');
    },
  });
}

export function useBulkDeleteSqlDumps() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: migrationsApi.bulkDeleteDumps,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['migrations', 'dumps'] });
      toast.success(`Deleted ${data.deleted} SQL dump(s)`);
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to delete SQL dumps');
    },
  });
}

export function useUploadSqlDump() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ filename, content }: { filename: string; content: string }) =>
      migrationsApi.uploadDump(filename, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['migrations', 'dumps'] });
      toast.success('SQL dump uploaded successfully');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to upload SQL dump');
    },
  });
}

export function useApplySqlDump() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ filename, instanceId }: { filename: string; instanceId: string }) =>
      migrationsApi.applyDump(filename, instanceId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['instances'] });
      toast.success(`Applied SQL dump ${variables.filename} to ${variables.instanceId}`);
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to apply SQL dump');
    },
  });
}

