import { createServer, type Server } from 'node:http';
import { logger } from '../utils/logger.js';

/**
 * Tiny HTTP endpoint for the hosting platform.
 *
 * The bot itself needs no inbound traffic — it uses long polling. But Fly
 * attaches a default HTTP service to an app and stops the machine when nothing
 * answers on it, which killed the bot seconds after every deploy. Declaring the
 * service explicitly (with autostop off) and answering here keeps the machine
 * alive and gives `fly status` something real to check.
 *
 * It exposes no data: liveness only.
 */
export function startHealthServer(port = Number(process.env.PORT ?? 8080)): Server {
  const startedAt = Date.now();

  const server = createServer((request, response) => {
    if (request.method !== 'GET') {
      response.writeHead(405).end();
      return;
    }

    const path = (request.url ?? '/').split('?')[0];
    if (path === '/health' || path === '/') {
      response
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ status: 'ok', uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) }));
      return;
    }

    response.writeHead(404).end();
  });

  server.on('error', (error) => {
    // A busy port must not take the bot down: polling works regardless.
    logger.error({ err: error, port }, 'Health server failed');
  });

  server.listen(port, '0.0.0.0', () => {
    logger.info({ port }, 'Health endpoint listening');
  });

  return server;
}
