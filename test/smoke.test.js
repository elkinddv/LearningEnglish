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
    // No se llama cleanupDb() aqui: en Windows el archivo .db sigue abierto/
    // bloqueado mientras el proceso vive, y borrarlo a mitad de proceso lanza
    // EBUSY. cleanupDb() solo se llama ANTES de importar la app (linea de
    // arriba), para limpiar el archivo que haya dejado una corrida anterior.
    await stopTestServer(server);
  }
});

test('GET /api/course con segundo test (valida patrón multi-test)', async () => {
  const { server, base } = await startTestServer(app);
  try {
    const res = await fetch(base + '/api/course');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.hasOwnProperty('passThreshold'));
    assert.ok(data.hasOwnProperty('examSize'));
  } finally {
    // No se llama cleanupDb() aqui: en Windows el archivo .db sigue abierto/
    // bloqueado mientras el proceso vive, y borrarlo a mitad de proceso lanza
    // EBUSY. cleanupDb() solo se llama ANTES de importar la app (linea de
    // arriba), para limpiar el archivo que haya dejado una corrida anterior.
    await stopTestServer(server);
  }
});
