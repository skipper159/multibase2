import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { auditLog } from '../middleware/auditLog';
import InstanceManager from '../services/InstanceManager';
import { logger } from '../utils/logger';
import { CreateInstanceRequest } from '../types';

const prisma = new PrismaClient();

// Validation Schemas
const createTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  config: z.any(), // Accepts object path, logic will stringify
  isPublic: z.boolean().optional(),
});

const useTemplateSchema = z.object({
  instanceName: z.string().min(1).max(100),
  overrides: z.any().optional(),
});

export function createTemplateRoutes(instanceManager: InstanceManager) {
  const router = Router();

  /**
   * GET /api/templates
   * List templates (public + user created)
   */
  router.get('/', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;

      const templates = await prisma.instanceTemplate.findMany({
        where: {
          OR: [{ isPublic: true }, { createdBy: user.id }],
        },
        include: {
          creator: {
            select: {
              username: true,
              id: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      // Parse config JSON strings back to objects
      const parsedTemplates = templates.map((t) => ({
        ...t,
        config: JSON.parse(t.config),
      }));

      res.json({ templates: parsedTemplates });
    } catch (error) {
      logger.error('Error fetching templates:', error);
      res.status(500).json({ error: 'Failed to fetch templates' });
    }
  });

  /**
   * GET /api/templates/system
   * Get system template (docker-compose.yml structure)
   */
  router.get('/system', requireAuth, async (req: Request, res: Response) => {
    try {
      const template = await instanceManager.getSystemTemplate();
      res.json(template);
    } catch (error) {
      logger.error('Error fetching system template:', error);
      res.status(500).json({ error: 'Failed to fetch system template' });
    }
  });

  /**
   * POST /api/templates
   * Create a new template from provided config
   */
  router.post(
    '/',
    requireAuth,
    auditLog('TEMPLATE_CREATE', { includeBody: true }),
    async (req: Request, res: Response) => {
      try {
        const user = (req as any).user;
        const validation = createTemplateSchema.safeParse(req.body);

        if (!validation.success) {
          return res.status(400).json({ error: validation.error.errors });
        }

        const { name, description, config, isPublic } = validation.data;

        // Ensure config has minimal required fields
        if (!config.deploymentType) {
          return res.status(400).json({ error: 'Config must include deploymentType' });
        }

        const template = await prisma.instanceTemplate.create({
          data: {
            name,
            description,
            config: JSON.stringify(config),
            isPublic: user.role === 'admin' ? isPublic || false : false,
            createdBy: user.id,
          },
        });

        res.status(201).json({
          ...template,
          config: JSON.parse(template.config),
        });
      } catch (error) {
        logger.error('Error creating template:', error);
        if ((error as any).code === 'P2002') {
          return res.status(409).json({ error: 'Template name already exists' });
        }
        res.status(500).json({ error: 'Failed to create template' });
      }
    }
  );

  /**
   * GET /api/templates/:id
   * Get details of a specific template
   */
  router.get('/:id', requireAuth, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const user = (req as any).user;

      if (isNaN(id)) {
        return res.status(400).json({ error: 'Invalid ID' });
      }

      const template = await prisma.instanceTemplate.findUnique({
        where: { id },
        include: {
          creator: {
            select: { username: true },
          },
        },
      });

      if (!template) {
        return res.status(404).json({ error: 'Template not found' });
      }

      if (!template.isPublic && template.createdBy !== user.id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      res.json({
        ...template,
        config: JSON.parse(template.config),
      });
    } catch (error) {
      logger.error(`Error fetching template ${req.params.id}:`, error);
      res.status(500).json({ error: 'Failed to fetch template' });
    }
  });

  /**
   * PUT /api/templates/:id
   * Update a template
   */
  router.put(
    '/:id',
    requireAuth,
    auditLog('TEMPLATE_UPDATE', { includeBody: true }),
    async (req: Request, res: Response) => {
      try {
        const id = parseInt(req.params.id);
        const user = (req as any).user;
        const { name, description, config, isPublic } = req.body;

        if (isNaN(id)) {
          return res.status(400).json({ error: 'Invalid ID' });
        }

        const existing = await prisma.instanceTemplate.findUnique({ where: { id } });
        if (!existing) return res.status(404).json({ error: 'Template not found' });

        if (existing.createdBy !== user.id && user.role !== 'admin') {
          return res.status(403).json({ error: 'Not authorized' });
        }

        const updateData: any = {};
        if (name) updateData.name = name;
        if (description !== undefined) updateData.description = description;
        if (config) updateData.config = JSON.stringify(config);
        if (isPublic !== undefined && user.role === 'admin') updateData.isPublic = isPublic;

        const updated = await prisma.instanceTemplate.update({
          where: { id },
          data: updateData,
        });

        res.json({
          ...updated,
          config: JSON.parse(updated.config),
        });
      } catch (error) {
        logger.error('Error updating template:', error);
        res.status(500).json({ error: 'Failed to update template' });
      }
    }
  );

  /**
   * DELETE /api/templates/:id
   * Delete a template (owner only)
   */
  router.delete(
    '/:id',
    requireAuth,
    auditLog('TEMPLATE_DELETE'),
    async (req: Request, res: Response) => {
      try {
        const id = parseInt(req.params.id);
        const user = (req as any).user;

        if (isNaN(id)) {
          return res.status(400).json({ error: 'Invalid ID' });
        }

        const template = await prisma.instanceTemplate.findUnique({
          where: { id },
        });

        if (!template) {
          return res.status(404).json({ error: 'Template not found' });
        }

        if (template.createdBy !== user.id && user.role !== 'admin') {
          return res.status(403).json({ error: 'Only the creator can delete this template' });
        }

        await prisma.instanceTemplate.delete({
          where: { id },
        });

        res.json({ message: 'Template deleted successfully' });
      } catch (error) {
        logger.error(`Error deleting template ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to delete template' });
      }
    }
  );

  /**
   * POST /api/templates/:id/use
   * Direct instantiation from template
   */
  router.post('/:id/use', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const id = parseInt(req.params.id);

      const validation = useTemplateSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: validation.error.errors });
      }
      const { instanceName, overrides } = validation.data;

      const template = await prisma.instanceTemplate.findUnique({ where: { id } });
      if (!template) return res.status(404).json({ error: 'Template not found' });

      if (!template.isPublic && template.createdBy !== user.id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const config = { ...JSON.parse(template.config), ...(overrides || {}) };

      const createRequest: CreateInstanceRequest = {
        name: instanceName,
        deploymentType: config.deploymentType || 'localhost',
        basePort: config.basePort,
        corsOrigins: config.corsOrigins,
        domain: config.domain,
        protocol: config.protocol,
      };

      const instance = await instanceManager.createInstance(createRequest);

      logger.info(`Instance created from template ${id}: ${instance.name}`);

      res.status(201).json({
        message: 'Instance created successfully',
        instance,
      });
    } catch (error: any) {
      logger.error('Error using template:', error);
      res.status(500).json({ error: error.message || 'Failed to create instance' });
    }
  });

  return router;
}
