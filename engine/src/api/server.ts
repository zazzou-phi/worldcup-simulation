#!/usr/bin/env node
import { serve } from '@hono/node-server';
import { createApiServer, createRepository, parseServerArgs } from './bootstrap.js';

async function main() {
  const args = parseServerArgs(process.argv);
  const repo = createRepository(args.db, args.seed);
  const app = createApiServer(repo);

  console.log(`WC Simulation API listening on http://localhost:${args.port}`);
  serve({ fetch: app.fetch, port: args.port });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
