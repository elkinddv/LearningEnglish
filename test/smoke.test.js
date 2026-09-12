import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupDb, testDbPath, startTestServer, stopTestServer } from './helpers.js';

process.env.PROGRESO_DB = testDbPath('smoke');
cleanupDb('smoke');
const { default: app } = await import('../server.js');

test('GET /api/course responde 200 con estructura basica', async () => {
  const { server, base } = await startTestServer(app);
  try {
    const res = await fetch(base + '/api/course');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(typeof data.title, 'string');
    assert.ok(Array.isArray(data.levels));
  } finally {
    await stopTestServer(server);
    cleanupDb('smoke');
  }
});
