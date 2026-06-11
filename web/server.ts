#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { serve, getRequestListener } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import {
  createApiServer,
  createRepository,
  parseServerArgs,
} from '../engine/src/api/bootstrap.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';

async function createProdApp(repo: ReturnType<typeof createRepository>) {
  const api = createApiServer(repo);
  const app = new Hono();
  app.route('/', api);
  app.use('*', serveStatic({ root: join(__dirname, 'dist') }));
  app.get('*', serveStatic({ root: join(__dirname, 'dist'), path: 'index.html' }));
  return app;
}

async function main() {
  const args = parseServerArgs(process.argv, { port: 2026 });
  const repo = createRepository(args.db, args.seed);
  const api = createApiServer(repo);

  if (isProd) {
    const app = await createProdApp(repo);
    console.log(`WC 2026 Web App at http://localhost:${args.port}`);
    serve({ fetch: app.fetch, port: args.port });
    return;
  }

  const vite = await createViteServer({
    root: __dirname,
    configFile: join(__dirname, 'vite.config.ts'),
    server: { middlewareMode: true },
    appType: 'custom',
  });

  const apiListener = getRequestListener(api.fetch);

  createServer((req, res) => {
    const url = req.url ?? '/';
    const pathname = url.split('?')[0] ?? '/';

    if (pathname.startsWith('/api/') || pathname === '/health') {
      apiListener(req, res);
      return;
    }

    vite.middlewares(req, res, async () => {
      try {
        let html = readFileSync(join(__dirname, 'index.html'), 'utf-8');
        html = await vite.transformIndexHtml(url, html);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html');
        res.end(html);
      } catch (err) {
        console.error(err);
        res.statusCode = 500;
        res.end('Internal Server Error');
      }
    });
  }).listen(args.port, () => {
    console.log(`WC 2026 Web App at http://localhost:${args.port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
