// test/helpers.js — arranca la app en un puerto efimero para pruebas de integracion.
import { unlinkSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function testDbPath(name) {
  return path.join(__dirname, `${name}.test.db`);
}

export function cleanupDb(name) {
  const p = testDbPath(name);
  if (existsSync(p)) unlinkSync(p);
}

export async function startTestServer(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

export async function stopTestServer(server) {
  // Close the server
  await new Promise((resolve) => server.close(resolve));
  // Close the database connection to release file locks before cleanup
  try {
    const { default: db } = await import('../db.js');
    if (db && typeof db.close === 'function') {
      db.close();
    }
  } catch (e) {
    // Ignore if db doesn't have a close method
  }
}
