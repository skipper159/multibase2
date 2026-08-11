import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { decrypt } from '../utils/AiEncryption';
import { MigrationService } from './MigrationService';

// ============================================================
// Types
// ============================================================

export interface AiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  result: any;
}

export interface StreamChunk {
  type: 'text' | 'tool_call' | 'tool_result' | 'done' | 'error';
  content?: string;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  error?: string;
}

interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

// ============================================================
// Tool Definitions
// ============================================================

const TOOL_DEFINITIONS: ToolDefinition[] = [
  // ===== INSTANCE MANAGEMENT =====
  {
    name: 'list_instances',
    description:
      'List all Supabase instances with their current status, ports, and health information.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_instance',
    description:
      'Get detailed information about a specific Supabase instance by name, including ports, credentials, and service status.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'The name of the instance' } },
      required: ['name'],
    },
  },
  {
    name: 'create_instance',
    description:
      'Create a new Supabase instance with Docker containers. Requires name and deploymentType. The user MUST confirm this action.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name for the new instance (alphanumeric and hyphens only)',
        },
        deploymentType: {
          type: 'string',
          enum: ['localhost', 'cloud'],
          description: 'Deployment type',
        },
        domain: { type: 'string', description: 'Custom domain (required for cloud deployment)' },
        protocol: {
          type: 'string',
          enum: ['http', 'https'],
          description: 'Protocol (default: http for localhost, https for cloud)',
        },
        basePort: { type: 'number', description: 'Base port number (auto-assigned if omitted)' },
        resourceLimits: {
          type: 'object',
          description: 'Resource limits preset or custom values',
          properties: {
            preset: {
              type: 'string',
              enum: ['small', 'medium', 'large'],
              description:
                'Preset: small (0.5 CPU, 512MB), medium (1 CPU, 1GB), large (2 CPU, 2GB)',
            },
            cpus: { type: 'number', description: 'CPU cores (e.g. 0.5, 1, 2)' },
            memory: { type: 'number', description: 'Memory in MB (e.g. 512, 1024, 2048)' },
          },
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'start_instance',
    description: 'Start a stopped Supabase instance.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'The name of the instance to start' } },
      required: ['name'],
    },
  },
  {
    name: 'stop_instance',
    description: 'Stop a running Supabase instance. The user MUST confirm this action.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'The name of the instance to stop' } },
      required: ['name'],
    },
  },
  {
    name: 'restart_instance',
    description: 'Restart a Supabase instance.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'The name of the instance to restart' } },
      required: ['name'],
    },
  },
  {
    name: 'delete_instance',
    description:
      'Delete a Supabase instance and optionally its volumes. This is DESTRUCTIVE and the user MUST confirm.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The name of the instance to delete' },
        removeVolumes: {
          type: 'boolean',
          description: 'Whether to also remove data volumes (default: false)',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'get_instance_status',
    description:
      'Get the health and service status of a specific instance, including individual container states.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'The name of the instance' } },
      required: ['name'],
    },
  },

  // ===== TEMPLATES =====
  {
    name: 'list_templates',
    description: 'List all available instance templates (public and user-created).',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_template',
    description: 'Get details of a specific template by ID, including its configuration.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'number', description: 'Template ID' } },
      required: ['id'],
    },
  },
  {
    name: 'create_template',
    description:
      'Create a new instance template with a name, description, and configuration. The user MUST confirm this action.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Template name' },
        description: { type: 'string', description: 'Template description' },
        config: {
          type: 'object',
          description: 'Template configuration',
          properties: {
            deploymentType: { type: 'string', enum: ['localhost', 'cloud'] },
            basePort: { type: 'number' },
            domain: { type: 'string' },
            protocol: { type: 'string', enum: ['http', 'https'] },
            corsOrigins: { type: 'array', items: { type: 'string' } },
          },
          required: ['deploymentType'],
        },
        isPublic: {
          type: 'boolean',
          description: 'Whether the template is publicly visible (admin only)',
        },
      },
      required: ['name', 'config'],
    },
  },
  {
    name: 'delete_template',
    description: 'Delete a template by ID. The user MUST confirm this action.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'number', description: 'Template ID to delete' } },
      required: ['id'],
    },
  },
  {
    name: 'use_template',
    description:
      'Create a new instance from an existing template. The user MUST confirm this action.',
    parameters: {
      type: 'object',
      properties: {
        templateId: { type: 'number', description: 'Template ID to use' },
        instanceName: { type: 'string', description: 'Name for the new instance' },
        overrides: {
          type: 'object',
          description: 'Optional config overrides (domain, basePort, etc.)',
        },
      },
      required: ['templateId', 'instanceName'],
    },
  },

  // ===== METRICS & MONITORING =====
  {
    name: 'get_system_metrics',
    description: 'Get system-wide metrics: total CPU, memory, instance count, running count.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_instance_metrics',
    description: 'Get current resource metrics for a specific instance (CPU, memory per service).',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Instance name' } },
      required: ['name'],
    },
  },
  {
    name: 'get_instance_uptime',
    description: 'Get uptime statistics for an instance over a specified number of days.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Instance name' },
        days: { type: 'number', description: 'Number of days to check (default: 30)' },
      },
      required: ['name'],
    },
  },

  // ===== LOGS =====
  {
    name: 'get_instance_logs',
    description: 'Get logs for all services in an instance.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Instance name' },
        tail: { type: 'number', description: 'Number of log lines per service (default: 50)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'get_service_logs',
    description:
      'Get logs for a specific service in an instance (e.g. postgres, kong, studio, auth, rest, realtime, storage, meta, functions, analytics, imgproxy).',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Instance name' },
        service: { type: 'string', description: 'Service name (e.g. postgres, kong, studio)' },
        tail: { type: 'number', description: 'Number of log lines (default: 100)' },
      },
      required: ['name', 'service'],
    },
  },

  // ===== BACKUPS =====
  {
    name: 'list_backups',
    description: 'List all backups, optionally filtered by type.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Filter by backup type (instance, full, database)' },
      },
      required: [],
    },
  },
  {
    name: 'create_backup',
    description: 'Create a new backup. The user MUST confirm this action.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['instance', 'full', 'database'],
          description: 'Backup type',
        },
        instanceId: { type: 'string', description: 'Instance name (required for instance backup)' },
        name: { type: 'string', description: 'Optional backup name' },
      },
      required: ['type'],
    },
  },
  {
    name: 'restore_backup',
    description: 'Restore from a backup. This is DESTRUCTIVE and the user MUST confirm.',
    parameters: {
      type: 'object',
      properties: {
        backupId: { type: 'string', description: 'Backup ID to restore from' },
        instanceId: { type: 'string', description: 'Target instance ID (optional)' },
      },
      required: ['backupId'],
    },
  },
  {
    name: 'delete_backup',
    description: 'Delete a backup. The user MUST confirm this action.',
    parameters: {
      type: 'object',
      properties: { backupId: { type: 'string', description: 'Backup ID to delete' } },
      required: ['backupId'],
    },
  },

  // ===== STORAGE =====
  {
    name: 'list_buckets',
    description: 'List all storage buckets for a Supabase instance.',
    parameters: {
      type: 'object',
      properties: { instanceName: { type: 'string', description: 'Instance name' } },
      required: ['instanceName'],
    },
  },
  {
    name: 'list_files',
    description: 'List files in a storage bucket.',
    parameters: {
      type: 'object',
      properties: {
        instanceName: { type: 'string', description: 'Instance name' },
        bucketId: { type: 'string', description: 'Bucket ID/name' },
        path: { type: 'string', description: 'Folder path (default: root)' },
      },
      required: ['instanceName', 'bucketId'],
    },
  },
  {
    name: 'create_bucket',
    description: 'Create a new storage bucket. The user MUST confirm this action.',
    parameters: {
      type: 'object',
      properties: {
        instanceName: { type: 'string', description: 'Instance name' },
        bucketName: { type: 'string', description: 'Name for the new bucket' },
        isPublic: {
          type: 'boolean',
          description: 'Whether the bucket is publicly accessible (default: false)',
        },
      },
      required: ['instanceName', 'bucketName'],
    },
  },
  {
    name: 'delete_bucket',
    description: 'Delete a storage bucket. The user MUST confirm this action.',
    parameters: {
      type: 'object',
      properties: {
        instanceName: { type: 'string', description: 'Instance name' },
        bucketId: { type: 'string', description: 'Bucket ID to delete' },
      },
      required: ['instanceName', 'bucketId'],
    },
  },
  {
    name: 'delete_file',
    description: 'Delete a file from a storage bucket. The user MUST confirm this action.',
    parameters: {
      type: 'object',
      properties: {
        instanceName: { type: 'string', description: 'Instance name' },
        bucketId: { type: 'string', description: 'Bucket ID' },
        filePath: { type: 'string', description: 'Path to the file to delete' },
      },
      required: ['instanceName', 'bucketId', 'filePath'],
    },
  },
  {
    name: 'get_file_url',
    description: 'Get the public URL or a signed download URL for a file in a storage bucket.',
    parameters: {
      type: 'object',
      properties: {
        instanceName: { type: 'string', description: 'Instance name' },
        bucketId: { type: 'string', description: 'Bucket ID' },
        filePath: { type: 'string', description: 'Path to the file' },
        signed: {
          type: 'boolean',
          description: 'If true, generate a signed (temporary) URL. Default: false (public URL).',
        },
        expiresIn: {
          type: 'number',
          description: 'Expiry for signed URL in seconds (default: 3600)',
        },
      },
      required: ['instanceName', 'bucketId', 'filePath'],
    },
  },
  {
    name: 'list_auth_users',
    description:
      'List Auth users of a Supabase instance with pagination. Does NOT require confirmation.',
    parameters: {
      type: 'object',
      properties: {
        instanceName: { type: 'string', description: 'Instance name' },
        page: { type: 'number', description: 'Page number (default: 1)' },
        perPage: { type: 'number', description: 'Users per page (default: 50, max: 200)' },
      },
      required: ['instanceName'],
    },
  },

  // ===== EDGE FUNCTIONS =====
  {
    name: 'list_functions',
    description: 'List all edge functions for a Supabase instance.',
    parameters: {
      type: 'object',
      properties: { instanceName: { type: 'string', description: 'Instance name' } },
      required: ['instanceName'],
    },
  },
  {
    name: 'get_function',
    description: 'Get the source code of a specific Edge Function.',
    parameters: {
      type: 'object',
      properties: {
        instanceName: { type: 'string', description: 'Instance name' },
        functionName: { type: 'string', description: 'Function name' },
      },
      required: ['instanceName', 'functionName'],
    },
  },
  {
    name: 'create_function',
    description:
      'Create a new Edge Function with Deno TypeScript code. If no code is provided, a minimal starter template is created. The user MUST confirm this action.',
    parameters: {
      type: 'object',
      properties: {
        instanceName: { type: 'string', description: 'Instance name' },
        functionName: {
          type: 'string',
          description: 'Name of the new function (alphanumeric and hyphens only)',
        },
        code: {
          type: 'string',
          description: 'Deno TypeScript source code (index.ts). If omitted a minimal template is used.',
        },
      },
      required: ['instanceName', 'functionName'],
    },
  },
  {
    name: 'update_function',
    description:
      'Update (overwrite) the source code of an existing Edge Function. The user MUST confirm this action.',
    parameters: {
      type: 'object',
      properties: {
        instanceName: { type: 'string', description: 'Instance name' },
        functionName: { type: 'string', description: 'Function name to update' },
        code: { type: 'string', description: 'New Deno TypeScript source code' },
      },
      required: ['instanceName', 'functionName', 'code'],
    },
  },
  {
    name: 'delete_function',
    description: 'Delete an Edge Function permanently. The user MUST confirm this action.',
    parameters: {
      type: 'object',
      properties: {
        instanceName: { type: 'string', description: 'Instance name' },
        functionName: { type: 'string', description: 'Function name to delete' },
      },
      required: ['instanceName', 'functionName'],
    },
  },
  {
    name: 'deploy_function',
    description:
      'Deploy (activate/restart) an Edge Function so code changes take effect. The user MUST confirm this action.',
    parameters: {
      type: 'object',
      properties: {
        instanceName: { type: 'string', description: 'Instance name' },
        functionName: { type: 'string', description: 'Function name to deploy' },
      },
      required: ['instanceName', 'functionName'],
    },
  },
  {
    name: 'invoke_function',
    description:
      'Invoke (call/test) an Edge Function and return its response. Useful for testing.',
    parameters: {
      type: 'object',
      properties: {
        instanceName: { type: 'string', description: 'Instance name' },
        functionName: { type: 'string', description: 'Function name to invoke' },
        payload: {
          type: 'object',
          description: 'JSON payload to send in the request body (optional)',
        },
        method: {
          type: 'string',
          enum: ['GET', 'POST', 'PUT', 'DELETE'],
          description: 'HTTP method (default: POST)',
        },
      },
      required: ['instanceName', 'functionName'],
    },
  },
  {
    name: 'get_function_logs',
    description: 'Get logs for a specific edge function.',
    parameters: {
      type: 'object',
      properties: {
        instanceName: { type: 'string', description: 'Instance name' },
        functionName: { type: 'string', description: 'Function name' },
      },
      required: ['instanceName', 'functionName'],
    },
  },

  // ===== DATABASE / SQL =====
  {
    name: 'execute_sql',
    description:
      "Execute a SQL query on a Supabase instance's PostgreSQL database. This is DESTRUCTIVE for write queries and the user MUST confirm.",
    parameters: {
      type: 'object',
      properties: {
        instanceName: { type: 'string', description: 'Instance name' },
        sql: { type: 'string', description: 'SQL query to execute' },
      },
      required: ['instanceName', 'sql'],
    },
  },
  {
    name: 'list_tables',
    description:
      'List all tables in a given schema of a Supabase instance database. Does NOT require confirmation.',
    parameters: {
      type: 'object',
      properties: {
        instanceName: { type: 'string', description: 'Instance name' },
        schema: {
          type: 'string',
          description: 'Schema name (default: public)',
        },
      },
      required: ['instanceName'],
    },
  },
  {
    name: 'describe_table',
    description:
      'Describe the columns, types, nullability and default values of a specific table. Does NOT require confirmation.',
    parameters: {
      type: 'object',
      properties: {
        instanceName: { type: 'string', description: 'Instance name' },
        schema: { type: 'string', description: 'Schema name (default: public)' },
        table: { type: 'string', description: 'Table name' },
      },
      required: ['instanceName', 'table'],
    },
  },
  {
    name: 'list_rls_policies',
    description:
      'List all Row-Level Security (RLS) policies for a table or all tables in a schema. Does NOT require confirmation.',
    parameters: {
      type: 'object',
      properties: {
        instanceName: { type: 'string', description: 'Instance name' },
        schema: { type: 'string', description: 'Schema name (default: public)' },
        table: { type: 'string', description: 'Table name (optional, omit to list all)' },
      },
      required: ['instanceName'],
    },
  },
  {
    name: 'create_rls_policy',
    description:
      'Create a new Row-Level Security (RLS) policy on a table. The user MUST confirm this action.',
    parameters: {
      type: 'object',
      properties: {
        instanceName: { type: 'string', description: 'Instance name' },
        schema: { type: 'string', description: 'Schema name (default: public)' },
        table: { type: 'string', description: 'Table name' },
        policyName: { type: 'string', description: 'Name for the new policy' },
        command: {
          type: 'string',
          enum: ['ALL', 'SELECT', 'INSERT', 'UPDATE', 'DELETE'],
          description: 'SQL command the policy applies to',
        },
        roles: {
          type: 'string',
          description: 'Comma-separated roles (e.g. "authenticated, anon"). Use "PUBLIC" for all.',
        },
        usingExpression: {
          type: 'string',
          description: 'USING expression (for SELECT/UPDATE/DELETE) — boolean SQL expression',
        },
        withCheckExpression: {
          type: 'string',
          description: 'WITH CHECK expression (for INSERT/UPDATE) — boolean SQL expression',
        },
      },
      required: ['instanceName', 'table', 'policyName', 'command'],
    },
  },
  {
    name: 'drop_rls_policy',
    description:
      'Drop (delete) a Row-Level Security policy from a table. The user MUST confirm this action.',
    parameters: {
      type: 'object',
      properties: {
        instanceName: { type: 'string', description: 'Instance name' },
        schema: { type: 'string', description: 'Schema name (default: public)' },
        table: { type: 'string', description: 'Table name' },
        policyName: { type: 'string', description: 'Policy name to drop' },
      },
      required: ['instanceName', 'table', 'policyName'],
    },
  },
  {
    name: 'enable_rls',
    description:
      'Enable Row-Level Security (RLS) on a table. The user MUST confirm this action.',
    parameters: {
      type: 'object',
      properties: {
        instanceName: { type: 'string', description: 'Instance name' },
        schema: { type: 'string', description: 'Schema name (default: public)' },
        table: { type: 'string', description: 'Table name' },
      },
      required: ['instanceName', 'table'],
    },
  },
  {
    name: 'disable_rls',
    description:
      'Disable Row-Level Security (RLS) on a table. The user MUST confirm this action.',
    parameters: {
      type: 'object',
      properties: {
        instanceName: { type: 'string', description: 'Instance name' },
        schema: { type: 'string', description: 'Schema name (default: public)' },
        table: { type: 'string', description: 'Table name' },
      },
      required: ['instanceName', 'table'],
    },
  },

  // ===== AUDIT =====
  {
    name: 'get_audit_logs',
    description:
      'List audit logs with optional filtering by action, date range, or success status.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Filter by action type (e.g. INSTANCE_CREATE, BACKUP_CREATE)',
        },
        limit: { type: 'number', description: 'Max entries to return (default: 50, max: 200)' },
        startDate: { type: 'string', description: 'ISO date string for start range' },
        endDate: { type: 'string', description: 'ISO date string for end range' },
      },
      required: [],
    },
  },
  {
    name: 'get_audit_stats',
    description:
      'Get audit log statistics: total events, last 24h, last 7d, failed events, top actions.',
    parameters: { type: 'object', properties: {}, required: [] },
  },

  // ===== ALERTS =====
  {
    name: 'list_alerts',
    description: 'List all active alerts and alert rules.',
    parameters: {
      type: 'object',
      properties: {
        instanceId: { type: 'string', description: 'Filter by instance name (optional)' },
        status: {
          type: 'string',
          enum: ['active', 'acknowledged', 'resolved'],
          description: 'Filter by status',
        },
      },
      required: [],
    },
  },

  // ===== SCHEDULES =====
  {
    name: 'list_schedules',
    description: 'List all scheduled tasks (backups, maintenance, etc.).',
    parameters: { type: 'object', properties: {}, required: [] },
  },

  // ===== DEPLOYMENTS =====
  {
    name: 'list_deployments',
    description: 'List deployment history with optional filtering.',
    parameters: {
      type: 'object',
      properties: {
        instanceId: { type: 'string', description: 'Filter by instance ID' },
        status: {
          type: 'string',
          enum: ['pending', 'running', 'success', 'failed'],
          description: 'Filter by status',
        },
        limit: { type: 'number', description: 'Max entries (default: 50)' },
      },
      required: [],
    },
  },
  {
    name: 'get_deployment_stats',
    description:
      'Get deployment statistics overview: total, pending, running, success, failed counts.',
    parameters: { type: 'object', properties: {}, required: [] },
  },

  // ===== SETTINGS =====
  {
    name: 'get_settings',
    description: 'Get current system settings including SMTP configuration (passwords masked).',
    parameters: { type: 'object', properties: {}, required: [] },
  },
];

// Destructive tools that need user confirmation
const DESTRUCTIVE_TOOLS = [
  'create_instance',
  'stop_instance',
  'delete_instance',
  'create_template',
  'delete_template',
  'use_template',
  'create_backup',
  'restore_backup',
  'delete_backup',
  'create_bucket',
  'delete_bucket',
  'delete_file',
  'execute_sql',
  // Edge Functions
  'create_function',
  'update_function',
  'delete_function',
  'deploy_function',
  // RLS / Database
  'create_rls_policy',
  'drop_rls_policy',
  'enable_rls',
  'disable_rls',
];

// ============================================================
// Provider Adapters
// ============================================================

interface ProviderAdapter {
  chat(
    messages: Array<{ role: string; content: string | any[] }>,
    tools: ToolDefinition[],
    apiKey: string,
    model?: string
  ): Promise<{ content: string; toolCalls?: ToolCall[] }>;
}

class OpenAIAdapter implements ProviderAdapter {
  async chat(
    messages: Array<{ role: string; content: string | any[] }>,
    tools: ToolDefinition[],
    apiKey: string,
    model?: string
  ) {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey });

    const openaiTools = tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const response = await client.chat.completions.create({
      model: model || 'gpt-5-mini',
      messages: messages as any,
      tools: openaiTools,
      max_tokens: 2048,
    });

    const choice = response.choices[0];
    const toolCalls: ToolCall[] = [];

    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        const fn = (tc as any).function;
        toolCalls.push({
          id: tc.id,
          name: fn.name,
          arguments: JSON.parse(fn.arguments),
        });
      }
    }

    return {
      content: choice.message.content || '',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }
}

class AnthropicAdapter implements ProviderAdapter {
  async chat(
    messages: Array<{ role: string; content: string | any[] }>,
    tools: ToolDefinition[],
    apiKey: string,
    model?: string
  ) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });

    // Extract system message
    const systemMsg = messages.find((m) => m.role === 'system');

    // Map messages to Anthropic format
    const chatMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m: any) => {
        if (m.role === 'assistant' && m.tool_calls) {
          const content: any[] = [];
          if (m.content) {
            content.push({ type: 'text', text: m.content });
          }
          m.tool_calls.forEach((tc: any) => {
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.function.name,
              input: JSON.parse(tc.function.arguments),
            });
          });
          return { role: 'assistant', content };
        }

        if (m.role === 'tool') {
          return {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: m.tool_call_id,
                content: m.content,
              },
            ],
          };
        }

        return {
          role: m.role as 'user' | 'assistant',
          content: m.content || '', // Handle null content safely
        };
      });

    const anthropicTools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as any,
    }));

    const response: any = await (client.messages as any).create({
      model: model || 'claude-sonnet-5',
      max_tokens: 2048,
      system: systemMsg?.content || '',
      messages: chatMessages as any,
      tools: anthropicTools as any,
    });

    let content = '';
    const toolCalls: ToolCall[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: (block as any).input as Record<string, any>,
        });
      }
    }

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }
}

class GeminiAdapter implements ProviderAdapter {
  async chat(
    messages: Array<{ role: string; content: string | any[] }>,
    tools: ToolDefinition[],
    apiKey: string,
    model?: string
  ) {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(apiKey);

    const geminiTools = [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      },
    ];

    // Convert messages to Gemini format
    const systemMsg = messages.find((m) => m.role === 'system');

    const getSystemContent = (content: string | any[] | undefined) => {
      if (!content) return undefined;
      if (typeof content === 'string') return content;
      // Extract text from array
      const textPart = content.find((p: any) => p.type === 'text');
      return textPart ? textPart.text : undefined;
    };

    const genModel = genAI.getGenerativeModel({
      model: model || 'gemini-3.6-flash',
      tools: geminiTools as any,
      systemInstruction: getSystemContent(systemMsg?.content),
    });

    const chatMessages = messages
      .filter((m) => m.role !== 'system')
      .filter((m) => m.content !== null && m.content !== '') // Filter out tool invocation without content
      .filter((m) => m.role !== 'tool') // Filter out tool results for now (until adapter supports them)
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const chat = genModel.startChat({
      history: chatMessages.slice(0, -1) as any,
    });

    const lastMessage = chatMessages[chatMessages.length - 1];
    const result = await chat.sendMessage(lastMessage.parts[0].text);
    const response = result.response;

    let content = '';
    const toolCalls: ToolCall[] = [];

    for (const candidate of response.candidates || []) {
      for (const part of candidate.content?.parts || []) {
        if (part.text) {
          content += part.text;
        }
        if (part.functionCall) {
          toolCalls.push({
            id: `gemini_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            name: part.functionCall.name,
            arguments: part.functionCall.args as Record<string, any>,
          });
        }
      }
    }

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }
}

class OpenRouterAdapter implements ProviderAdapter {
  async chat(
    messages: Array<{ role: string; content: string | any[] }>,
    tools: ToolDefinition[],
    apiKey: string,
    model?: string
  ) {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://multibase.app',
        'X-Title': 'Multibase Dashboard',
      },
    });

    const openaiTools = tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const response = await client.chat.completions.create({
      model: model || 'openai/gpt-5.6-sol',
      messages: messages as any,
      tools: openaiTools,
      max_tokens: 2048,
    });

    const choice = response.choices[0];
    const toolCalls: ToolCall[] = [];

    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        const fn = (tc as any).function;
        toolCalls.push({
          id: tc.id,
          name: fn.name,
          arguments: JSON.parse(fn.arguments),
        });
      }
    }

    return {
      content: choice.message.content || '',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }
}

// ============================================================
// AiAgentService
// ============================================================

const SYSTEM_PROMPT = `You are the Multibase AI Assistant — an intelligent, proactive helper integrated into the Multibase Dashboard for managing self-hosted Supabase instances.

You have FULL ACCESS to the entire dashboard and can help users with:

**Instance Management:**
- List, create, start, stop, restart, and delete Supabase instances
- Check instance health, status, and service details
- View instance credentials (API keys, URLs, passwords)

**Templates:**
- List, create, and delete instance templates
- Create instances from templates with optional overrides

**Monitoring & Metrics:**
- System-wide metrics (CPU, memory, instance counts)
- Per-instance resource usage and uptime statistics

**Logs:**
- View logs for entire instances or specific services (postgres, kong, studio, auth, etc.)

**Backups:**
- List, create, restore, and delete backups
- Support for instance, full, and database backup types

**Storage:**
- List, create, and delete storage buckets
- Browse and manage files in buckets
- Get public or signed (temporary) download URLs for files

**Edge Functions:**
- List, create, update, delete, and deploy Deno edge functions
- Invoke/test functions and view their logs

**Database:**
- Execute arbitrary SQL queries on instance PostgreSQL databases
- List tables and describe their schema (columns, types, constraints)

**Row-Level Security (RLS):**
- List all RLS policies on tables
- Create, drop, enable, and disable RLS policies
- Build policies for roles like \`authenticated\` or \`anon\`

**Auth:**
- List Auth users of an instance with pagination

**Audit & Security:**
- View audit logs and statistics
- List alerts and alert rules

**Schedules & Deployments:**
- View scheduled tasks and deployment history
- Deployment statistics

**Settings:**
- View system settings (SMTP, etc.)

Rules:
1. Always be helpful, proactive, and conversational.
2. **When creating instances or templates**, always ask the user follow-up questions to understand exactly what they want:
   - For instances: ask about name, deployment type (localhost/cloud), domain, resource limits, etc.
   - For templates: ask about the configuration they want to save
   - Present options clearly and let the user choose
3. When performing destructive actions (create, stop, delete, SQL execute, modify RLS, deploy functions), always explain what will happen before executing.
4. Format your responses in Markdown for readability.
5. If a tool call fails, explain the error clearly and suggest alternatives.
6. When listing data, present it in a clear, structured format using tables or lists.
7. Respond in the same language the user writes in.
8. You can chain multiple tool calls to gather information and answer complex questions.
9. For RLS policies, always use \`list_tables\` and \`list_rls_policies\` first to understand the current state before making changes.
10. For edge functions, always use \`list_functions\` first and \`get_function\` when you need to read existing code before updating it.

You are part of the Multibase Dashboard and have direct access to ALL dashboard features via tools. Use them proactively to help the user.`;

export class AiAgentService {
  private prisma: PrismaClient;
  private instanceManager: any;
  private dockerManager: any;
  private metricsCollector: any;
  private redisCache: any;
  private uptimeService: any;
  private functionService: any;
  private storageService: any;
  private adapters: Record<string, ProviderAdapter>;

  constructor(
    prisma: PrismaClient,
    instanceManager: any,
    dockerManager: any,
    services: {
      metricsCollector?: any;
      redisCache?: any;
      uptimeService?: any;
      functionService?: any;
      storageService?: any;
    } = {}
  ) {
    this.prisma = prisma;
    this.instanceManager = instanceManager;
    this.dockerManager = dockerManager;
    this.metricsCollector = services.metricsCollector;
    this.redisCache = services.redisCache;
    this.uptimeService = services.uptimeService;
    this.functionService = services.functionService;
    this.storageService = services.storageService;
    this.adapters = {
      openai: new OpenAIAdapter(),
      gemini: new GeminiAdapter(),
      anthropic: new AnthropicAdapter(),
      openrouter: new OpenRouterAdapter(),
    };
  }

  /**
   * Get or create the user's AI API key and provider
   */
  async getUserAiConfig(
    userId: string
  ): Promise<{ provider: string; apiKey: string; model?: string } | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { aiProvider: true, aiApiKeyEncrypted: true },
    });

    if (!user?.aiProvider || !user?.aiApiKeyEncrypted) {
      return null;
    }

    try {
      const apiKey = decrypt(user.aiApiKeyEncrypted);
      return { provider: user.aiProvider, apiKey };
    } catch (error) {
      logger.error('Failed to decrypt AI API key:', error);
      return null;
    }
  }

  /**
   * Chat with the AI agent
   */
  async chat(
    userId: string,
    sessionId: string,
    userMessage: string,
    onChunk?: (chunk: StreamChunk) => void,
    image?: string,
    model?: string
  ): Promise<AiMessage> {
    // Get user's AI config
    const aiConfig = await this.getUserAiConfig(userId);
    if (!aiConfig) {
      throw new Error('No AI API key configured. Please add one in your profile settings.');
    }

    if (model) {
      aiConfig.model = model;
    }

    const adapter = this.adapters[aiConfig.provider];
    if (!adapter) {
      throw new Error(`Unsupported AI provider: ${aiConfig.provider}`);
    }

    // Save user message
    await this.prisma.aiChatMessage.create({
      data: {
        sessionId,
        role: 'user',
        content: image ? `${userMessage}\n\n![User Image](${image})` : userMessage,
      },
    });

    // Auto-update session title from first user message
    const messageCount = await this.prisma.aiChatMessage.count({ where: { sessionId } });
    if (messageCount === 1) {
      const title = userMessage.slice(0, 80) + (userMessage.length > 80 ? '...' : '');
      await this.prisma.aiChatSession.update({
        where: { id: sessionId },
        data: { title },
      });
    }

    const messages = await this.buildContext(sessionId, aiConfig.provider);
    return this.runAgentLoop(userId, sessionId, messages, aiConfig, onChunk);
  }

  /**
   * Continue chat after a tool execution (without new user message)
   */
  async continueChat(
    userId: string,
    sessionId: string,
    onChunk?: (chunk: StreamChunk) => void
  ): Promise<AiMessage> {
    const aiConfig = await this.getUserAiConfig(userId);
    if (!aiConfig) {
      throw new Error('No AI API key configured.');
    }

    const messages = await this.buildContext(sessionId, aiConfig.provider);
    return this.runAgentLoop(userId, sessionId, messages, aiConfig, onChunk);
  }

  /**
   * Build context from history
   */
  private async buildContext(sessionId: string, provider: string): Promise<any[]> {
    // Load chat history
    const history = await this.prisma.aiChatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      take: 50, // Limit context window
    });

    // Build messages array
    const messages: any[] = [{ role: 'system', content: SYSTEM_PROMPT }];

    // Helper to parse JSON safely
    const parseJSON = (str: string | null) => {
      if (!str) return [];
      try {
        return JSON.parse(str);
      } catch {
        return [];
      }
    };

    for (const msg of history) {
      if (msg.role === 'user' || msg.role === 'system') {
        let content: any = msg.content;

        // Check for image in content (marked as ![User Image](data:...))
        if (
          msg.role === 'user' &&
          typeof msg.content === 'string' &&
          msg.content.includes('![User Image](data:')
        ) {
          const imageMatch = msg.content.match(
            /!\[User Image\]\((data:image\/[^;]+;base64,[^)]+)\)/
          );
          if (imageMatch) {
            const imageUrl = imageMatch[1];
            const textContent = msg.content.replace(imageMatch[0], '').trim();

            if (provider === 'openai' || provider === 'openrouter') {
              content = [
                { type: 'text', text: textContent },
                { type: 'image_url', image_url: { url: imageUrl } },
              ];
            } else if (provider === 'anthropic') {
              // Anthropic needs { type: 'image', source: { type: 'base64', media_type: ..., data: ... } }
              // Extract media type and base64
              const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
              if (matches) {
                content = [
                  { type: 'text', text: textContent },
                  {
                    type: 'image',
                    source: {
                      type: 'base64',
                      media_type: matches[1],
                      data: matches[2],
                    },
                  },
                ];
              }
            }
            // Gemini handling could be added here
          }
        }

        messages.push({ role: msg.role, content });
        continue;
      }

      const toolCalls = parseJSON(msg.toolCalls);
      const toolResults = parseJSON(msg.toolResults);

      if (msg.role === 'assistant') {
        if (toolCalls.length > 0) {
          // Check for results
          if (toolResults.length > 0) {
            // Scenario A: Auto-executed
            messages.push({
              role: 'assistant',
              content: null,
              tool_calls: toolCalls.map((tc: any) => ({
                id: tc.id,
                type: 'function',
                function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
              })),
            });

            for (const res of toolResults) {
              messages.push({
                role: 'tool',
                tool_call_id: res.toolCallId,
                content: JSON.stringify(res.result),
              });
            }

            if (msg.content) {
              messages.push({ role: 'assistant', content: msg.content });
            }
          } else {
            // Scenario B: Manual execution required
            messages.push({
              role: 'assistant',
              content: msg.content || null,
              tool_calls: toolCalls.map((tc: any) => ({
                id: tc.id,
                type: 'function',
                function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
              })),
            });
          }
        } else {
          messages.push({ role: 'assistant', content: msg.content });
        }
      } else if (msg.role === 'tool') {
        // Manual tool execution result (stored as separate message)
        for (const res of toolResults) {
          messages.push({
            role: 'tool',
            tool_call_id: res.toolCallId,
            content: JSON.stringify(res.result),
          });
        }
      }
    }

    // New Sanitization Logic: Tool Hoisting
    // We must ensure Assistant(ToolCalls) is IMMEDIATELY followed by Tool(Results).
    // If there are intervening User messages, we hoist the Tool message up.

    const reorderedMessages: any[] = [];
    const usedToolCallIds = new Set<string>(); // Track which tool messages we've moved

    // First pass: Index tool messages by ID for easy lookup
    const toolMessagesById = new Map<string, any>();
    for (const msg of messages) {
      if (msg.role === 'tool' && msg.tool_call_id) {
        toolMessagesById.set(msg.tool_call_id, msg);
      }
    }

    for (const msg of messages) {
      // If this is a tool message we've already hoisted, skip it
      if (msg.role === 'tool' && msg.tool_call_id && usedToolCallIds.has(msg.tool_call_id)) {
        continue;
      }

      if (
        msg.role === 'assistant' &&
        msg.tool_calls &&
        Array.isArray(msg.tool_calls) &&
        msg.tool_calls.length > 0
      ) {
        // This assistant message has tool calls.
        // We need to find if we have results for ALL of them (or AT LEAST ONE, depending on strictness).
        // Use strict matching: If we have a matching tool result anywhere in the future, we hoist it.

        const matchedToolMessages: any[] = [];
        let allCallsHaveResults = true;

        for (const tc of msg.tool_calls) {
          const toolMsg = toolMessagesById.get(tc.id);
          if (toolMsg) {
            matchedToolMessages.push(toolMsg);
            usedToolCallIds.add(tc.id);
          } else {
            allCallsHaveResults = false;
          }
        }

        if (matchedToolMessages.length > 0) {
          // We found matching results! Hoist them here.
          // Note: If some calls are missing results, OpenAI might still complain if we leave the missing IDs in tool_calls.
          // Ideally we filter `tool_calls` to only those we have results for, OR we strip if not comprehensive.
          // For now, let's look at the result.

          reorderedMessages.push(msg);
          // Push all found tool results immediately after
          reorderedMessages.push(...matchedToolMessages);
        } else {
          // No results found for this tool call (e.g. pending confirmation or interrupted).
          // Strip the tool_calls to prevent "Orphaned Assistant Tool Call" error (400)
          const { tool_calls, ...rest } = msg;
          if (!rest.content) {
            rest.content = 'Please confirm the above action.';
          }
          reorderedMessages.push(rest);
        }
      } else {
        // User, System, or Assistant-without-tools
        // Just push it
        reorderedMessages.push(msg);
      }
    }

    // Final sanity check (OpenAI specific but good practice generally)
    const sanitizedMessages: any[] = [];
    let validToolCallIds = new Set<string>();

    for (const msg of reorderedMessages) {
      if (msg.role === 'assistant') {
        sanitizedMessages.push(msg);
        if (msg.tool_calls) {
          msg.tool_calls.forEach((tc: any) => validToolCallIds.add(tc.id));
        }
      } else if (msg.role === 'tool') {
        if (validToolCallIds.has(msg.tool_call_id)) {
          if (typeof msg.content !== 'string') {
            msg.content = JSON.stringify(msg.content);
          }
          sanitizedMessages.push(msg);
        } else {
          // Drop orphaned tool msg (shouldn't happen with above logic but safe guard)
          logger.warn(
            `[AiAgentService] Dropping orphaned tool message in sanity check: ${msg.tool_call_id}`
          );
        }
      } else {
        validToolCallIds.clear();
        sanitizedMessages.push(msg);
      }
    }

    // Debug logging
    if (provider === 'openai') {
      logger.info(`[AiAgentService] Sending ${sanitizedMessages.length} messages to OpenAI`);
    }

    return sanitizedMessages;
  }

  /**
   * Run the agent logic loop
   */
  private async runAgentLoop(
    _userId: string,
    sessionId: string,
    messages: any[],
    aiConfig: { provider: string; apiKey: string; model?: string },
    onChunk?: (chunk: StreamChunk) => void
  ): Promise<AiMessage> {
    const adapter = this.adapters[aiConfig.provider];
    if (!adapter) throw new Error('Adapter not found');

    let currentMessages = [...messages];
    const MAX_TURNS = 5;
    let turnCount = 0;

    try {
      onChunk?.({ type: 'text', content: '' }); // Signal start

      while (turnCount < MAX_TURNS) {
        turnCount++;

        const response = await adapter.chat(
          currentMessages,
          TOOL_DEFINITIONS,
          aiConfig.apiKey,
          aiConfig.model
        );

        // If no tool calls, we are done
        if (!response.toolCalls || response.toolCalls.length === 0) {
          // Stream the final content
          if (response.content) {
            onChunk?.({ type: 'text', content: response.content });
          }
          onChunk?.({ type: 'done' });

          // Save assistant message
          await this.prisma.aiChatMessage.create({
            data: {
              sessionId,
              role: 'assistant',
              content: response.content || '',
            },
          });

          // Update session timestamp
          await this.prisma.aiChatSession.update({
            where: { id: sessionId },
            data: { updatedAt: new Date() },
          });

          return {
            role: 'assistant',
            content: response.content || '',
            toolCalls: undefined,
            toolResults: undefined,
          };
        }

        // Handle tool calls
        const allToolCalls = response.toolCalls;
        const allToolResults: ToolResult[] = [];
        let needsConfirmation = false;

        // Check strictly for destructive tools FIRST
        for (const call of allToolCalls) {
          if (DESTRUCTIVE_TOOLS.includes(call.name)) {
            needsConfirmation = true;
            break; // Found one, no need to check further
          }
        }

        if (needsConfirmation) {
          // If ANY tool needs confirmation, we stop here and ask user
          // We save the assistant message with tool calls but NO results
          await this.prisma.aiChatMessage.create({
            data: {
              sessionId,
              role: 'assistant',
              content: response.content || 'Please confirm this action.',
              toolCalls: JSON.stringify(allToolCalls),
              // No toolResults yet
            },
          });

          // Stream the content before tool call
          if (response.content) {
            onChunk?.({ type: 'text', content: response.content });
          }

          // Stream the tool calls with confirmation flag
          for (const toolCall of allToolCalls) {
            onChunk?.({
              type: 'tool_call',
              toolCall: {
                ...toolCall,
                arguments: { ...toolCall.arguments, needsConfirmation: true },
              },
            });
          }
          onChunk?.({ type: 'done' });

          // We DO NOT execute tools.
          return {
            role: 'assistant',
            content: response.content || '',
            toolCalls: allToolCalls,
            toolResults: undefined,
          };
        }

        // If no confirmation needed, execute all tools
        // Stream content before auto-executing tools
        if (response.content) {
          onChunk?.({ type: 'text', content: response.content });
        }

        for (const call of allToolCalls) {
          onChunk?.({ type: 'tool_call', toolCall: call }); // Stream tool call
          try {
            const result = await this.executeTool(call, _userId);
            allToolResults.push({
              toolCallId: call.id,
              name: call.name,
              result,
            });
            onChunk?.({
              type: 'tool_result',
              toolResult: { toolCallId: call.id, name: call.name, result },
            });
          } catch (error: any) {
            allToolResults.push({
              toolCallId: call.id,
              name: call.name,
              result: { error: error.message },
            });
            onChunk?.({
              type: 'tool_result',
              toolResult: {
                toolCallId: call.id,
                name: call.name,
                result: { error: error.message },
              },
            });
          }
        }

        // Save the assistant message + results (since they were auto-executed)
        await this.prisma.aiChatMessage.create({
          data: {
            sessionId,
            role: 'assistant',
            content: response.content || '',
            toolCalls: JSON.stringify(allToolCalls),
            toolResults: JSON.stringify(allToolResults),
          },
        });

        // Prepare next turn
        // Append assistant message
        currentMessages.push({
          role: 'assistant',
          content: response.content || null,
          tool_calls: allToolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        });

        // Append tool results
        for (const res of allToolResults) {
          currentMessages.push({
            role: 'tool',
            tool_call_id: res.toolCallId,
            content: JSON.stringify(res.result),
          });
        }

        // Loop continues...
      }

      // If max turns reached, return a message indicating that
      const maxTurnsMessage: AiMessage = {
        role: 'assistant',
        content: 'Max turns reached. Please try rephrasing your request.',
      };
      onChunk?.({ type: 'text', content: maxTurnsMessage.content });
      onChunk?.({ type: 'done' });

      await this.prisma.aiChatMessage.create({
        data: {
          sessionId,
          role: 'assistant',
          content: maxTurnsMessage.content,
        },
      });

      await this.prisma.aiChatSession.update({
        where: { id: sessionId },
        data: { updatedAt: new Date() },
      });

      return maxTurnsMessage;
    } catch (error: any) {
      logger.error('AI chat error:', error);
      onChunk?.({ type: 'error', error: error.message });

      // Check for common API errors
      if (
        error.message?.includes('401') ||
        error.message?.includes('Unauthorized') ||
        error.message?.includes('invalid_api_key')
      ) {
        throw new Error(
          'Invalid API key. Please check your AI provider API key in profile settings.'
        );
      }
      if (error.message?.includes('429') || error.message?.includes('rate_limit')) {
        throw new Error('Rate limit exceeded. Please wait a moment and try again.');
      }
      throw error;
    }
  }

  /**
   * Execute multiple confirmed destructive tools
   */
  async executeConfirmedTools(
    userId: string,
    sessionId: string,
    toolCalls: ToolCall[]
  ): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const toolCall of toolCalls) {
      try {
        const result = await this.executeTool(toolCall, userId);
        results.push({
          toolCallId: toolCall.id,
          name: toolCall.name,
          result,
        });
      } catch (error: any) {
        results.push({
          toolCallId: toolCall.id,
          name: toolCall.name,
          result: { error: error.message },
        });
      }
    }

    // Save ALL tool result messages (as one entry or separate? OpenAI usually expects separate tool messages or one array in some clients)
    // Here we save them as separate messages to match history structure

    // Actually, `buildContext` expects separate messages with role 'tool'.
    // We can save them in bulk create if prisma supports it, or loop.

    const messagesToCreate = results.map((res) => ({
      sessionId,
      role: 'tool',
      content: JSON.stringify(res.result),
      toolResults: JSON.stringify([res]), // Legacy field, might be useful for simplistic retrieval
      toolCallId: res.toolCallId, // We need to store this so we can rebuild history correctly!
    }));

    // Wait, our schema might not have `toolCallId` column on `AiChatMessage`?
    // Let's check schema. If not, we rely on `toolResults` JSON having it.
    // Based on `buildContext`, we parse `toolResults` JSON.
    // And `buildContext` loop for `role === 'tool'` uses `res.toolCallId` from the parsed JSON.
    // So we just need to save the message with `toolResults` populated.

    // However, `buildContext` iterates `toolResults` array from the message.
    // So if we save multiple results in ONE message, `buildContext` should handle it if it iterates.
    // Let's check `buildContext` again.
    // Yes: `const toolResults = parseJSON(msg.toolResults); ... for (const res of toolResults) { messages.push(...) }`
    // So we can save ALL results in a SINGLE 'tool' message if we want, OR separate messages.
    // Separate messages are safer for granular timestamps, but one message is cleaner for "User confirmed batch".
    // Let's save one message with ALL results.

    await this.prisma.aiChatMessage.create({
      data: {
        sessionId,
        role: 'tool',
        content: JSON.stringify(results), // Store full array in content for duplicative safety
        toolResults: JSON.stringify(results),
      },
    });

    return results;
  }

  /**
   * Execute a confirmed destructive tool
   */
  async executeConfirmedTool(
    userId: string,
    sessionId: string,
    toolCall: ToolCall
  ): Promise<ToolResult> {
    const result = await this.executeTool(toolCall, userId);

    const toolResult: ToolResult = {
      toolCallId: toolCall.id,
      name: toolCall.name,
      result,
    };

    // Save tool result message
    await this.prisma.aiChatMessage.create({
      data: {
        sessionId,
        role: 'tool',
        content: JSON.stringify(result),
        toolResults: JSON.stringify([toolResult]),
      },
    });

    return toolResult;
  }

  private async executeTool(toolCall: ToolCall, userId: string): Promise<any> {
    const { name, arguments: args } = toolCall;

    try {
      switch (name) {
        // ===== INSTANCE MANAGEMENT =====
        case 'list_instances': {
          const instances = await this.instanceManager.listInstances();
          return {
            success: true,
            instances: instances.map((i: any) => ({
              name: i.name,
              status: i.status,
              health: i.health,
              ports: i.ports,
              createdAt: i.createdAt,
            })),
          };
        }

        case 'get_instance': {
          const instance = await this.instanceManager.getInstance(args.name);
          if (!instance) {
            return { success: false, error: `Instance "${args.name}" not found.` };
          }
          return { success: true, instance };
        }

        case 'create_instance': {
          const createReq: any = {
            name: args.name,
            deploymentType: args.deploymentType || 'localhost',
          };
          if (args.domain) createReq.domain = args.domain;
          if (args.protocol) createReq.protocol = args.protocol;
          if (args.basePort) createReq.basePort = args.basePort;
          if (args.resourceLimits) createReq.resourceLimits = args.resourceLimits;
          const instance = await this.instanceManager.createInstance(createReq);
          return {
            success: true,
            message: `Instance "${args.name}" created successfully.`,
            instance: {
              name: instance.name,
              status: instance.status,
              ports: instance.ports,
            },
          };
        }

        case 'start_instance': {
          await this.instanceManager.startInstance(args.name);
          return { success: true, message: `Instance "${args.name}" started successfully.` };
        }

        case 'stop_instance': {
          await this.instanceManager.stopInstance(args.name);
          return { success: true, message: `Instance "${args.name}" stopped successfully.` };
        }

        case 'restart_instance': {
          await this.instanceManager.restartInstance(args.name);
          return { success: true, message: `Instance "${args.name}" restarted successfully.` };
        }

        case 'delete_instance': {
          await this.instanceManager.deleteInstance(args.name, args.removeVolumes || false);
          return {
            success: true,
            message: `Instance "${args.name}" deleted successfully.${args.removeVolumes ? ' Volumes were also removed.' : ''}`,
          };
        }

        case 'get_instance_status': {
          const inst = await this.instanceManager.getInstance(args.name);
          if (!inst) {
            return { success: false, error: `Instance "${args.name}" not found.` };
          }
          return {
            success: true,
            name: inst.name,
            status: inst.status,
            health: inst.health,
            services: inst.services,
          };
        }

        // ===== TEMPLATES =====
        case 'list_templates': {
          const templates = await this.prisma.instanceTemplate.findMany({
            include: { creator: { select: { username: true, id: true } } },
            orderBy: { createdAt: 'desc' },
          });
          return {
            success: true,
            templates: templates.map((t: any) => ({
              id: t.id,
              name: t.name,
              description: t.description,
              config: JSON.parse(t.config),
              isPublic: t.isPublic,
              creator: t.creator?.username,
              createdAt: t.createdAt,
            })),
          };
        }

        case 'get_template': {
          const template = await this.prisma.instanceTemplate.findUnique({
            where: { id: args.id },
            include: { creator: { select: { username: true } } },
          });
          if (!template) return { success: false, error: 'Template not found.' };
          return {
            success: true,
            template: {
              ...template,
              config: JSON.parse(template.config),
            },
          };
        }

        case 'create_template': {
          let configStr: string;
          try {
            configStr = typeof args.config === 'string' ? args.config : JSON.stringify(args.config);
          } catch (e) {
            configStr = '{}';
          }

          const newTemplate = await this.prisma.instanceTemplate.create({
            data: {
              name: args.name,
              description: args.description || '',
              config: configStr,
              isPublic: args.isPublic || false,
              createdBy: userId,
            },
          });
          return {
            success: true,
            message: `Template "${args.name}" created successfully.`,
            template: { ...newTemplate, config: JSON.parse(newTemplate.config) },
          };
        }

        case 'delete_template': {
          await this.prisma.instanceTemplate.delete({ where: { id: args.id } });
          return { success: true, message: `Template ${args.id} deleted successfully.` };
        }

        case 'use_template': {
          const tmpl = await this.prisma.instanceTemplate.findUnique({
            where: { id: args.templateId },
          });
          if (!tmpl) return { success: false, error: 'Template not found.' };
          const config = { ...JSON.parse(tmpl.config), ...(args.overrides || {}) };
          const newInst = await this.instanceManager.createInstance({
            name: args.instanceName,
            deploymentType: config.deploymentType || 'localhost',
            basePort: config.basePort,
            corsOrigins: config.corsOrigins,
            domain: config.domain,
            protocol: config.protocol,
          });
          return {
            success: true,
            message: `Instance "${args.instanceName}" created from template "${tmpl.name}".`,
            instance: { name: newInst.name, status: newInst.status, ports: newInst.ports },
          };
        }

        // ===== METRICS & MONITORING =====
        case 'get_system_metrics': {
          if (!this.metricsCollector)
            return { success: false, error: 'Metrics service not available.' };
          const metrics = await this.metricsCollector.getSystemMetrics();
          return { success: true, metrics };
        }

        case 'get_instance_metrics': {
          if (!this.metricsCollector)
            return { success: false, error: 'Metrics service not available.' };
          const instMetrics = await this.metricsCollector.getInstanceMetrics(args.name);
          return { success: true, metrics: instMetrics };
        }

        case 'get_instance_uptime': {
          if (!this.uptimeService)
            return { success: false, error: 'Uptime service not available.' };
          const uptime = await this.uptimeService.getUptimeStats(args.name, args.days || 30);
          return { success: true, uptime };
        }

        // ===== LOGS =====
        case 'get_instance_logs': {
          const logs = await this.dockerManager.getInstanceLogs(args.name, args.tail || 50);
          return { success: true, logs };
        }

        case 'get_service_logs': {
          const svcLogs = await this.dockerManager.getServiceLogs(
            args.name,
            args.service,
            args.tail || 100
          );
          return { success: true, logs: svcLogs };
        }

        // ===== BACKUPS =====
        case 'list_backups': {
          const where: any = {};
          if (args.type) where.type = args.type;
          const backups = await this.prisma.backup.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: 50,
          });
          return { success: true, backups };
        }

        case 'create_backup': {
          const backupService = (await import('./BackupService')).default;
          const backup = await backupService.createBackup({
            type: args.type,
            instanceId: args.instanceId,
            name: args.name,
            createdBy: userId,
          });
          return { success: true, message: 'Backup created successfully.', backup };
        }

        case 'restore_backup': {
          const backupService = (await import('./BackupService')).default;
          await backupService.restoreBackup({
            backupId: args.backupId,
            instanceId: args.instanceId,
          });
          return { success: true, message: `Backup ${args.backupId} restored successfully.` };
        }

        case 'delete_backup': {
          await this.prisma.backup.delete({ where: { id: args.backupId } });
          return { success: true, message: `Backup ${args.backupId} deleted successfully.` };
        }

        // ===== STORAGE =====
        case 'list_buckets': {
          if (!this.storageService)
            return { success: false, error: 'Storage service not available.' };
          const buckets = await this.storageService.listBuckets(args.instanceName);
          return { success: true, buckets };
        }

        case 'list_files': {
          if (!this.storageService)
            return { success: false, error: 'Storage service not available.' };
          const files = await this.storageService.listFiles(
            args.instanceName,
            args.bucketId,
            args.path || ''
          );
          return { success: true, files };
        }

        case 'create_bucket': {
          if (!this.storageService)
            return { success: false, error: 'Storage service not available.' };
          const bucket = await this.storageService.createBucket(
            args.instanceName,
            args.bucketName,
            args.isPublic || false
          );
          return { success: true, message: `Bucket "${args.bucketName}" created.`, bucket };
        }

        case 'delete_bucket': {
          if (!this.storageService)
            return { success: false, error: 'Storage service not available.' };
          await this.storageService.deleteBucket(args.instanceName, args.bucketId);
          return { success: true, message: `Bucket "${args.bucketId}" deleted.` };
        }

        case 'delete_file': {
          if (!this.storageService)
            return { success: false, error: 'Storage service not available.' };
          await this.storageService.deleteFile(args.instanceName, args.bucketId, args.filePath);
          return {
            success: true,
            message: `File "${args.filePath}" deleted from bucket "${args.bucketId}".`,
          };
        }

        // ===== EDGE FUNCTIONS =====
        case 'list_functions': {
          if (!this.functionService)
            return { success: false, error: 'Function service not available.' };
          const functions = await this.functionService.listFunctions(args.instanceName);
          return { success: true, functions };
        }

        case 'get_function': {
          if (!this.functionService)
            return { success: false, error: 'Function service not available.' };
          const code = await this.functionService.getFunction(args.instanceName, args.functionName);
          return { success: true, functionName: args.functionName, code };
        }

        case 'create_function': {
          if (!this.functionService)
            return { success: false, error: 'Function service not available.' };
          const starterCode =
            args.code ||
            `import { serve } from "https://deno.land/std@0.177.0/http/server.ts";\n\nserve(async (_req) => {\n  return new Response(JSON.stringify({ message: "Hello from ${args.functionName}!" }), {\n    headers: { "Content-Type": "application/json" },\n  });\n});\n`;
          await this.functionService.saveFunction(args.instanceName, args.functionName, starterCode);
          return {
            success: true,
            message: `Edge function "${args.functionName}" created successfully.`,
          };
        }

        case 'update_function': {
          if (!this.functionService)
            return { success: false, error: 'Function service not available.' };
          await this.functionService.saveFunction(args.instanceName, args.functionName, args.code);
          return {
            success: true,
            message: `Edge function "${args.functionName}" updated successfully.`,
          };
        }

        case 'delete_function': {
          if (!this.functionService)
            return { success: false, error: 'Function service not available.' };
          await this.functionService.deleteFunction(args.instanceName, args.functionName);
          return {
            success: true,
            message: `Edge function "${args.functionName}" deleted successfully.`,
          };
        }

        case 'deploy_function': {
          if (!this.functionService)
            return { success: false, error: 'Function service not available.' };
          await this.functionService.deployFunction(args.instanceName, args.functionName);
          return {
            success: true,
            message: `Edge function "${args.functionName}" deployed successfully.`,
          };
        }

        case 'invoke_function': {
          if (!this.functionService)
            return { success: false, error: 'Function service not available.' };
          const instance = await this.instanceManager.getInstance(args.instanceName);
          if (!instance) return { success: false, error: `Instance "${args.instanceName}" not found.` };
          const port = instance.ports?.kong || instance.ports?.gateway;
          if (!port) return { success: false, error: 'Could not determine instance port.' };
          const method = args.method || 'POST';
          const url = `http://localhost:${port}/functions/v1/${args.functionName}`;
          const fetchOptions: RequestInit = { method };
          if (args.payload && method !== 'GET') {
            (fetchOptions as any).headers = { 'Content-Type': 'application/json' };
            fetchOptions.body = JSON.stringify(args.payload);
          }
          const resp = await fetch(url, fetchOptions);
          const text = await resp.text();
          let body: any = text;
          try { body = JSON.parse(text); } catch { /* keep as text */ }
          return { success: true, status: resp.status, body };
        }

        case 'get_function_logs': {
          if (!this.functionService)
            return { success: false, error: 'Function service not available.' };
          const fnLogs = await this.functionService.getFunctionLogs(
            args.instanceName,
            args.functionName
          );
          return { success: true, logs: fnLogs };
        }

        // ===== DATABASE / SQL =====
        case 'execute_sql': {
          const migrationService = new MigrationService(this.prisma);
          // Allow destructive operations since user confirmed the tool execution
          const sqlResult = await migrationService.executeSql(
            args.instanceName,
            args.sql,
            userId,
            true
          );
          return { success: true, result: sqlResult };
        }

        case 'list_tables': {
          const migrationService = new MigrationService(this.prisma);
          const schema = args.schema || 'public';
          const result = await migrationService.executeSql(
            args.instanceName,
            `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = '${schema}' ORDER BY table_name;`,
            userId,
            false
          );
          return { success: true, schema, tables: result };
        }

        case 'describe_table': {
          const migrationService = new MigrationService(this.prisma);
          const schema = args.schema || 'public';
          const result = await migrationService.executeSql(
            args.instanceName,
            `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${args.table}' ORDER BY ordinal_position;`,
            userId,
            false
          );
          return { success: true, schema, table: args.table, columns: result };
        }

        case 'list_rls_policies': {
          const migrationService = new MigrationService(this.prisma);
          const schema = args.schema || 'public';
          const tableFilter = args.table ? `AND tablename = '${args.table}'` : '';
          const result = await migrationService.executeSql(
            args.instanceName,
            `SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = '${schema}' ${tableFilter} ORDER BY tablename, policyname;`,
            userId,
            false
          );
          return { success: true, policies: result };
        }

        case 'create_rls_policy': {
          const migrationService = new MigrationService(this.prisma);
          const schema = args.schema || 'public';
          const roles = args.roles ? `TO ${args.roles}` : '';
          const using = args.usingExpression ? `USING (${args.usingExpression})` : '';
          const withCheck = args.withCheckExpression
            ? `WITH CHECK (${args.withCheckExpression})`
            : '';
          const sql = `CREATE POLICY "${args.policyName}" ON "${schema}"."${args.table}" AS PERMISSIVE FOR ${args.command} ${roles} ${using} ${withCheck};`;
          const result = await migrationService.executeSql(args.instanceName, sql, userId, true);
          return {
            success: true,
            message: `RLS policy "${args.policyName}" created on "${args.table}".`,
            result,
          };
        }

        case 'drop_rls_policy': {
          const migrationService = new MigrationService(this.prisma);
          const schema = args.schema || 'public';
          const sql = `DROP POLICY IF EXISTS "${args.policyName}" ON "${schema}"."${args.table}";`;
          const result = await migrationService.executeSql(args.instanceName, sql, userId, true);
          return {
            success: true,
            message: `RLS policy "${args.policyName}" dropped from "${args.table}".`,
            result,
          };
        }

        case 'enable_rls': {
          const migrationService = new MigrationService(this.prisma);
          const schema = args.schema || 'public';
          const sql = `ALTER TABLE "${schema}"."${args.table}" ENABLE ROW LEVEL SECURITY;`;
          const result = await migrationService.executeSql(args.instanceName, sql, userId, true);
          return {
            success: true,
            message: `RLS enabled on "${args.table}".`,
            result,
          };
        }

        case 'disable_rls': {
          const migrationService = new MigrationService(this.prisma);
          const schema = args.schema || 'public';
          const sql = `ALTER TABLE "${schema}"."${args.table}" DISABLE ROW LEVEL SECURITY;`;
          const result = await migrationService.executeSql(args.instanceName, sql, userId, true);
          return {
            success: true,
            message: `RLS disabled on "${args.table}".`,
            result,
          };
        }

        // ===== STORAGE (extra) =====
        case 'get_file_url': {
          if (!this.storageService)
            return { success: false, error: 'Storage service not available.' };
          if (args.signed) {
            const signedResult = await this.storageService.createSignedUrl(
              args.instanceName,
              args.bucketId,
              args.filePath,
              args.expiresIn || 3600
            );
            return { success: true, url: signedResult.signedUrl, type: 'signed' };
          }
          const pubResult = await this.storageService.getPublicUrl(
            args.instanceName,
            args.bucketId,
            args.filePath
          );
          return { success: true, url: pubResult.publicUrl, type: 'public' };
        }

        // ===== AUTH USERS =====
        case 'list_auth_users': {
          const migrationService = new MigrationService(this.prisma);
          const page = Math.max(1, args.page || 1);
          const perPage = Math.min(args.perPage || 50, 200);
          const offset = (page - 1) * perPage;
          const result = await migrationService.executeSql(
            args.instanceName,
            `SELECT id, email, phone, email_confirmed_at, created_at, last_sign_in_at, role, banned_until FROM auth.users ORDER BY created_at DESC LIMIT ${perPage} OFFSET ${offset};`,
            userId,
            false
          );
          return { success: true, page, perPage, users: result };
        }

        // ===== AUDIT =====
        case 'get_audit_logs': {
          const auditWhere: any = {};
          if (args.action) auditWhere.action = args.action;
          if (args.startDate || args.endDate) {
            auditWhere.createdAt = {};
            if (args.startDate) auditWhere.createdAt.gte = new Date(args.startDate);
            if (args.endDate) auditWhere.createdAt.lte = new Date(args.endDate);
          }
          const auditLogs = await this.prisma.auditLog.findMany({
            where: auditWhere,
            orderBy: { createdAt: 'desc' },
            take: Math.min(args.limit || 50, 200),
          });
          return { success: true, logs: auditLogs };
        }

        case 'get_audit_stats': {
          const now = new Date();
          const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          const [total, last24h, last7d, failed] = await Promise.all([
            this.prisma.auditLog.count(),
            this.prisma.auditLog.count({ where: { createdAt: { gte: oneDayAgo } } }),
            this.prisma.auditLog.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
            this.prisma.auditLog.count({ where: { success: false } }),
          ]);
          return { success: true, stats: { total, last24h, last7d, failed } };
        }

        // ===== ALERTS =====
        case 'list_alerts': {
          const alertWhere: any = {};
          if (args.instanceId) alertWhere.instanceId = args.instanceId;
          const alerts = await this.prisma.alert.findMany({
            where: alertWhere,
            orderBy: { createdAt: 'desc' },
            take: 50,
          });
          return { success: true, alerts };
        }

        // ===== SCHEDULES =====
        case 'list_schedules': {
          const schedules = await this.prisma.backupSchedule.findMany({
            orderBy: { createdAt: 'desc' },
          });
          return { success: true, schedules };
        }

        // ===== DEPLOYMENTS =====
        case 'list_deployments': {
          const deplWhere: any = {};
          if (args.instanceId) deplWhere.instanceId = args.instanceId;
          if (args.status) deplWhere.status = args.status;
          const deployments = await this.prisma.deployment.findMany({
            where: deplWhere,
            orderBy: { startedAt: 'desc' },
            take: args.limit || 50,
          });
          return { success: true, deployments };
        }

        case 'get_deployment_stats': {
          const [dTotal, dPending, dRunning, dSuccess, dFailed] = await Promise.all([
            this.prisma.deployment.count(),
            this.prisma.deployment.count({ where: { status: 'pending' } }),
            this.prisma.deployment.count({ where: { status: 'running' } }),
            this.prisma.deployment.count({ where: { status: 'success' } }),
            this.prisma.deployment.count({ where: { status: 'failed' } }),
          ]);
          return {
            success: true,
            stats: {
              total: dTotal,
              pending: dPending,
              running: dRunning,
              success: dSuccess,
              failed: dFailed,
            },
          };
        }

        // ===== SETTINGS =====
        case 'get_settings': {
          const settings = await this.prisma.globalSettings.findUnique({
            where: { id: 1 },
          });
          if (!settings) return { success: true, settings: {} };

          // Mask sensitive values
          const masked = { ...settings };
          if (masked.smtp_pass) masked.smtp_pass = '***masked***';

          return { success: true, settings: masked };
        }

        default:
          return { success: false, error: `Unknown tool: ${name}` };
      }
    } catch (error: any) {
      logger.error(`Tool execution error (${name}):`, error);
      return {
        success: false,
        error: error.message || `Failed to execute ${name}`,
      };
    }
  }

  // ============================================================
  // Session Management
  // ============================================================

  async createSession(userId: string): Promise<any> {
    return this.prisma.aiChatSession.create({
      data: { userId },
    });
  }

  async getSessions(userId: string): Promise<any[]> {
    return this.prisma.aiChatSession.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { messages: true } },
      },
    });
  }

  async getSession(sessionId: string, userId: string): Promise<any> {
    const session = await this.prisma.aiChatSession.findFirst({
      where: { id: sessionId, userId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!session) {
      throw new Error('Session not found');
    }

    return session;
  }

  async deleteSession(sessionId: string, userId: string): Promise<void> {
    const session = await this.prisma.aiChatSession.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) {
      throw new Error('Session not found');
    }

    await this.prisma.aiChatSession.delete({
      where: { id: sessionId },
    });
  }
}
