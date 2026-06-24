import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Repository } from '../db/repository.js';
import { buildPublicSnapshot, snapshotToFiles } from './publicSnapshot.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function getDefaultPublicExportDir(): string {
  if (process.env.PUBLIC_EXPORT_DIR) {
    return process.env.PUBLIC_EXPORT_DIR;
  }
  return join(__dirname, '../../../web/public/data');
}

export interface PublicExportResult {
  ok: true;
  outDir: string;
  exportedAt: string;
  predictionId: number;
  predictionName: string;
}

export function writePublicSnapshot(
  repo: Repository,
  outDir = getDefaultPublicExportDir(),
  exportTime: Date = new Date(),
): PublicExportResult {
  const snapshot = buildPublicSnapshot(repo, exportTime);
  const files = snapshotToFiles(snapshot);

  mkdirSync(outDir, { recursive: true });
  for (const [filename, data] of Object.entries(files)) {
    writeFileSync(join(outDir, filename), `${JSON.stringify(data, null, 2)}\n`);
  }

  return {
    ok: true,
    outDir,
    exportedAt: snapshot.meta.exportedAt,
    predictionId: snapshot.meta.predictionId,
    predictionName: snapshot.meta.predictionName,
  };
}
