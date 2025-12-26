// API Client for Multibase Dashboard

import type {
  SupabaseInstance,
  CreateInstanceRequest,
  SystemMetrics,
  ResourceMetrics,
  HealthStatus,
  Alert,
  AlertStats,
  CreateAlertRuleRequest,
  InstanceTemplate,
  SystemTemplate,
} from '../types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// Generic fetch helper
async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('auth_token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options?.headers,
  };

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || `HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

// Instances API
export const instancesApi = {
  list: (): Promise<SupabaseInstance[]> => {
    return fetchApi<SupabaseInstance[]>('/api/instances');
  },

  get: (name: string): Promise<SupabaseInstance> => {
    return fetchApi<SupabaseInstance>(`/api/instances/${name}`);
  },

  create: (data: CreateInstanceRequest): Promise<SupabaseInstance> => {
    return fetchApi<SupabaseInstance>('/api/instances', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  start: (name: string): Promise<{ message: string }> => {
    return fetchApi<{ message: string }>(`/api/instances/${name}/start`, {
      method: 'POST',
    });
  },

  stop: (name: string): Promise<{ message: string }> => {
    return fetchApi<{ message: string }>(`/api/instances/${name}/stop`, {
      method: 'POST',
    });
  },

  restart: (name: string): Promise<{ message: string }> => {
    return fetchApi<{ message: string }>(`/api/instances/${name}/restart`, {
      method: 'POST',
    });
  },

  delete: (name: string, removeVolumes?: boolean): Promise<{ message: string }> => {
    const query = removeVolumes ? '?removeVolumes=true' : '';
    return fetchApi<{ message: string }>(`/api/instances/${name}${query}`, {
      method: 'DELETE',
    });
  },

  restartService: (name: string, service: string): Promise<{ message: string }> => {
    return fetchApi<{ message: string }>(`/api/instances/${name}/services/${service}/restart`, {
      method: 'POST',
    });
  },

  updateSmtp: (name: string, data: any): Promise<void> => {
    return fetchApi<void>(`/api/instances/${name}/smtp`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },
};

// Health API
export const healthApi = {
  get: (name: string): Promise<HealthStatus> => {
    return fetchApi<HealthStatus>(`/api/health/${name}`);
  },

  getSystem: (): Promise<SystemMetrics> => {
    return fetchApi<SystemMetrics>('/api/health/system');
  },

  refresh: (name: string): Promise<HealthStatus> => {
    return fetchApi<HealthStatus>(`/api/health/${name}/refresh`, {
      method: 'POST',
    });
  },
};

// Metrics API
export const metricsApi = {
  get: (name: string): Promise<ResourceMetrics> => {
    return fetchApi<ResourceMetrics>(`/api/metrics/instances/${name}`);
  },

  getInstance: (name: string): Promise<ResourceMetrics> => {
    return fetchApi<ResourceMetrics>(`/api/metrics/instances/${name}`);
  },

  getHistory: (name: string, params?: { hours?: number }): Promise<ResourceMetrics[]> => {
    const query = params?.hours ? `?hours=${params.hours}` : '';
    return fetchApi<ResourceMetrics[]>(`/api/metrics/instances/${name}/history${query}`);
  },

  getSystem: (): Promise<SystemMetrics> => {
    return fetchApi<SystemMetrics>('/api/metrics/system');
  },
};

// Logs API
export const logsApi = {
  get: (
    name: string,
    params?: {
      service?: string;
      lines?: number;
      since?: string;
    }
  ): Promise<{ logs: string[] }> => {
    const query = new URLSearchParams();
    if (params?.service) query.set('service', params.service);
    if (params?.lines) query.set('lines', params.lines.toString());
    if (params?.since) query.set('since', params.since);

    const queryString = query.toString();
    return fetchApi<{ logs: string[] }>(
      `/api/logs/instances/${name}${queryString ? `?${queryString}` : ''}`
    );
  },

  getInstance: (name: string, tail?: number): Promise<{ logs: string[] }> => {
    const query = tail ? `?tail=${tail}` : '';
    return fetchApi<{ logs: string[] }>(`/api/logs/instances/${name}${query}`);
  },

  getService: (name: string, service: string, tail?: number): Promise<{ logs: string[] }> => {
    const query = tail ? `?tail=${tail}` : '';
    return fetchApi<{ logs: string[] }>(`/api/logs/instances/${name}/services/${service}${query}`);
  },

  stream: (name: string, service?: string): EventSource => {
    const query = service ? `?service=${service}` : '';
    return new EventSource(`${API_BASE_URL}/api/logs/instances/${name}/stream${query}`);
  },
};

// Alerts API
export const alertsApi = {
  list: (params?: {
    status?: string;
    instanceId?: string;
    rule?: string;
    limit?: number;
  }): Promise<Alert[]> => {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.instanceId) query.set('instanceId', params.instanceId);
    if (params?.rule) query.set('rule', params.rule);
    if (params?.limit) query.set('limit', params.limit.toString());

    const queryString = query.toString();
    return fetchApi<Alert[]>(`/api/alerts${queryString ? `?${queryString}` : ''}`);
  },

  get: (id: number): Promise<Alert> => {
    return fetchApi<Alert>(`/api/alerts/${id}`);
  },

  acknowledge: (id: number): Promise<Alert> => {
    return fetchApi<Alert>(`/api/alerts/${id}/acknowledge`, {
      method: 'POST',
    });
  },

  resolve: (id: number): Promise<Alert> => {
    return fetchApi<Alert>(`/api/alerts/${id}/resolve`, {
      method: 'POST',
    });
  },

  getStats: (instanceId?: string): Promise<AlertStats> => {
    const query = instanceId ? `?instanceId=${instanceId}` : '';
    return fetchApi<AlertStats>(`/api/alerts/stats${query}`);
  },

  getRules: (params?: { instanceId?: string; enabled?: boolean }): Promise<any[]> => {
    const query = new URLSearchParams();
    if (params?.instanceId) query.set('instanceId', params.instanceId);
    if (params?.enabled !== undefined) query.set('enabled', params.enabled.toString());

    const queryString = query.toString();
    return fetchApi<any[]>(`/api/alerts/rules${queryString ? `?${queryString}` : ''}`);
  },

  createRule: (data: CreateAlertRuleRequest): Promise<any> => {
    return fetchApi<any>('/api/alerts/rules', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateRule: (id: number, data: Partial<CreateAlertRuleRequest>): Promise<any> => {
    return fetchApi<any>(`/api/alerts/rules/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  deleteRule: (id: number): Promise<{ message: string }> => {
    return fetchApi<{ message: string }>(`/api/alerts/rules/${id}`, {
      method: 'DELETE',
    });
  },
};

// Templates API
export const templatesApi = {
  list: (): Promise<{ templates: InstanceTemplate[] }> => {
    return fetchApi<{ templates: InstanceTemplate[] }>('/api/templates');
  },

  getSystemTemplate: (): Promise<SystemTemplate> => {
    return fetchApi<SystemTemplate>('/api/templates/system');
  },

  create: (data: {
    name: string;
    description?: string;
    config: any;
    isPublic?: boolean;
  }): Promise<InstanceTemplate> => {
    return fetchApi<InstanceTemplate>('/api/templates', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  update: (
    id: number,
    data: { name?: string; description?: string; config?: any; isPublic?: boolean }
  ): Promise<InstanceTemplate> => {
    return fetchApi<InstanceTemplate>(`/api/templates/${id}`, {
      method: 'PUT', // or PATCH
      body: JSON.stringify(data),
    });
  },

  delete: (id: number): Promise<{ message: string }> => {
    return fetchApi<{ message: string }>(`/api/templates/${id}`, {
      method: 'DELETE',
    });
  },

  use: (id: number, data: { instanceName: string; overrides?: any }): Promise<any> => {
    return fetchApi<any>(`/api/templates/${id}/use`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

// Migrations API
export const migrationsApi = {
  getHistory: (
    instanceId?: string,
    limit: number = 50
  ): Promise<{ count: number; history: any[] }> => {
    const query = new URLSearchParams();
    if (instanceId) query.set('instanceId', instanceId);
    if (limit) query.set('limit', limit.toString());
    return fetchApi<{ count: number; history: any[] }>(
      `/api/migrations/history?${query.toString()}`
    );
  },

  execute: (data: { sql: string; instanceId: string; dryRun?: boolean }): Promise<any> => {
    return fetchApi<any>('/api/migrations/execute', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  validate: (sql: string): Promise<{ valid: boolean; error?: string; sql: string }> => {
    return fetchApi<{ valid: boolean; error?: string; sql: string }>('/api/migrations/validate', {
      method: 'POST',
      body: JSON.stringify({ sql }),
    });
  },

  getTemplates: (): Promise<{ templates: any[] }> => {
    return fetchApi<{ templates: any[] }>('/api/migrations/templates');
  },

  createTemplate: (data: { name: string; description?: string; sql: string }): Promise<any> => {
    return fetchApi<any>('/api/migrations/templates', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  deleteTemplate: (id: number): Promise<void> => {
    return fetchApi<void>(`/api/migrations/templates/${id}`, {
      method: 'DELETE',
    });
  },
};

export const settingsApi = {
  getSmtp: () => {
    return fetchApi<any>('/api/settings/smtp');
  },
  updateSmtp: (data: any) => {
    return fetchApi<any>('/api/settings/smtp', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },
  testSmtp: (to?: string) => {
    return fetchApi<any>('/api/settings/smtp/test', {
      method: 'POST',
      body: JSON.stringify({ to }),
    });
  },
};
