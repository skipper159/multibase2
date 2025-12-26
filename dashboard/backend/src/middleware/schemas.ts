import { z } from 'zod';

// ===== Auth Schemas =====

export const LoginSchema = z.object({
  email: z.string().email('Ungültige Email-Adresse'),
  password: z.string().min(1, 'Passwort ist erforderlich'),
});

export const RegisterSchema = z.object({
  email: z.string().email('Ungültige Email-Adresse'),
  username: z
    .string()
    .min(3, 'Username muss mindestens 3 Zeichen haben')
    .max(30, 'Username darf maximal 30 Zeichen haben')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Username darf nur Buchstaben, Zahlen, _ und - enthalten'),
  password: z
    .string()
    .min(8, 'Passwort muss mindestens 8 Zeichen haben')
    .max(100, 'Passwort darf maximal 100 Zeichen haben'),
  role: z.enum(['admin', 'user', 'viewer']).optional(),
});

export const UpdateUserSchema = z.object({
  email: z.string().email('Ungültige Email-Adresse').optional(),
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .optional(),
  role: z.enum(['admin', 'user', 'viewer']).optional(),
});

export const UpdatePasswordSchema = z.object({
  password: z
    .string()
    .min(8, 'Passwort muss mindestens 8 Zeichen haben')
    .max(100, 'Passwort darf maximal 100 Zeichen haben'),
});

// ===== Instance Schemas =====

export const CreateInstanceSchema = z.object({
  name: z
    .string()
    .min(1, 'Instanzname ist erforderlich')
    .max(50, 'Instanzname darf maximal 50 Zeichen haben')
    .regex(
      /^[a-z0-9-]+$/,
      'Instanzname darf nur Kleinbuchstaben, Zahlen und Bindestriche enthalten'
    ),
  deploymentType: z.enum(['localhost', 'cloud'], {
    errorMap: () => ({ message: 'Deployment Type muss "localhost" oder "cloud" sein' }),
  }),
  basePort: z.number().int().min(1024).max(65535).optional(),
  domain: z.string().optional(),
  protocol: z.enum(['http', 'https']).optional(),
  corsOrigins: z.array(z.string()).optional(),
  templateId: z.number().int().positive().optional(),
});

export const InstanceNameParamSchema = z.object({
  name: z
    .string()
    .min(1, 'Instanzname ist erforderlich')
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Ungültiger Instanzname'),
});

export const UpdateCredentialsSchema = z.object({
  regenerateKeys: z.boolean().optional(),
});

// ===== Backup Schemas =====

export const CreateBackupSchema = z.object({
  type: z.enum(['full', 'database', 'instance'], {
    errorMap: () => ({ message: 'Backup-Typ muss "full", "database" oder "instance" sein' }),
  }),
  instanceId: z.string().optional(),
  name: z.string().max(100, 'Backup-Name darf maximal 100 Zeichen haben').optional(),
});

export const RestoreBackupSchema = z.object({
  instanceId: z.string().optional(),
});

// ===== Alert Schemas =====

export const CreateAlertRuleSchema = z.object({
  instanceId: z.number().int().positive('Instance ID muss eine positive Zahl sein'),
  name: z
    .string()
    .min(1, 'Alert-Name ist erforderlich')
    .max(100, 'Alert-Name darf maximal 100 Zeichen haben'),
  rule: z.enum(
    ['service_down', 'high_cpu', 'high_memory', 'high_disk', 'error_rate', 'connection_count'],
    {
      errorMap: () => ({ message: 'Ungültiger Alert-Regel-Typ' }),
    }
  ),
  condition: z.object({
    operator: z.enum(['>', '<', '=', '>=', '<=']),
    value: z.number(),
    service: z.string().optional(),
  }),
  threshold: z.number().optional(),
  duration: z.number().int().positive().optional(),
  enabled: z.boolean().default(true),
  notificationChannels: z.array(z.enum(['browser', 'webhook'])).optional(),
  webhookUrl: z.string().url('Ungültige Webhook URL').optional(),
});

export const UpdateAlertRuleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  rule: z
    .enum([
      'service_down',
      'high_cpu',
      'high_memory',
      'high_disk',
      'error_rate',
      'connection_count',
    ])
    .optional(),
  condition: z
    .object({
      operator: z.enum(['>', '<', '=', '>=', '<=']),
      value: z.number(),
      service: z.string().optional(),
    })
    .optional(),
  threshold: z.number().optional(),
  duration: z.number().int().positive().optional(),
  enabled: z.boolean().optional(),
  notificationChannels: z.array(z.enum(['browser', 'webhook'])).optional(),
  webhookUrl: z.string().url().optional().nullable(),
});

// ===== ID Param Schema =====

export const IdParamSchema = z.object({
  id: z.string().regex(/^\d+$/, 'ID muss eine Zahl sein'),
});

// ===== Type Exports (für TypeScript Type Inference) =====

export type LoginInput = z.infer<typeof LoginSchema>;
export type RegisterInput = z.infer<typeof RegisterSchema>;
export type CreateInstanceInput = z.infer<typeof CreateInstanceSchema>;
export type CreateBackupInput = z.infer<typeof CreateBackupSchema>;
export type CreateAlertRuleInput = z.infer<typeof CreateAlertRuleSchema>;
