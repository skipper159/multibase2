import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { ApiKey, CreateApiKeyRequest, CreateApiKeyResponse } from '../types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export function useApiKeys() {
  const { token } = useAuth();

  return useQuery({
    queryKey: ['apiKeys'],
    queryFn: async (): Promise<ApiKey[]> => {
      const response = await fetch(`${API_URL}/api/keys`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch API keys');
      }

      const data = await response.json();
      return data.keys;
    },
    enabled: !!token,
  });
}

export function useCreateApiKey() {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateApiKeyRequest): Promise<CreateApiKeyResponse> => {
      const response = await fetch(`${API_URL}/api/keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create API key');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apiKeys'] });
      toast.success('API key created successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}

export function useDeleteApiKey() {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`${API_URL}/api/keys/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to revoke API key');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apiKeys'] });
      queryClient.invalidateQueries({ queryKey: ['apiKeyStats'] });
      toast.success('API key revoked successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}

export interface ApiKeyStats {
  totalKeys: number;
  totalUsage: number;
  activeKeys: number;
  expiredKeys: number;
}

export function useApiKeyStats() {
  const { token } = useAuth();

  return useQuery({
    queryKey: ['apiKeyStats'],
    queryFn: async (): Promise<ApiKeyStats> => {
      const response = await fetch(`${API_URL}/api/keys/stats`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch API key stats');
      }

      return response.json();
    },
    enabled: !!token,
  });
}
