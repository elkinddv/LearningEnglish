import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupDb, testDbPath, startTestServer, stopTestServer } from './helpers.js';

process.env.PROGRESO_DB = testDbPath('subtopic-routes');
cleanupDb('subtopic-routes');
const { default: app } = await import('../server.js');

test('flujo de quiz de subtema: ver -> generar -> enviar', async () => {
  const { server, base } = await startTestServer(app);
  try {
    // Tema 1 ya trae subtemas reales en content/topic-01.json
    const view = await fetch(base + '/api/topic/1/subtopic/present-simple-usos')
      .then((r) => r.json());
    assert.equal(view.status, 'available');
    assert.equal(view.subtopic, 'present-simple-usos');

    const quiz = await fetch(base + '/api/topic/1/subtopic/present-simple-usos/quiz', {
      method: 'POST'
    }).then((r) => r.json());
    // OJO: en este punto del plan (antes de la Fase 2) el banco de
    // "present-simple-usos" todavia tiene el contenido original (~13 preguntas),
    // no las 50 finales. No fijar 15 a fuego aqui: una vez la Task 9 complete el
    // banco a 50, este mismo test seguira pasando porque solo exige que el tamano
    // no supere subtopicQuizSize (15) y que haya al menos 1 pregunta.
    assert.ok(quiz.total > 0 && quiz.total <= 15, `total inesperado: ${quiz.total}`);
    assert.equal(quiz.questions.length, quiz.total);
    assert.ok(quiz.attemptId);

    const answers = quiz.questions.map((q) => ({ questionId: q.id, given: '' }));
    const result = await fetch(
      base + `/api/topic/1/subtopic/present-simple-usos/quiz/${quiz.attemptId}/submit`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers }) }
    ).then((r) => r.json());
    assert.equal(result.total, quiz.total);
    assert.equal(result.passed, false); // todas vacias -> 0%

    const view2 = await fetch(base + '/api/topic/1/subtopic/present-simple-usos')
      .then((r) => r.json());
    assert.equal(view2.progress.attempts_count, 1);
  } finally {
    // No cleanupDb() aqui (ver nota de convencion en el smoke test de la Task 1):
    // en Windows el archivo .db sigue bloqueado mientras el proceso vive.
    await stopTestServer(server);
  }
});

test('el segundo subtema esta bloqueado hasta aprobar el primero', async () => {
  const { server, base } = await startTestServer(app);
  try {
    const view = await fetch(base + '/api/topic/1/subtopic/present-simple-forma')
      .then((r) => r.json());
    assert.equal(view.status, 'locked');

    const res = await fetch(base + '/api/topic/1/subtopic/present-simple-forma/quiz', {
      method: 'POST'
    });
    assert.equal(res.status, 403);
  } finally {
    await stopTestServer(server);
  }
});
