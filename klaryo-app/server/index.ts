import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db';
import { createReadyApp } from './http';
import { assertDemoRuntime } from './safety';

assertDemoRuntime(process.env);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.env.KLARYO_DB ?? path.join(root, 'data', 'klaryo.sqlite');
const port = Number(process.env.KLARYO_PORT ?? 8787);
const db = openDatabase(dbPath);
const app = createReadyApp(db, { distDir: path.join(root, 'dist') });

app.listen(port, '127.0.0.1', () => {
  console.log(`Klaryo demo su http://127.0.0.1:${port}`);
  console.log('Accesso dimostrativo. Non è un servizio di produzione.');
});
