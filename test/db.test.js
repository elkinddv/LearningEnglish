import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupDb, testDbPath } from './helpers.js';

process.env.PROGRESO_DB = testDbPath('db');
cleanupDb('db');
const store = await import('../db.js');

test('flujo completo de progreso de subtema: intento -> respuestas -> progreso', () => {
  const attemptId = store.createSubtopicAttempt(1, 'present-simple-usos');
  assert.equal(typeof attemptId, 'number');

  store.insertSubtopicAnswers([
    {
      attempt_id: attemptId, topic_id: 1, subtopic: 'present-simple-usos',
      question_id: 't1-001', given: 'boils', correct: 'boils',
      is_correct: 1, answered_at: new Date().toISOString()
    },
    {
      attempt_id: attemptId, topic_id: 1, subtopic: 'present-simple-usos',
      question_id: 't1-002', given: 'wrong', correct: 'right',
      is_correct: 0, answered_at: new Date().toISOString()
    }
  ]);
  store.finishSubtopicAttempt({ attemptId, score: 50, correct: 1, total: 2, passed: false });
  store.upsertSubtopicProgress(1, 'present-simple-usos', 50, false);

  const map = store.getSubtopicProgressMap(1);
  assert.equal(map['present-simple-usos'].passed, 0);
  assert.equal(map['present-simple-usos'].best_score, 50);
  assert.equal(map['present-simple-usos'].attempts_count, 1);

  const last = store.getLastFinishedSubtopicAttempt(1, 'present-simple-usos');
  assert.equal(last.attempt.total, 2);
  assert.equal(last.answers.length, 2);

  // Segundo intento, esta vez aprobado: best_score sube, attempts_count suma.
  store.upsertSubtopicProgress(1, 'present-simple-usos', 90, true);
  const map2 = store.getSubtopicProgressMap(1);
  assert.equal(map2['present-simple-usos'].passed, 1);
  assert.equal(map2['present-simple-usos'].best_score, 90);
  assert.equal(map2['present-simple-usos'].attempts_count, 2);
});

test('resetTopic borra tambien el progreso de subtemas de ese tema', () => {
  store.createSubtopicAttempt(2, 'past-simple-forma');
  store.upsertSubtopicProgress(2, 'past-simple-forma', 100, true);
  store.resetTopic(2);
  const map = store.getSubtopicProgressMap(2);
  assert.deepEqual(map, {});
});
