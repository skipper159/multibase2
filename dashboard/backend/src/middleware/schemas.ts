import { z } from 'zod';

// ===== Auth Schemas =====

export const LoginSchema = z.object({
  email: z.string().email('Ungültige Email-Adresse'),
  password: z.string().min(1, 'Passwort ist erforderlich'),
  twoFactorToken: z.string().optional(),
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
    .max(100, 'Passwort darf maximal 100 Zeichen haben')
    .regex(/[A-Z]/, 'Passwort muss mindestens einen Großbuchstaben enthalten')
    .regex(/[a-z]/, 'Passwort muss mindestens einen Kleinbuchstaben enthalten')
    .regex(/[0-9]/, 'Passwort muss mindestens eine Zahl enthalten')
    .regex(/[^a-zA-Z0-9]/, 'Passwort muss mindestens ein Sonderzeichen enthalten'),
  // Honeypot — must be empty; bots typically auto-fill every field
  website: z.literal('').optional(),
  // Math Captcha — the signed token returned by GET /api/auth/captcha
  captchaToken: z.string().min(1, 'Captcha-Token fehlt'),
  // The user's typed answer to the math challenge
  captchaSolution: z.string().min(1, 'Bitte löse das Captcha'),
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

const StrongPasswordSchema = z
    .string()
    .min(8, 'Passwort muss mindestens 8 Zeichen haben')
    .max(100, 'Passwort darf maximal 100 Zeichen haben')
    .regex(/[A-Z]/, 'Passwort muss mindestens einen Großbuchstaben enthalten')
    .regex(/[a-z]/, 'Passwort muss mindestens einen Kleinbuchstaben enthalten')
    .regex(/[0-9]/, 'Passwort muss mindestens eine Zahl enthalten')
    .regex(/[^a-zA-Z0-9]/, 'Passwort muss mindestens ein Sonderzeichen enthalten');

export const UpdatePasswordSchema = z.object({
  password: StrongPasswordSchema,
});

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Aktuelles Passwort ist erforderlich'),
  newPassword: StrongPasswordSchema,
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
  env: z.record(z.string()).optional(),
  resourceLimits: z
    .object({
      cpus: z.number().min(0.1).max(64).optional(),
      memory: z.number().int().min(128).max(65536).optional(),
      preset: z.string().optional(),
    })
    .optional(),
  extensions: z.array(z.string()).optional(),
  initSql: z.string().max(50000).optional(),
  environment: z.enum(['production', 'staging', 'dev', 'preview']).optional(),
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

// ===== Environment Update Schemas =====

export const UpdateEnvSchema = z.object({
  env: z.record(
    z.string().regex(/^[A-Z_][A-Z0-9_]*$/, 'Variable name must be uppercase with underscores'),
    z.string()
  ),
});

export const UpdateResourceLimitsSchema = z.object({
  resourceLimits: z.object({
    cpus: z.number().min(0.1).max(64).optional(),
    memory: z.number().int().min(128).max(65536).optional(),
    preset: z.enum(['small', 'medium', 'large', 'custom']).optional(),
  }),
});

export const CloneInstanceSchema = z.object({
  newName: z
    .string()
    .min(1, 'Instance name is required')
    .max(50, 'Instance name must be 50 characters or less')
    .regex(
      /^[a-z0-9-]+$/,
      'Instance name can only contain lowercase letters, numbers, and hyphens'
    ),
  copyEnv: z.boolean().optional().default(true),
});

// ===== Backup Schemas =====

export const CreateBackupSchema = z.object({
  type: z.enum(['full', 'database', 'instance'], {
    errorMap: () => ({ message: 'Backup-Typ muss "full", "database" oder "instance" sein' }),
  }),
  instanceId: z.string().optional(),
  name: z.string().max(100, 'Backup-Name darf maximal 100 Zeichen haben').optional(),
  destinationIds: z.array(z.string()).optional(),
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

// ===== Feedback Schema =====

export const FeedbackSchema = z.object({
  type: z.enum(['feature', 'bug']),
  title: z.string().min(5, 'Titel muss mindestens 5 Zeichen haben').max(120),
  description: z.string().min(10, 'Beschreibung muss mindestens 10 Zeichen haben').max(2000),
  urgency: z.enum(['low', 'medium', 'high', 'critical']),
  authorName: z.string().max(80).optional().or(z.literal('')),
  authorEmail: z.string().email().optional().or(z.literal('')),
  website: z.literal('').optional(), // honeypot — bots fill this, Zod rejects non-empty
});

// ===== Type Exports (für TypeScript Type Inference) =====

export type LoginInput = z.infer<typeof LoginSchema>;
export type RegisterInput = z.infer<typeof RegisterSchema>;
export type CreateInstanceInput = z.infer<typeof CreateInstanceSchema>;
export type CreateBackupInput = z.infer<typeof CreateBackupSchema>;
export type CreateAlertRuleInput = z.infer<typeof CreateAlertRuleSchema>;
