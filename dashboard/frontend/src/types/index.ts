// Multibase Dashboard Frontend Types

// Stack Type: 'classic' = full per-project stack, 'cloud' = shared infra + lightweight tenant
export type StackType = 'classic' | 'cloud';

export interface SupabaseInstance {
  id: string;
  name: string;
  status: 'running' | 'stopped' | 'degraded' | 'healthy' | 'unhealthy';
  stackType?: StackType;
  basePort: number;
  ports: PortMapping;
  credentials: InstanceCredentials;
  services: ServiceStatus[];
  health: HealthStatus;
  metrics?: ResourceMetrics;
  orgId?: string | null;
  orgName?: string | null;
  environment?: 'production' | 'staging' | 'dev' | 'preview' | null;
  createdAt: string;
  updatedAt: string;
}

export interface PortMapping {
  gateway_port: number;
  /** @deprecated Use gateway_port */
  kong_http?: number;
  /** @deprecated Use gateway_port */
  kong_https?: number;
  studio?: number;
  postgres?: number;
  pooler?: number;
  analytics?: number;
}

export interface InstanceCredentials {
  project_url: string;
  studio_url: string;
  anon_key: string;
  service_role_key: string;
  postgres_password: string;
  jwt_secret: string;
  dashboard_username: string;
  dashboard_password: string;
}

export interface ServiceStatus {
  name: string;
  containerName: string;
  status: 'running' | 'stopped' | 'healthy' | 'unhealthy' | 'starting';
  health: 'healthy' | 'unhealthy' | 'unknown';
  uptime: number;
  cpu: number;
  memory: number;
}

export interface HealthStatus {
  overall: 'healthy' | 'degraded' | 'unhealthy' | 'stopped';
  healthyServices: number;
  totalServices: number;
  lastChecked: string;
}

export interface ResourceMetrics {
  cpu: number;
  memory: number;
  networkRx: number;
  networkTx: number;
  diskRead: number;
  diskWrite: number;
  diskUsedMB?: number; // Total used disk space of instance volumes (cached 30 min)
  timestamp: string;
}

// Resource Limits for Docker containers
export interface ResourceLimits {
  cpus?: number;
  memory?: number;
  preset?: 'small' | 'medium' | 'large' | 'custom';
}

export const RESOURCE_PRESETS: Record<string, ResourceLimits> = {
  small: { cpus: 0.5, memory: 512, preset: 'small' },
  medium: { cpus: 1, memory: 1024, preset: 'medium' },
  large: { cpus: 2, memory: 2048, preset: 'large' },
};

export interface CreateInstanceRequest {
  name: string;
  deploymentType: 'localhost' | 'cloud';
  domain?: string;
  protocol?: 'http' | 'https';
  corsOrigins?: string[];
  templateId?: number;
  env?: Record<string, string>;
  resourceLimits?: ResourceLimits;
  extensions?: string[];
  initSql?: string;
  environment?: 'production' | 'staging' | 'dev' | 'preview';
  /** @deprecated Ports dynamisch via Nginx Gateway */
  basePort?: number;
  /** @deprecated All 5 tenant services always run */
  services?: string[];
}

export interface SystemTemplate {
  sharedServices: string[];
  tenantServices: string[];
  availableExtensions: { id: string; name: string }[];
  configurableEnvVars: string[];
  resourcePresets: Record<string, ResourceLimits>;
}

export interface TemplateConfig {
  // Deployment
  deploymentType: 'localhost' | 'cloud';
  domain?: string;
  protocol?: 'http' | 'https';
  corsOrigins?: string[];

  // Shared Infra
  env?: Record<string, string>;
  resourceLimits?: ResourceLimits;
  extensions?: string[];
  initSql?: string;
  environment?: 'production' | 'staging' | 'dev' | 'preview';

  /** @deprecated Ports dynamisch via Nginx Gateway */
  basePort?: number;
  /** @deprecated All 5 tenant services always run */
  services?: string[];
}

export interface SystemMetrics {
  totalCpu: number;
  totalMemory: number;
  totalDisk: number;
  hostTotalMemory?: number;
  hostDiskTotal?: number | null;
  hostDiskUsed?: number | null;
  instanceCount: number;
  runningCount: number;
  timestamp: string;
}

export interface Alert {
  id: number;
  instanceId: string;
  name: string;
  rule: string;
  condition: string;
  threshold?: number;
  duration?: number;
  enabled: boolean;
  status: 'active' | 'acknowledged' | 'resolved';
  triggeredAt?: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
  message?: string;
  notificationChannels?: string;
  webhookUrl?: string;
  createdAt: string;
  updatedAt: string;
  instance?: {
    name: string;
    status?: string;
  };
}

export interface AlertStats {
  total: number;
  active: number;
  acknowledged: number;
  resolved: number;
}

export interface CreateAlertRuleRequest {
  instanceId: string;
  name: string;
  rule: string;
  condition: any;
  threshold?: number;
  duration?: number;
  enabled?: boolean;
  notificationChannels?: string[];
  webhookUrl?: string;
}

// API Keys
export interface ApiKey {
  id: number;
  userId: number;
  name: string;
  keyPrefix: string;
  scopes: string[]; // e.g. ["instances:read", "*"]
  expiresAt: string | null;
  lastUsedAt: string | null;
  usageCount: number;
  createdAt: string;
}

export interface CreateApiKeyRequest {
  name: string;
  scopes?: string[];
  expiresIn?: number; // days
}

export interface CreateApiKeyResponse extends ApiKey {
  key: string; // The full key (only returned once)
  warning: string;
}

export interface ScopeGroup {
  group: string;
  label: string;
  scopes: string[];
}

export interface ScopesApiResponse {
  groups: ScopeGroup[];
  all: string[];
  special: Array<{ scope: string; label: string; description: string }>;
}

export interface InstanceTemplate {
  id: number;
  name: string;
  description?: string;
  config: any;
  isPublic: boolean;
  createdBy: string;
  creator?: {
    id: string;
    username: string;
  };
  createdAt: string;
  updatedAt: string;
}

// =====================================================
// Shared Infrastructure Types (Cloud-Version)
// =====================================================

export interface SharedInfraStatus {
  status: 'running' | 'stopped' | 'degraded';
  services: SharedServiceStatus[];
  ports: SharedPorts;
  totalServices: number;
  runningServices: number;
  diskUsedMB?: number | null; // Total disk used by shared/volumes/ (cached 30 min)
}

export interface SharedServiceStatus {
  name: string;
  containerName?: string;
  status: string;
  health: 'healthy' | 'unhealthy' | 'unknown';
  uptime?: number;
  cpu?: number;
  memory?: number;
  ports?: SharedServicePort[];
}

export interface SharedServicePort {
  label: string;
  host?: number;
  container: number;
  protocol: 'tcp' | 'http';
  public: boolean;
}

export interface SharedPorts {
  postgres?: number;
  studio?: number;
  analytics?: number;
  pooler?: number;
  gateway?: number;
  /** @deprecated Use gateway */
  kong?: number;
  meta?: number;
}

export interface SharedDatabase {
  name: string;
  projectName: string;
  sizeBytes: number;
  sizeFormatted: string;
}

export interface SharedDatabasesResponse {
  databases: SharedDatabase[];
  count: number;
}

export interface SharedMetrics {
  cpu: number;
  memory: number;
  disk: number;
  containerCount: number;
  timestamp: string;
}
