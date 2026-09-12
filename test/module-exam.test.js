import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupDb, testDbPath, startTestServer, stopTestServer } from './helpers.js';

process.env.PROGRESO_DB = testDbPath('module-exam');
cleanupDb('module-exam');
const { default: app } = await import('../server.js');
const store = await import('../db.js');

test('el examen de modulo esta bloqueado si faltan subtemas por aprobar', async () => {
  const { server, base } = await startTestServer(app);
  try {
    const res = await fetch(base + '/api/topic/1/exam', { method: 'POST' });
    assert.equal(res.status, 403);
  } finally {
    await stopTestServer(server);
  }
});

test('el examen de modulo tiene 60 preguntas una vez aprobados todos los subtemas', async () => {
  const subtopics = [
    'present-simple-usos', 'present-simple-forma', 'present-continuous-usos',
    'present-continuous-forma', 'marcadores-temporales', 'verbos-de-estado',
    'verbos-estado-o-accion', 'contraste-simple-continuo'
  ];
  for (const slug of subtopics) store.upsertSubtopicProgress(1, slug, 100, true);

  const { server, base } = await startTestServer(app);
  try {
    const res = await fetch(base + '/api/topic/1/exam', { method: 'POST' });
    assert.equal(res.status, 200);
    const exam = await res.json();
    assert.equal(exam.total, 60);
  } finally {
    await stopTestServer(server);
  }
});
