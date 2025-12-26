import { Router, Request, Response, NextFunction } from 'express';
import { createProxyMiddleware, Options } from 'http-proxy-middleware';
import { IncomingMessage, ServerResponse, ClientRequest } from 'http';
import { Socket } from 'net';
import { InstanceManager } from '../services/InstanceManager';
import { logger } from '../utils/logger';

export function createProxyRoutes(instanceManager: InstanceManager): Router {
  const router = Router();

  /**
   * GET /api/proxy/:instanceName/debug
   * Debug endpoint to check instance status and ports
   */
  router.get('/:instanceName/debug', async (req: Request, res: Response): Promise<any> => {
    try {
      const { instanceName } = req.params;
      const instance = await instanceManager.getInstance(instanceName);

      if (!instance) {
        return res.status(404).json({ error: 'Instance not found' });
      }

      res.json({
        name: instance.name,
        status: instance.status,
        health: instance.health,
        ports: instance.ports,
        services: instance.services,
        kongUrl: `http://localhost:${instance.ports.kong_http}`,
        studioUrl: `http://localhost:${instance.ports.studio}`,
        studioProxyUrl: `/api/proxy/${instanceName}/studio`,
      });
    } catch (error) {
      logger.error('Error in debug endpoint:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * Proxy all requests to Studio for a specific instance
   * Studio runs on its own port and is accessible directly
   * Route: /api/proxy/:instanceName/studio/* (catch-all with wildcard)
   */
  router.use('/:instanceName/studio*', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { instanceName } = req.params;

      // Get instance to find the correct port
      const instance = await instanceManager.getInstance(instanceName);

      if (!instance) {
        return res.status(404).json({ error: 'Instance not found' });
      }

      if (instance.health.overall === 'stopped') {
        return res.status(503).json({
          error: 'Instance is stopped',
          message: 'Please start the instance before accessing Studio',
        });
      }

      // Studio is now exposed directly on its own port
      const studioPort = instance.ports.studio;
      const targetUrl = `http://localhost:${studioPort}`;

      logger.info(`[PROXY] Instance: ${instanceName}`);
      logger.info(`[PROXY] Status: ${instance.status}`);
      logger.info(`[PROXY] Health: ${instance.health.overall}`);
      logger.info(`[PROXY] Studio Port: ${studioPort}`);
      logger.info(`[PROXY] All Ports:`, instance.ports);
      logger.info(`[PROXY] Target URL: ${targetUrl}`);

      // Create proxy middleware on-the-fly for this instance
      const proxyOptions: Options = {
        target: targetUrl,
        changeOrigin: true,
        ws: true, // WebSocket support for Studio
        pathRewrite: (path: string) => {
          // Rewrite /api/proxy/instanceName/studio/* to /*
          const newPath = path.replace(`/api/proxy/${instanceName}/studio`, '');
          logger.debug(`Path rewrite: ${path} -> ${newPath}`);
          return newPath;
        },
        on: {
          error: (err: Error, _req: IncomingMessage, res: ServerResponse | Socket) => {
            logger.error(`Proxy error for ${instanceName}:`, err);
            if ('statusCode' in res && !res.headersSent) {
              res.statusCode = 502;
              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({
                  error: 'Proxy error',
                  message: 'Could not connect to Studio. Make sure the instance is running.',
                  details: err.message,
                })
              );
            }
          },
          proxyReq: (proxyReq: ClientRequest, req: IncomingMessage) => {
            // Add headers to help Studio understand the proxy setup
            proxyReq.setHeader('X-Forwarded-Host', req.headers.host || '');
            const expressReq = req as any;
            proxyReq.setHeader('X-Forwarded-Proto', expressReq.protocol || 'http');

            logger.debug(`Proxying to: ${targetUrl}${proxyReq.path}`);
          },
          proxyRes: (proxyRes: IncomingMessage, _req: IncomingMessage, _res: ServerResponse) => {
            logger.debug(`Proxy response status: ${proxyRes.statusCode}`);
            
            // Rewrite Location header for redirects
            const location = proxyRes.headers['location'];
            if (location && (proxyRes.statusCode === 301 || proxyRes.statusCode === 302 || proxyRes.statusCode === 307 || proxyRes.statusCode === 308)) {
              // If Location is a relative path, prepend the proxy path
              if (location.startsWith('/')) {
                const newLocation = `/api/proxy/${instanceName}/studio${location}`;
                proxyRes.headers['location'] = newLocation;
                logger.debug(`Rewrote redirect: ${location} -> ${newLocation}`);
              }
            }
          },
        },
      };

      const proxy = createProxyMiddleware(proxyOptions);
      return proxy(req, res, next);
    } catch (error) {
      logger.error('Error setting up proxy:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to set up proxy connection',
      });
    }
  });

  /**
   * Proxy to instance API (Kong Gateway)
   * Route: /api/proxy/:instanceName/api/*
   */
  router.use('/:instanceName/api', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { instanceName } = req.params;
      const instance = await instanceManager.getInstance(instanceName);

      if (!instance) {
        return res.status(404).json({ error: 'Instance not found' });
      }

      if (instance.health.overall === 'stopped') {
        return res.status(503).json({
          error: 'Instance is stopped',
        });
      }

      const targetUrl = `http://localhost:${instance.ports.kong_http}`;

      const proxyOptions: Options = {
        target: targetUrl,
        changeOrigin: true,
        ws: true,
        pathRewrite: {
          [`^/api/proxy/${instanceName}/api`]: '',
        },
        on: {
          error: (err: Error, _req: IncomingMessage, res: ServerResponse | Socket) => {
            logger.error(`API proxy error for ${instanceName}:`, err);
            if ('statusCode' in res && !res.headersSent) {
              res.statusCode = 502;
              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({
                  error: 'Proxy error',
                  message: 'Could not connect to instance API',
                })
              );
            }
          },
        },
      };

      const proxy = createProxyMiddleware(proxyOptions);
      return proxy(req, res, next);
    } catch (error) {
      logger.error('Error setting up API proxy:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
