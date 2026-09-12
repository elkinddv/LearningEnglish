import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupDb, testDbPath } from './helpers.js';

process.env.PROGRESO_DB = testDbPath('grade');
cleanupDb('grade');
const { grade } = await import('../server.js');

test('key-word-transformation acepta cualquier variante de accept[], normalizada', () => {
  const q = {
    type: 'key-word-transformation',
    accept: ['usually walks', 'usually goes walking'],
    answer: 'usually walks'
  };
  assert.equal(grade(q, 'Usually Walks.'), true);
  assert.equal(grade(q, 'usually   walks'), true);
  assert.equal(grade(q, 'always walks'), false);
});

test('error-correction compara contra answerIndex, no contra answer', () => {
  const q = {
    type: 'error-correction',
    segments: ['She', 'are watching', 'TV', 'right now.'],
    answerIndex: 1,
    answer: 'is watching'
  };
  assert.equal(grade(q, '1'), true);
  assert.equal(grade(q, 1), true);
  assert.equal(grade(q, '0'), false);
  assert.equal(grade(q, ''), false);
});
