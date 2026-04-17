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
  SharedInfraStatus,
  SharedDatabasesResponse,
} from '../types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// Fetch helper without X-Org-Id header (admin all-instances view)
async function fetchApiNoOrg<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('auth_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((options?.headers as Record<string, string>) || {}),
  };
  const response = await fetch(`${API_BASE_URL}${endpoint}`, { ...options, headers });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || `HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json();
}

// Generic fetch helper
async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('auth_token');
  const activeOrgSlug = localStorage.getItem('activeOrgSlug');

  // Resolve org ID from cached orgs data (stored by OrgContext)
  let orgId: string | null = null;
  if (activeOrgSlug) {
    try {
      const cachedOrgs = localStorage.getItem('cachedOrgs');
      if (cachedOrgs) {
        const orgs = JSON.parse(cachedOrgs);
        const match = orgs.find((o: any) => o.slug === activeOrgSlug);
        if (match) orgId = match.id;
      }
    } catch {
      /* ignore parse errors */
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(orgId ? { 'X-Org-Id': orgId } : {}),
    ...((options?.headers as Record<string, string>) || {}),
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
export interface UptimeStats {
  uptimeParams: { days: number };
  uptimePercentage: number;
  history: { date: string; hours: number }[];
  lastCheck?: { status: string; responseTime: number; timestamp: string };
}

export const instancesApi = {
  list: (): Promise<SupabaseInstance[]> => {
    return fetchApi<SupabaseInstance[]>('/api/instances');
  },

  listAll: (): Promise<SupabaseInstance[]> => {
    return fetchApiNoOrg<SupabaseInstance[]>('/api/instances');
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

  recreate: (name: string): Promise<{ message: string }> => {
    return fetchApi<{ message: string }>(`/api/instances/${name}/recreate`, {
      method: 'POST',
    });
  },

  updateSmtp: (name: string, data: any): Promise<void> => {
    return fetchApi<void>(`/api/instances/${name}/smtp`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  getEnv: (name: string): Promise<Record<string, string>> => {
    return fetchApi<Record<string, string>>(`/api/instances/${name}/env`);
  },

  updateEnv: (name: string, data: Record<string, string>): Promise<void> => {
    return fetchApi<void>(`/api/instances/${name}/env`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  updateResources: (
    name: string,
    data: { resourceLimits: { cpus?: number; memory?: number; preset?: string } }
  ): Promise<{ success: boolean; message: string }> => {
    return fetchApi(`/api/instances/${name}/resources`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  bulk: (
    action: 'start' | 'stop' | 'restart',
    instances: string[]
  ): Promise<{
    message: string;
    results: { name: string; success: boolean; message: string }[];
  }> => {
    return fetchApi(`/api/instances/bulk`, {
      method: 'POST',
      body: JSON.stringify({ action, instances }),
    });
  },

  getUptimeStats: (name: string, days: number = 30): Promise<UptimeStats> => {
    return fetchApi(`/api/instances/${name}/uptime?days=${days}`);
  },

  clone: (
    sourceName: string,
    newName: string,
    options?: { copyEnv?: boolean }
  ): Promise<{ message: string; instance: any }> => {
    return fetchApi(`/api/instances/${sourceName}/clone`, {
      method: 'POST',
      body: JSON.stringify({ newName, copyEnv: options?.copyEnv ?? true }),
    });
  },

  getSchema: (name: string): Promise<{ tables: any[] }> => {
    return fetchApi(`/api/instances/${name}/schema`);
  },

  executeSQL: (name: string, query: string): Promise<{ rows: any[]; error?: string }> => {
    return fetchApi(`/api/instances/${name}/sql`, {
      method: 'POST',
      body: JSON.stringify({ query }),
    });
  },

  /** Set or clear the environment label of an instance ('production'|'staging'|'dev'|'preview'|null) */
  setEnvironment: (
    name: string,
    environment: 'production' | 'staging' | 'dev' | 'preview' | null
  ): Promise<{ success: boolean; name: string; environment: string | null }> => {
    return fetchApi(`/api/instances/${name}/environment`, {
      method: 'PATCH',
      body: JSON.stringify({ environment }),
    });
  },

  /** Admin-only: assign an existing instance to an organisation (or unassign with null) */
  assignOrg: (
    name: string,
    orgId: string | null
  ): Promise<{ success: boolean; name: string; orgId: string | null }> => {
    return fetchApi(`/api/instances/${name}/assign-org`, {
      method: 'PATCH',
      body: JSON.stringify({ orgId }),
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
  getSystem: () => {
    return fetchApi<{ cors: string; api_url: string }>('/api/settings/system');
  },
};

// Email Templates API
export const emailTemplatesApi = {
  getAll: (
    instanceName: string
  ): Promise<{
    templates: Record<string, { html: string; isDefault: boolean }>;
  }> => {
    return fetchApi(`/api/instances/${instanceName}/email-templates`);
  },

  save: (
    instanceName: string,
    type: string,
    html: string
  ): Promise<{ message: string; type: string; isDefault: boolean }> => {
    return fetchApi(`/api/instances/${instanceName}/email-templates/${type}`, {
      method: 'PUT',
      body: JSON.stringify({ html }),
    });
  },

  reset: (
    instanceName: string,
    type: string
  ): Promise<{ message: string; type: string; isDefault: boolean }> => {
    return fetchApi(`/api/instances/${instanceName}/email-templates/${type}/reset`, {
      method: 'POST',
    });
  },

  sendTest: (
    instanceName: string,
    type: string,
    email: string
  ): Promise<{ message: string; type: string; usedGlobalSmtp: boolean }> => {
    return fetchApi(`/api/instances/${instanceName}/email-templates/test`, {
      method: 'POST',
      body: JSON.stringify({ type, email }),
    });
  },

  getVariables: (
    instanceName: string
  ): Promise<{
    variables: Record<string, Array<{ name: string; description: string }>>;
  }> => {
    return fetchApi(`/api/instances/${instanceName}/email-templates/variables`);
  },
};

// Functions API
export const functionsApi = {
  list: (instanceName: string): Promise<{ functions: string[] }> => {
    return fetchApi(`/api/instances/${instanceName}/functions`);
  },

  get: (instanceName: string, functionName: string): Promise<{ code: string }> => {
    return fetchApi(`/api/instances/${instanceName}/functions/${functionName}`);
  },

  save: (
    instanceName: string,
    functionName: string,
    code: string
  ): Promise<{ message: string }> => {
    return fetchApi(`/api/instances/${instanceName}/functions/${functionName}`, {
      method: 'PUT',
      body: JSON.stringify({ code }),
    });
  },

  delete: (instanceName: string, functionName: string): Promise<{ message: string }> => {
    return fetchApi(`/api/instances/${instanceName}/functions/${functionName}`, {
      method: 'DELETE',
    });
  },

  deploy: (instanceName: string, functionName: string): Promise<{ message: string }> => {
    return fetchApi(`/api/instances/${instanceName}/functions/${functionName}/deploy`, {
      method: 'POST',
    });
  },

  getLogs: (instanceName: string, functionName: string): Promise<{ logs: string[] }> => {
    return fetchApi(`/api/instances/${instanceName}/functions/${functionName}/logs`);
  },

  getEnv: (
    instanceName: string,
    functionName: string
  ): Promise<{ env: Record<string, string> }> => {
    return fetchApi(`/api/instances/${instanceName}/functions/${functionName}/env`);
  },

  saveEnv: (
    instanceName: string,
    functionName: string,
    env: Record<string, string>
  ): Promise<{ message: string }> => {
    return fetchApi(`/api/instances/${instanceName}/functions/${functionName}/env`, {
      method: 'PUT',
      body: JSON.stringify({ env }),
    });
  },

  invoke: (
    instanceName: string,
    functionName: string,
    opts: { method?: string; headers?: Record<string, string>; body?: string }
  ): Promise<{ status: number; headers: Record<string, string>; body: any }> => {
    return fetchApi(`/api/instances/${instanceName}/functions/${functionName}/invoke`, {
      method: 'POST',
      body: JSON.stringify(opts),
    });
  },
};

// Storage API
export const storageApi = {
  listBuckets: (instanceName: string): Promise<{ buckets: any[] }> => {
    return fetchApi(`/api/instances/${instanceName}/storage/buckets`);
  },

  createBucket: (instanceName: string, bucketName: string, isPublic: boolean): Promise<any> => {
    return fetchApi(`/api/instances/${instanceName}/storage/buckets`, {
      method: 'POST',
      body: JSON.stringify({ bucketName, isPublic }),
    });
  },

  deleteBucket: (instanceName: string, bucketId: string): Promise<{ message: string }> => {
    return fetchApi(`/api/instances/${instanceName}/storage/buckets/${bucketId}`, {
      method: 'DELETE',
    });
  },

  listFiles: (
    instanceName: string,
    bucketId: string,
    path: string = ''
  ): Promise<{ files: any[] }> => {
    return fetchApi(`/api/instances/${instanceName}/storage/files/${bucketId}/${path}`);
  },

  uploadFile: (instanceName: string, bucketId: string, path: string, file: File): Promise<any> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('path', path);

    // Initial implementation of fetchApi uses JSON content-type by default
    // We need to override it or use raw fetch for FormData
    // The current fetchApi helper might force Content-Type: application/json
    // Let's modify fetchApi or use a custom one here if needed.
    // Looking at api.ts:
    /*
    const headers = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options?.headers,
    };
    */
    // If we pass body as FormData, fetch sets Content-Type boundary automatically.
    // We should allow overriding/removing 'Content-Type'.

    const token = localStorage.getItem('auth_token');
    return fetch(`${API_BASE_URL}/api/instances/${instanceName}/storage/files/${bucketId}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    }).then(async res => {
      if (!res.ok) {
        const error = await res.text();
        throw new Error(error || res.statusText);
      }
      return res.json();
    });
  },

  deleteFile: (
    instanceName: string,
    bucketId: string,
    path: string
  ): Promise<{ message: string }> => {
    return fetchApi(`/api/instances/${instanceName}/storage/files/${bucketId}/${path}`, {
      method: 'DELETE',
    });
  },

  getPublicUrl: (
    instanceName: string,
    bucketId: string,
    path: string
  ): Promise<{ publicUrl: string }> => {
    // The backend route is /url/:bucketId/:path(*)
    return fetchApi(`/api/instances/${instanceName}/storage/url/${bucketId}/${path}`);
  },

  createSignedUrl: (
    instanceName: string,
    bucketId: string,
    path: string,
    expiresIn: number = 60
  ): Promise<{ signedUrl: string }> => {
    return fetchApi(`/api/instances/${instanceName}/storage/signed-url/${bucketId}`, {
      method: 'POST',
      body: JSON.stringify({ path, expiresIn }),
    });
  },

  /** Invalidate CDN cache by reloading the nginx gateway */
  invalidateCache: (instanceName: string): Promise<{ success: boolean; message: string }> =>
    fetchApi(`/api/instances/${instanceName}/storage/cache/invalidate`, { method: 'POST' }),
};

// Vault Secrets API
export const vaultApi = {
  list: (instanceName: string): Promise<{ secrets: any[] }> =>
    fetchApi(`/api/instances/${instanceName}/vault`),

  add: (
    instanceName: string,
    secretName: string,
    value: string,
    description?: string
  ): Promise<{ success: boolean }> =>
    fetchApi(`/api/instances/${instanceName}/vault`, {
      method: 'POST',
      body: JSON.stringify({ secretName, value, description }),
    }),

  reveal: (instanceName: string, id: string): Promise<{ value: string | null }> =>
    fetchApi(`/api/instances/${instanceName}/vault/${id}/reveal`),

  update: (instanceName: string, id: string, value: string): Promise<{ success: boolean }> =>
    fetchApi(`/api/instances/${instanceName}/vault/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ value }),
    }),

  remove: (instanceName: string, id: string): Promise<{ success: boolean }> =>
    fetchApi(`/api/instances/${instanceName}/vault/${id}`, { method: 'DELETE' }),
};

// Security / Network Restrictions API
export interface SecurityConfig {
  sslOnly: boolean;
  ipWhitelistEnabled: boolean;
  ipWhitelist: string;
  rateLimitEnabled: boolean;
  rateLimitRpm: number;
}

export const securityApi = {
  get: (instanceName: string): Promise<SecurityConfig> =>
    fetchApi(`/api/instances/${instanceName}/security`),

  update: (
    instanceName: string,
    config: Partial<SecurityConfig>
  ): Promise<{ success: boolean; message: string }> =>
    fetchApi(`/api/instances/${instanceName}/security`, {
      method: 'PATCH',
      body: JSON.stringify(config),
    }),
};

// Realtime API
export interface RealtimeConfig {
  maxConcurrentUsers: number;
  tenantId: string;
  jwtSecretSet: boolean;
  realtimeEnabled: boolean;
  apiUrl: string;
  anonKey: string;
}

export interface RealtimeStats {
  channelCount: number;
  cpu: number;
  memory: number;
  status: string;
}

export const realtimeApi = {
  getConfig: (instanceName: string): Promise<RealtimeConfig> =>
    fetchApi(`/api/instances/${instanceName}/realtime/config`),

  updateConfig: (
    instanceName: string,
    data: { maxConcurrentUsers?: number }
  ): Promise<{ success: boolean; message: string }> =>
    fetchApi(`/api/instances/${instanceName}/realtime/config`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  getStats: (instanceName: string): Promise<RealtimeStats> =>
    fetchApi(`/api/instances/${instanceName}/realtime/stats`),
};

// Read Replicas API
export interface ReadReplica {
  id: string;
  name: string;
  url: string;
  status: string;
  lagBytes: number | null;
  createdAt: string;
}

export const replicasApi = {
  list: (instanceName: string): Promise<{ replicas: ReadReplica[] }> =>
    fetchApi(`/api/instances/${instanceName}/replicas`),

  add: (
    instanceName: string,
    data: { name: string; url: string }
  ): Promise<{ replica: ReadReplica }> =>
    fetchApi(`/api/instances/${instanceName}/replicas`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  checkStatus: (
    instanceName: string,
    id: string
  ): Promise<{ ok: boolean; lagBytes: number | null; lagSeconds: number | null; role: string }> =>
    fetchApi(`/api/instances/${instanceName}/replicas/${id}/status`),

  remove: (instanceName: string, id: string): Promise<{ success: boolean }> =>
    fetchApi(`/api/instances/${instanceName}/replicas/${id}`, { method: 'DELETE' }),
};

// Log Drains API
export interface LogDrain {
  id: string;
  name: string;
  url: string;
  services: string[];
  format: string;
  enabled: boolean;
  lastStatus: string | null;
  lastDelivery: string | null;
}

export const logDrainsApi = {
  list: (instanceName: string): Promise<{ drains: LogDrain[] }> =>
    fetchApi(`/api/instances/${instanceName}/log-drains`),

  add: (
    instanceName: string,
    data: { name: string; url: string; services: string[]; format: string }
  ): Promise<{ drain: LogDrain }> =>
    fetchApi(`/api/instances/${instanceName}/log-drains`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (
    instanceName: string,
    id: string,
    data: { enabled?: boolean; url?: string; services?: string[]; name?: string }
  ): Promise<{ drain: LogDrain }> =>
    fetchApi(`/api/instances/${instanceName}/log-drains/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  test: (instanceName: string, id: string): Promise<{ ok: boolean; error?: string }> =>
    fetchApi(`/api/instances/${instanceName}/log-drains/${id}/test`, { method: 'POST' }),

  remove: (instanceName: string, id: string): Promise<{ success: boolean }> =>
    fetchApi(`/api/instances/${instanceName}/log-drains/${id}`, { method: 'DELETE' }),
};

// MCP API
export const mcpApi = {
  getInfo: (): Promise<{
    server: { name: string; version: string; description: string };
    tools: { name: string; description: string; inputSchema: any }[];
    protocol: string;
  }> => fetchApi('/api/mcp/info'),
};

// =====================================================
// Shared Infrastructure API (Cloud-Version)
// =====================================================

export const sharedApi = {
  getStatus: (): Promise<SharedInfraStatus> => fetchApi('/api/shared/status'),

  start: (): Promise<{ success: boolean; message: string }> =>
    fetchApi('/api/shared/start', { method: 'POST' }),

  stop: (): Promise<{ success: boolean; message: string }> =>
    fetchApi('/api/shared/stop', { method: 'POST' }),

  getDatabases: (): Promise<SharedDatabasesResponse> => fetchApi('/api/shared/databases'),

  createDatabase: (projectName: string): Promise<{ success: boolean; database: string }> =>
    fetchApi('/api/shared/databases', {
      method: 'POST',
      body: JSON.stringify({ projectName }),
    }),

  deleteDatabase: (name: string): Promise<{ success: boolean; database: string }> =>
    fetchApi(`/api/shared/databases/${name}`, { method: 'DELETE' }),
};

// =====================================================
// Webhooks API
// =====================================================
export const webhooksApi = {
  list: (instanceName: string): Promise<{ webhooks: any[] }> =>
    fetchApi(`/api/instances/${instanceName}/webhooks`),

  create: (
    instanceName: string,
    data: {
      name: string;
      tableSchema?: string;
      tableName: string;
      events: string[];
      url: string;
      method?: string;
      headers?: Record<string, string>;
      timeoutMs?: number;
    }
  ): Promise<{ id: number; hasTrigger: boolean }> =>
    fetchApi(`/api/instances/${instanceName}/webhooks`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  delete: (instanceName: string, webhookId: number): Promise<{ success: boolean }> =>
    fetchApi(`/api/instances/${instanceName}/webhooks/${webhookId}`, { method: 'DELETE' }),

  toggle: (instanceName: string, webhookId: number, enabled: boolean): Promise<any> =>
    fetchApi(`/api/instances/${instanceName}/webhooks/${webhookId}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }),
};

// =====================================================
// Cron Jobs API
// =====================================================
export const cronApi = {
  getStatus: (instanceName: string): Promise<{ enabled: boolean; extension: any }> =>
    fetchApi(`/api/instances/${instanceName}/cron/status`),

  list: (instanceName: string): Promise<{ jobs: any[]; enabled: boolean }> =>
    fetchApi(`/api/instances/${instanceName}/cron`),

  create: (
    instanceName: string,
    data: { name: string; schedule: string; command: string }
  ): Promise<{ jobid: number }> =>
    fetchApi(`/api/instances/${instanceName}/cron`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  delete: (instanceName: string, jobId: number): Promise<{ success: boolean }> =>
    fetchApi(`/api/instances/${instanceName}/cron/${jobId}`, { method: 'DELETE' }),

  toggle: (instanceName: string, jobId: number, active: boolean): Promise<any> =>
    fetchApi(`/api/instances/${instanceName}/cron/${jobId}`, {
      method: 'PATCH',
      body: JSON.stringify({ active }),
    }),

  runNow: (instanceName: string, jobId: number): Promise<{ success: boolean; rows: any[] }> =>
    fetchApi(`/api/instances/${instanceName}/cron/${jobId}/run`, { method: 'POST' }),

  getRuns: (instanceName: string, jobId: number, limit?: number): Promise<{ runs: any[] }> =>
    fetchApi(`/api/instances/${instanceName}/cron/${jobId}/runs${limit ? `?limit=${limit}` : ''}`),
};

// =====================================================
// Vectors / pgvector API
// =====================================================
export const vectorsApi = {
  getStatus: (instanceName: string): Promise<{ enabled: boolean; extension: any }> =>
    fetchApi(`/api/instances/${instanceName}/vectors/status`),

  enable: (instanceName: string): Promise<{ success: boolean }> =>
    fetchApi(`/api/instances/${instanceName}/vectors/enable`, { method: 'POST' }),

  listColumns: (instanceName: string): Promise<{ columns: any[] }> =>
    fetchApi(`/api/instances/${instanceName}/vectors/columns`),

  addColumn: (
    instanceName: string,
    data: {
      tableSchema?: string;
      tableName: string;
      columnName: string;
      dimension: number;
    }
  ): Promise<{ success: boolean }> =>
    fetchApi(`/api/instances/${instanceName}/vectors/columns`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  listIndexes: (instanceName: string): Promise<{ indexes: any[] }> =>
    fetchApi(`/api/instances/${instanceName}/vectors/indexes`),

  createIndex: (
    instanceName: string,
    data: {
      tableSchema?: string;
      tableName: string;
      columnName: string;
      indexType: 'ivfflat' | 'hnsw';
      metric: 'cosine' | 'l2' | 'ip';
      lists?: number;
    }
  ): Promise<{ success: boolean }> =>
    fetchApi(`/api/instances/${instanceName}/vectors/indexes`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  dropIndex: (instanceName: string, indexName: string): Promise<{ success: boolean }> =>
    fetchApi(`/api/instances/${instanceName}/vectors/indexes/${indexName}`, { method: 'DELETE' }),

  search: (
    instanceName: string,
    data: {
      tableSchema?: string;
      tableName: string;
      columnName: string;
      vector: number[];
      k: number;
      metric?: 'cosine' | 'l2' | 'ip';
    }
  ): Promise<{ results: any[] }> =>
    fetchApi(`/api/instances/${instanceName}/vectors/search`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

// =====================================================
// Message Queues / pgmq API
// =====================================================
export const queuesApi = {
  getStatus: (instanceName: string): Promise<{ enabled: boolean }> =>
    fetchApi(`/api/instances/${instanceName}/queues/status`),

  enable: (instanceName: string): Promise<{ success: boolean }> =>
    fetchApi(`/api/instances/${instanceName}/queues/enable`, { method: 'POST' }),

  list: (instanceName: string): Promise<{ queues: any[]; enabled: boolean }> =>
    fetchApi(`/api/instances/${instanceName}/queues`),

  create: (instanceName: string, queueName: string): Promise<{ success: boolean }> =>
    fetchApi(`/api/instances/${instanceName}/queues`, {
      method: 'POST',
      body: JSON.stringify({ queueName }),
    }),

  drop: (instanceName: string, queueName: string): Promise<{ success: boolean }> =>
    fetchApi(`/api/instances/${instanceName}/queues/${queueName}`, { method: 'DELETE' }),

  readMessages: (
    instanceName: string,
    queueName: string,
    limit?: number
  ): Promise<{ messages: any[] }> =>
    fetchApi(
      `/api/instances/${instanceName}/queues/${queueName}/messages${limit ? `?limit=${limit}` : ''}`
    ),

  sendMessage: (
    instanceName: string,
    queueName: string,
    message: object
  ): Promise<{ msgId: number }> =>
    fetchApi(`/api/instances/${instanceName}/queues/${queueName}/send`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),

  purge: (instanceName: string, queueName: string): Promise<{ deleted: number }> =>
    fetchApi(`/api/instances/${instanceName}/queues/${queueName}/purge`, { method: 'POST' }),

  getMetrics: (instanceName: string, queueName: string): Promise<{ metrics: any }> =>
    fetchApi(`/api/instances/${instanceName}/queues/${queueName}/metrics`),
};

// =====================================================
// Custom Domains API
// =====================================================
export const domainsApi = {
  list: (instanceName: string): Promise<{ domains: any[] }> =>
    fetchApi(`/api/instances/${instanceName}/domains`),

  add: (instanceName: string, domain: string): Promise<any> =>
    fetchApi(`/api/instances/${instanceName}/domains`, {
      method: 'POST',
      body: JSON.stringify({ domain }),
    }),

  checkDns: (
    instanceName: string,
    domain: string
  ): Promise<{ verified: boolean; message: string }> =>
    fetchApi(`/api/instances/${instanceName}/domains/${encodeURIComponent(domain)}/check-dns`, {
      method: 'POST',
    }),

  activateSsl: (
    instanceName: string,
    domain: string,
    adminEmail: string
  ): Promise<{ success: boolean; message: string }> =>
    fetchApi(`/api/instances/${instanceName}/domains/${encodeURIComponent(domain)}/activate-ssl`, {
      method: 'POST',
      body: JSON.stringify({ adminEmail }),
    }),

  manualActivate: (
    instanceName: string,
    domain: string,
    certDir?: string
  ): Promise<{ success: boolean }> =>
    fetchApi(
      `/api/instances/${instanceName}/domains/${encodeURIComponent(domain)}/manual-activate`,
      {
        method: 'POST',
        body: JSON.stringify({ certDir }),
      }
    ),

  remove: (instanceName: string, domain: string): Promise<{ success: boolean }> =>
    fetchApi(`/api/instances/${instanceName}/domains/${encodeURIComponent(domain)}`, {
      method: 'DELETE',
    }),
};

// =====================================================
// Extension Marketplace API
// =====================================================

export interface MarketplaceExtension {
  id: string;
  name: string;
  description: string;
  longDescription?: string;
  version: string;
  author: string;
  authorUrl?: string;
  category: string;
  tags: string;
  iconUrl?: string;
  screenshotUrls?: string;
  verified: boolean;
  featured: boolean;
  installCount: number;
  rating?: number;
  minVersion: string;
  requiresExtensions?: string;
  installType: string;
  manifestUrl: string;
  configSchema?: string;
  latestVersion?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExtensionReview {
  id: string;
  extensionId: string;
  rating: number;
  comment?: string;
  authorName?: string;
  createdAt: string;
}

export interface InstalledExtension {
  id: string;
  instanceId: string;
  extensionId: string;
  version: string;
  status: string;
  config?: string;
  installedAt: string;
  updatedAt: string;
  extension: Pick<
    MarketplaceExtension,
    | 'id'
    | 'name'
    | 'description'
    | 'version'
    | 'author'
    | 'category'
    | 'iconUrl'
    | 'verified'
    | 'latestVersion'
  >;
}

export const marketplaceApi = {
  listExtensions: (params?: {
    category?: string;
    search?: string;
    featured?: boolean;
  }): Promise<{ extensions: MarketplaceExtension[] }> => {
    const q = new URLSearchParams();
    if (params?.category) q.set('category', params.category);
    if (params?.search) q.set('search', params.search);
    if (params?.featured) q.set('featured', 'true');
    const qs = q.toString();
    return fetchApi(`/api/marketplace/extensions${qs ? `?${qs}` : ''}`);
  },

  getExtension: (id: string): Promise<{ extension: MarketplaceExtension }> =>
    fetchApi(`/api/marketplace/extensions/${id}`),

  getStats: (
    id: string
  ): Promise<{
    installCount: number;
    rating: number | null;
    version: string;
    latestVersion: string | null;
  }> => fetchApi(`/api/marketplace/extensions/${id}/stats`),

  listReviews: (id: string): Promise<{ reviews: ExtensionReview[] }> =>
    fetchApi(`/api/marketplace/extensions/${id}/reviews`),

  submitReview: (
    id: string,
    payload: { rating: number; comment?: string; authorName?: string }
  ): Promise<{ review: ExtensionReview }> =>
    fetchApi(`/api/marketplace/extensions/${id}/reviews`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};

export const instanceExtensionsApi = {
  list: (instanceName: string): Promise<{ extensions: InstalledExtension[] }> =>
    fetchApi(`/api/instances/${instanceName}/extensions`),

  install: (
    instanceName: string,
    extensionId: string,
    config?: Record<string, unknown>
  ): Promise<{ installed: InstalledExtension }> =>
    fetchApi(`/api/instances/${instanceName}/extensions`, {
      method: 'POST',
      body: JSON.stringify({ extensionId, config }),
    }),

  uninstall: (instanceName: string, extensionId: string): Promise<{ success: boolean }> =>
    fetchApi(`/api/instances/${instanceName}/extensions/${extensionId}`, { method: 'DELETE' }),

  getStatus: (
    instanceName: string,
    extensionId: string
  ): Promise<{
    status: string;
    version: string;
    installedAt: string;
    config: Record<string, unknown>;
  }> => fetchApi(`/api/instances/${instanceName}/extensions/${extensionId}/status`),
};

// =====================================================
// Updates API
// =====================================================

export interface UpdateVersionInfo {
  current: string;
  latest: string | null;
  hasUpdate: boolean;
  changelog: string | null;
  checkedAt: string | null;
}

export interface DockerServiceInfo {
  service: string;
  image: string;
  tag: string;
  status: 'running' | 'stopped' | 'missing';
}

export interface UpdateStatus {
  multibase: UpdateVersionInfo;
  docker: DockerServiceInfo[];
  isUpdateInProgress: boolean;
  lastCheckedAt: string | null;
  /** 'local' = single-server (backend builds frontend). 'split' = frontend deployed via CI. */
  frontendServe: 'local' | 'split';
}

export const updatesApi = {
  getStatus: (): Promise<UpdateStatus> => fetchApi('/api/updates/status'),

  check: (): Promise<UpdateStatus> => fetchApi('/api/updates/check', { method: 'POST' }),

  updateMultibase: (): Promise<{ success: boolean; message: string }> =>
    fetchApi('/api/updates/multibase', { method: 'POST' }),

  updateDocker: (
    services?: string[]
  ): Promise<{ success: boolean; message: string; services: string[] }> =>
    fetchApi('/api/updates/docker', {
      method: 'POST',
      body: JSON.stringify({ services }),
    }),
};
