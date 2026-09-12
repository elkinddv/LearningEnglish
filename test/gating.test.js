import test from 'node:test';
import assert from 'node:assert/strict';

process.env.PROGRESO_DB = 'gating.test.db';
const { subtopicStatus, moduleExamAvailable } = await import('../server.js');

test('el primer subtema esta disponible si el tema esta desbloqueado', () => {
  const subtopics = [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }];
  const status = subtopicStatus(1, 'a', subtopics, {});
  assert.equal(status, 'available');
});

test('el segundo subtema esta bloqueado hasta aprobar el primero', () => {
  const subtopics = [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }];
  assert.equal(subtopicStatus(1, 'b', subtopics, {}), 'locked');
  assert.equal(
    subtopicStatus(1, 'b', subtopics, { a: { passed: 1 } }),
    'available'
  );
});

test('el examen de modulo solo esta disponible si todos los subtemas estan aprobados', () => {
  const subtopics = [{ slug: 'a' }, { slug: 'b' }];
  assert.equal(moduleExamAvailable(subtopics, {}), false);
  assert.equal(moduleExamAvailable(subtopics, { a: { passed: 1 } }), false);
  assert.equal(
    moduleExamAvailable(subtopics, { a: { passed: 1 }, b: { passed: 1 } }),
    true
  );
});

test('sin metadata de subtemas (tema no migrado), el examen de modulo esta disponible', () => {
  assert.equal(moduleExamAvailable([], {}), true);
});
