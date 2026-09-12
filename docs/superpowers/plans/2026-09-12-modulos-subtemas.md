# Módulos con subtemas, banco de 50 y examen de módulo de 60 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir cada subtema de un módulo (tema) en una unidad de aprendizaje con
su propio banco de 50 preguntas y quiz de progresión (15 preguntas, 80%), y hacer que
el examen de módulo (60 preguntas) solo se desbloquee tras aprobar todos los subtemas.
Se entrega el **Módulo 1 completo** ("Tiempos presentes y aspecto verbal") como piloto
extremo a extremo (backend + contenido + UI).

**Architecture:** Extensión aditiva del esquema plano ya existente (`lesson.sections[]`
y `questions[]` con un campo `subtopic`), no una reestructuración a JSON anidado — es el
diff más pequeño posible sobre `db.js`/`server.js`/`content/*.json` ya en producción.
Se añaden tablas SQLite paralelas a nivel de subtema, dos rutas nuevas de Express, dos
tipos de pregunta nuevos que reutilizan el motor de calificación existente, y un tramo
de UI que reutiliza el renderer de examen ya escrito.

**Tech Stack:** Node 22+ (ESM, `node:sqlite`, `node:test`), Express 4, JS vanilla sin
build step en `public/`.

**Spec:** [docs/superpowers/specs/2026-09-12-modulos-subtemas-design.md](../specs/2026-09-12-modulos-subtemas-design.md)

## Global Constraints

- `passThreshold` global se mantiene en **80** y aplica por igual a quiz de subtema,
  examen de módulo y súper examen (valor ya usado hoy en `course.json`).
- `subtopicQuizSize = 15`, `moduleExamSize = 60` (reemplaza al actual `examSize: 20`
  para entradas de tipo `topic`), `superExamSize = 100` sin cambios.
- Banco por subtema: **50 preguntas**, mezcla aproximada 40% `mcq` / 30% `gap` /
  15% `key-word-transformation` / 15% `error-correction`.
- **`progreso.db` se resetea por completo** en este cambio (autorizado explícitamente
  por el usuario). Se hace backup del archivo antes de tocarlo.
- No se usan dependencias npm nuevas. Los tests usan `node:test` (incluido en Node,
  cero dependencias nuevas, consistente con la filosofía "sin dependencias" del repo).
- Alcance de este plan: **solo Módulo 1** de punta a punta. Los módulos 2–16 quedan
  para planes posteriores (ver spec §8).
- No se hace OCR de Swan en este plan (no hace falta para B1/Módulo 1; ver spec §7,
  queda para las fases C1/C2).

---

## Fase 1 — Backend: esquema, motor de progresión y calificación

### Task 1: Scaffolding de tests + exportar `app` para pruebas de integración

**Files:**
- Modify: `server.js` (exportar `app`, no arrancar el servidor si el módulo no es el
  punto de entrada)
- Modify: `package.json:7-9` (añadir script `test`)
- Create: `test/helpers.js`

**Interfaces:**
- Produces: `import app from '../server.js'` (Express app sin `listen()` disparado),
  `startTestServer()` / `stopTestServer(server)` en `test/helpers.js`.

- [ ] **Step 1: Modificar `server.js` para exportar `app` y guardar el arranque**

En `server.js`, después de `const __dirname = ...` (línea 9), añade:

```js
const __filename = fileURLToPath(import.meta.url);
```

Al final del archivo, reemplaza:

```js
app.listen(PORT, '0.0.0.0', () => {
  console.log('\n  Learning English  ->  curso interactivo B1-C2\n');
  console.log(`  Este equipo:     http://localhost:${PORT}`);
  for (const ip of lanAddresses()) {
    console.log(`  Movil / tablet:  http://${ip}:${PORT}   (misma red Wi-Fi)`);
  }
  console.log('\n  Ctrl+C para detener.\n');
});
```

por:

```js
const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log('\n  Learning English  ->  curso interactivo B1-C2\n');
    console.log(`  Este equipo:     http://localhost:${PORT}`);
    for (const ip of lanAddresses()) {
      console.log(`  Movil / tablet:  http://${ip}:${PORT}   (misma red Wi-Fi)`);
    }
    console.log('\n  Ctrl+C para detener.\n');
  });
}

export default app;
```

- [ ] **Step 2: Crear `test/helpers.js`**

```js
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

export function stopTestServer(server) {
  return new Promise((resolve) => server.close(resolve));
}
```

- [ ] **Step 3: Añadir el script `test` en `package.json`**

En `package.json:7-9`, deja:

```json
  "scripts": {
    "start": "node --env-file-if-exists=.env --disable-warning=ExperimentalWarning server.js",
    "dev": "node --env-file-if-exists=.env --watch --disable-warning=ExperimentalWarning server.js",
    "test": "node --disable-warning=ExperimentalWarning --test test/"
  },
```

- [ ] **Step 4: Escribir el primer test de humo**

Create: `test/smoke.test.js`

```js
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
```

- [ ] **Step 5: Ejecutar y confirmar que pasa**

Run: `npm test`
Expected: `# pass 1`, sin fallos. (Este paso valida el scaffolding, no la feature nueva.)

- [ ] **Step 6: Commit**

```bash
git add server.js package.json test/
git commit -m "test: scaffolding de node:test y export de app para pruebas de integracion"
```

---

### Task 2: `db.js` — tablas y funciones de progreso a nivel de subtema

**Files:**
- Modify: `db.js:14-48` (bloque `db.exec` de creación de tablas)
- Modify: `db.js` (nuevas funciones exportadas, junto a las de tema existentes)
- Modify: `db.js:134-142` (`resetAll` / `resetTopic`, incluir tablas de subtema)
- Test: `test/db.test.js`

**Interfaces:**
- Produces: `createSubtopicAttempt(topicId, subtopic)`,
  `finishSubtopicAttempt({attemptId, score, correct, total, passed})`,
  `insertSubtopicAnswers(rows)`, `upsertSubtopicProgress(topicId, subtopic, score, passed)`,
  `getSubtopicProgressMap(topicId)` → `{ [subtopic]: row }`,
  `getLastFinishedSubtopicAttempt(topicId, subtopic)` → `{ attempt, answers } | null`.
- Consumes: nada nuevo (usa el mismo `DatabaseSync` ya creado en el módulo).

- [ ] **Step 1: Escribir el test que falla**

Create: `test/db.test.js`

```js
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
```

- [ ] **Step 2: Ejecutar y confirmar que falla**

Run: `npm test`
Expected: FAIL — `store.createSubtopicAttempt is not a function`.

- [ ] **Step 3: Añadir las tablas nuevas en `db.js`**

En `db.js:14-48`, dentro del mismo `db.exec(\`...\`)`, añade justo antes del bloque de
índices finales:

```sql
  CREATE TABLE IF NOT EXISTS subtopic_attempts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_id      INTEGER NOT NULL,
    subtopic      TEXT    NOT NULL,
    started_at    TEXT    NOT NULL,
    finished_at   TEXT,
    score         REAL,
    correct_count INTEGER,
    total         INTEGER,
    passed        INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS subtopic_answers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_id  INTEGER NOT NULL,
    topic_id    INTEGER NOT NULL,
    subtopic    TEXT    NOT NULL,
    question_id TEXT    NOT NULL,
    given       TEXT,
    correct     TEXT    NOT NULL,
    is_correct  INTEGER NOT NULL,
    answered_at TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS subtopic_progress (
    topic_id        INTEGER NOT NULL,
    subtopic        TEXT    NOT NULL,
    passed          INTEGER NOT NULL DEFAULT 0,
    best_score      REAL    NOT NULL DEFAULT 0,
    attempts_count  INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TEXT,
    PRIMARY KEY (topic_id, subtopic)
  );

  CREATE INDEX IF NOT EXISTS idx_subtopic_answers_attempt ON subtopic_answers(attempt_id);
```

- [ ] **Step 4: Añadir las funciones exportadas en `db.js`**

Añade al final de `db.js`, antes de `export default db;`:

```js
export function createSubtopicAttempt(topicId, subtopic) {
  const info = db
    .prepare(`INSERT INTO subtopic_attempts (topic_id, subtopic, started_at) VALUES (?, ?, ?)`)
    .run(topicId, subtopic, new Date().toISOString());
  return Number(info.lastInsertRowid);
}

export function finishSubtopicAttempt({ attemptId, score, correct, total, passed }) {
  db.prepare(
    `UPDATE subtopic_attempts
        SET finished_at = ?, score = ?, correct_count = ?, total = ?, passed = ?
      WHERE id = ?`
  ).run(new Date().toISOString(), score, correct, total, passed ? 1 : 0, attemptId);
}

export function insertSubtopicAnswers(rows) {
  const stmt = db.prepare(
    `INSERT INTO subtopic_answers
       (attempt_id, topic_id, subtopic, question_id, given, correct, is_correct, answered_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const r of rows) {
    stmt.run(
      r.attempt_id, r.topic_id, r.subtopic, r.question_id,
      r.given, r.correct, r.is_correct, r.answered_at
    );
  }
}

export function upsertSubtopicProgress(topicId, subtopic, score, passed) {
  db.prepare(`
    INSERT INTO subtopic_progress (topic_id, subtopic, passed, best_score, attempts_count, last_attempt_at)
    VALUES (?, ?, ?, ?, 1, ?)
    ON CONFLICT(topic_id, subtopic) DO UPDATE SET
      passed          = MAX(subtopic_progress.passed, excluded.passed),
      best_score      = MAX(subtopic_progress.best_score, excluded.best_score),
      attempts_count  = subtopic_progress.attempts_count + 1,
      last_attempt_at = excluded.last_attempt_at
  `).run(topicId, subtopic, passed ? 1 : 0, score, new Date().toISOString());
}

export function getSubtopicProgressMap(topicId) {
  const map = {};
  for (const r of db.prepare(`SELECT * FROM subtopic_progress WHERE topic_id = ?`).all(topicId)) {
    map[r.subtopic] = r;
  }
  return map;
}

export function getLastFinishedSubtopicAttempt(topicId, subtopic) {
  const attempt = db
    .prepare(
      `SELECT * FROM subtopic_attempts
        WHERE topic_id = ? AND subtopic = ? AND finished_at IS NOT NULL
        ORDER BY id DESC LIMIT 1`
    )
    .get(topicId, subtopic);
  if (!attempt) return null;
  const answers = db.prepare(`SELECT * FROM subtopic_answers WHERE attempt_id = ?`).all(attempt.id);
  return { attempt, answers };
}
```

- [ ] **Step 5: Extender `resetAll` y `resetTopic` (`db.js:134-142`)**

Reemplaza esas dos funciones por:

```js
export function resetAll() {
  db.exec(`
    DELETE FROM answers; DELETE FROM attempts; DELETE FROM topic_progress;
    DELETE FROM subtopic_answers; DELETE FROM subtopic_attempts; DELETE FROM subtopic_progress;
  `);
}

export function resetTopic(topicId) {
  db.prepare(`DELETE FROM answers WHERE topic_id = ?`).run(topicId);
  db.prepare(`DELETE FROM attempts WHERE topic_id = ?`).run(topicId);
  db.prepare(`DELETE FROM topic_progress WHERE topic_id = ?`).run(topicId);
  db.prepare(`DELETE FROM subtopic_answers WHERE topic_id = ?`).run(topicId);
  db.prepare(`DELETE FROM subtopic_attempts WHERE topic_id = ?`).run(topicId);
  db.prepare(`DELETE FROM subtopic_progress WHERE topic_id = ?`).run(topicId);
}
```

- [ ] **Step 6: Ejecutar y confirmar que pasa**

Run: `npm test`
Expected: `# pass 3` (smoke + los 2 tests nuevos), sin fallos.

- [ ] **Step 7: Commit**

```bash
git add db.js test/db.test.js
git commit -m "feat: progreso de subtema en SQLite (tablas + CRUD)"
```

---

### Task 3: Motor de calificación — `key-word-transformation` y `error-correction`

**Files:**
- Modify: `server.js:195-202` (función `grade`)
- Test: `test/grade.test.js`

**Interfaces:**
- Consumes: ninguno nuevo.
- Produces: `grade(q, given)` ahora soporta `q.type` ∈
  `{'mcq','gap','key-word-transformation','error-correction'}`.

Contrato de cada tipo nuevo (para que las tareas de contenido de la Fase 2 sepan qué
campos usar):

- `key-word-transformation`: mismo contrato que `gap` (campos `accept: string[]`,
  `answer: string`), pero el `prompt` sigue el formato Cambridge de key-word
  transformation: frase original + palabra clave en mayúsculas + segunda frase con un
  hueco a completar (**no** se pide reescribir la frase entera, para no depender de
  aceptar decenas de variantes válidas — ver spec §10.2).
- `error-correction`: campos `segments: string[]` (los tramos en orden, tal cual se
  muestran) y `answerIndex: number` (índice del tramo con el error). `answer` se sigue
  usando solo para *mostrar* el tramo corregido en resultados; la calificación compara
  contra `answerIndex`, no contra `answer`.

- [ ] **Step 1: Escribir el test que falla**

Create: `test/grade.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.PROGRESO_DB = 'grade.test.db';
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
```

- [ ] **Step 2: Ejecutar y confirmar que falla**

Run: `npm test`
Expected: FAIL — `grade is not a function` (todavía no se exporta) o la aserción de
`error-correction` falla porque hoy compara `given === q.answer`.

- [ ] **Step 3: Exportar `grade` y extender sus ramas (`server.js:195-202`)**

Reemplaza la función actual por:

```js
export function grade(q, given) {
  if (given == null || given === '') return false;
  if (q.type === 'gap' || q.type === 'key-word-transformation') {
    const accepts = (q.accept && q.accept.length ? q.accept : [q.answer]).map(normalize);
    return accepts.includes(normalize(given));
  }
  if (q.type === 'error-correction') {
    return String(given) === String(q.answerIndex);
  }
  return given === q.answer;
}
```

- [ ] **Step 4: Ejecutar y confirmar que pasa**

Run: `npm test`
Expected: todos los tests en verde, incluidos los de `grade.test.js`.

- [ ] **Step 5: Commit**

```bash
git add server.js test/grade.test.js
git commit -m "feat: calificacion para key-word-transformation y error-correction"
```

---

### Task 4: Metadatos de subtemas + funciones de estado (gating)

**Files:**
- Modify: `server.js:22-34` (carga de temas)
- Modify: `server.js:100-120` (`levelOf`, `entryStatus`)
- Test: `test/gating.test.js`

**Interfaces:**
- Consumes: `topic.subtopics` (nuevo array `[{slug, title}]` en cada `topic-XX.json`;
  opcional — si no existe, el tema se comporta como hoy, sin gating de subtema).
- Produces: `SUBTOPICS_OF_TOPIC: Map<topicId, {slug,title}[]>`,
  `subtopicStatus(topicId, slug, prog, subProg)` → `'passed'|'available'|'locked'`,
  `moduleExamAvailable(topicId, prog, subProg)` → `boolean`.

- [ ] **Step 1: Escribir el test que falla**

Create: `test/gating.test.js`

```js
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
```

- [ ] **Step 2: Ejecutar y confirmar que falla**

Run: `npm test`
Expected: FAIL — `subtopicStatus is not a function`.

- [ ] **Step 3: Cargar `subtopics` por tema (`server.js:22-34`)**

Justo después del bloque que rellena `topics` (línea 34), añade:

```js
// slug -> titulo, en orden, para cada tema que ya adopto el esquema de subtemas.
const SUBTOPICS_OF_TOPIC = new Map();
for (const [tid, t] of topics) {
  if (Array.isArray(t.subtopics) && t.subtopics.length) {
    SUBTOPICS_OF_TOPIC.set(tid, t.subtopics);
  }
}
```

- [ ] **Step 4: Añadir `subtopicStatus` y `moduleExamAvailable`**

Añade cerca de `entryStatus` (`server.js`, después de la línea 120):

```js
export function subtopicStatus(topicId, slug, subtopics, subProg) {
  if (subProg[slug]?.passed) return 'passed';
  const idx = subtopics.findIndex((s) => s.slug === slug);
  if (idx <= 0) return 'available';
  const prevSlug = subtopics[idx - 1].slug;
  return subProg[prevSlug]?.passed ? 'available' : 'locked';
}

export function moduleExamAvailable(subtopics, subProg) {
  if (!subtopics.length) return true; // tema aun no migrado: sin gating de subtema
  return subtopics.every((s) => subProg[s.slug]?.passed);
}
```

- [ ] **Step 5: Ejecutar y confirmar que pasa**

Run: `npm test`
Expected: todos los tests en verde.

- [ ] **Step 6: Commit**

```bash
git add server.js test/gating.test.js
git commit -m "feat: metadatos de subtemas y funciones de gating"
```

---

### Task 5: `content/topic-01.json` — declarar `subtopics[]`

Esta tarea se hace ahora (no en la Fase 2 de contenido) porque las Tasks 6 y 7
necesitan que `SUBTOPICS_OF_TOPIC` (Task 4) tenga datos reales para poder probarse por
HTTP contra el tema 1 — sin este array, todas las pruebas de gating de esas tareas
verían un tema sin subtemas y no ejercitarían el bloqueo.

**Files:**
- Modify: `content/topic-01.json:1-6` (metadata de cabecera del archivo)

- [ ] **Step 1: Añadir el array `subtopics` justo después de `"title"`**

```json
  "subtopics": [
    { "slug": "present-simple-usos", "title": "Present Simple - usos" },
    { "slug": "present-simple-forma", "title": "Present Simple - forma (-s, do/does)" },
    { "slug": "present-continuous-usos", "title": "Present Continuous - usos" },
    { "slug": "present-continuous-forma", "title": "Present Continuous - forma (-ing)" },
    { "slug": "marcadores-temporales", "title": "Marcadores de tiempo y frecuencia" },
    { "slug": "verbos-de-estado", "title": "Verbos de estado (stative)" },
    { "slug": "verbos-estado-o-accion", "title": "Verbos de estado o accion" },
    { "slug": "contraste-simple-continuo", "title": "Contraste Simple vs Continuous" }
  ],
```

(El orden es el mismo que ya usan `lesson.sections` y `course.json.subtopicLabels`
para este tema — es la secuencia de gating.)

- [ ] **Step 2: Confirmar que el JSON sigue siendo válido**

Run: `node -e "JSON.parse(require('fs').readFileSync('content/topic-01.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add content/topic-01.json
git commit -m "feat(contenido): declarar el orden de subtemas del Modulo 1"
```

---

### Task 6: Rutas de subtema (`GET` vista, `POST` quiz, `POST` submit)

**Files:**
- Modify: `server.js` (nuevas rutas, junto a las de `/api/topic/:id/...` existentes)
- Modify: `content/course.json:2-5` (añadir `subtopicQuizSize`)
- Test: `test/subtopic-routes.test.js`

**Interfaces:**
- Consumes: `pickExam`, `grade`, `normalize` (ya existentes), `SUBTOPICS_OF_TOPIC`,
  `subtopicStatus` (Task 4), funciones de `db.js` (Task 2).
- Produces: rutas HTTP
  - `GET /api/topic/:id/subtopic/:slug`
  - `POST /api/topic/:id/subtopic/:slug/quiz`
  - `POST /api/topic/:id/subtopic/:slug/quiz/:attemptId/submit`

- [ ] **Step 1: Escribir el test que falla**

Create: `test/subtopic-routes.test.js`

```js
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
    await stopTestServer(server);
    cleanupDb('subtopic-routes');
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
    cleanupDb('subtopic-routes');
  }
});
```

- [ ] **Step 2: Ejecutar y confirmar que falla**

Run: `npm test`
Expected: FAIL — 404 en `/api/topic/1/subtopic/...` (la ruta no existe todavía).

- [ ] **Step 3: Añadir `subtopicQuizSize` a `content/course.json:2-5`**

```json
  "title": "La ruta del ingles",
  "passThreshold": 80,
  "examSize": 20,
  "subtopicQuizSize": 15,
  "moduleExamSize": 60,
  "superExamSize": 100,
```

- [ ] **Step 4: Añadir las rutas en `server.js`**

Justo después de `app.post('/api/topic/:id/reset', ...)` (antes de `app.get('/lesson', ...)`
en `server.js:474-480`), añade:

```js
const SUBTOPIC_QUIZ_SIZE = course.subtopicQuizSize || 15;

function subtopicPool(topicId, slug) {
  const t = topics.get(topicId);
  return t ? t.questions.filter((q) => q.subtopic === slug) : [];
}

app.get('/api/topic/:id/subtopic/:slug', (req, res) => {
  const id = Number(req.params.id);
  const { slug } = req.params;
  const subtopics = SUBTOPICS_OF_TOPIC.get(id) || [];
  const meta = subtopics.find((s) => s.slug === slug);
  if (!meta) return res.status(404).json({ error: 'Subtema no encontrado' });

  const prog = store.getProgressMap();
  if (entryStatus(id, prog) === 'locked') {
    return res.status(403).json({ error: 'Tema bloqueado.' });
  }

  const subProg = store.getSubtopicProgressMap(id);
  const status = subtopicStatus(id, slug, subtopics, subProg);
  const t = topics.get(id);
  const lessonSection = t.lesson.sections.find((s) => s.subtopic === slug) || null;

  res.json({
    topicId: id,
    subtopic: slug,
    title: meta.title,
    status,
    quizSize: SUBTOPIC_QUIZ_SIZE,
    passThreshold: THRESHOLD,
    lessonSection,
    progress: subProg[slug] || null
  });
});

app.post('/api/topic/:id/subtopic/:slug/quiz', (req, res) => {
  const id = Number(req.params.id);
  const { slug } = req.params;
  const subtopics = SUBTOPICS_OF_TOPIC.get(id) || [];
  if (!subtopics.find((s) => s.slug === slug)) {
    return res.status(404).json({ error: 'Subtema no encontrado' });
  }

  const prog = store.getProgressMap();
  const subProg = store.getSubtopicProgressMap(id);
  const status = subtopicStatus(id, slug, subtopics, subProg);
  if (entryStatus(id, prog) === 'locked' || status === 'locked') {
    return res.status(403).json({ error: 'Subtema bloqueado. Aprueba el anterior primero.' });
  }

  const pool = subtopicPool(id, slug);
  const qs = pickExam(pool, SUBTOPIC_QUIZ_SIZE);
  const attemptId = store.createSubtopicAttempt(id, slug);

  res.json({
    attemptId,
    topicId: id,
    subtopic: slug,
    passThreshold: THRESHOLD,
    total: qs.length,
    questions: qs.map((q) => ({
      id: q.id,
      type: q.type,
      prompt: q.prompt,
      options: q.type === 'mcq' ? shuffle(q.options) : q.type === 'error-correction' ? q.segments : null
    }))
  });
});

app.post('/api/topic/:id/subtopic/:slug/quiz/:attemptId/submit', (req, res) => {
  const id = Number(req.params.id);
  const { slug } = req.params;
  const attemptId = Number(req.params.attemptId);
  const submitted = Array.isArray(req.body?.answers) ? req.body.answers : [];
  const now = new Date().toISOString();
  const rows = [];
  const results = [];
  let correct = 0;

  for (const item of submitted) {
    const q = QUESTION_BY_ID.get(item.questionId);
    if (!q) continue;
    const ok = grade(q, item.given);
    if (ok) correct++;
    rows.push({
      attempt_id: attemptId, topic_id: id, subtopic: slug, question_id: q.id,
      given: item.given ?? '', correct: q.answer, is_correct: ok ? 1 : 0, answered_at: now
    });
    results.push({
      questionId: q.id, prompt: q.prompt, type: q.type,
      given: item.given ?? '', correct: q.answer, isCorrect: ok,
      explanation: q.explanation || ''
    });
  }

  const total = results.length;
  const score = total ? Math.round((correct / total) * 100) : 0;
  const passed = score >= THRESHOLD;

  if (total > 0) {
    store.insertSubtopicAnswers(rows);
    store.finishSubtopicAttempt({ attemptId, score, correct, total, passed });
    store.upsertSubtopicProgress(id, slug, score, passed);
  }

  res.json({ score, correct, total, passed, passThreshold: THRESHOLD, results });
});
```

- [ ] **Step 5: Ejecutar y confirmar que pasa**

Run: `npm test`
Expected: todos los tests en verde. (El primer test usa contenido real de
`content/topic-01.json`; si `Task 9` de contenido aún no corrió, el tema 1 ya trae al
menos el subtema `present-simple-usos` con preguntas hoy mismo, así que esto pasa antes
de tocar contenido.)

- [ ] **Step 6: Commit**

```bash
git add server.js content/course.json test/subtopic-routes.test.js
git commit -m "feat: rutas de quiz de subtema (ver, generar, enviar)"
```

---

### Task 7: Examen de módulo — tamaño 60 y gating por subtemas completos

**Files:**
- Modify: `server.js:16-20` (constantes de tamaño)
- Modify: `server.js:339-378` (`POST /api/topic/:id/exam`)
- Test: `test/module-exam.test.js`

**Interfaces:**
- Consumes: `moduleExamAvailable` (Task 4), `SUBTOPICS_OF_TOPIC` (Task 4).
- Produces: el examen de un `topic` usa `MODULE_EXAM_SIZE` (60) en vez de `EXAM_SIZE`
  (20), y queda bloqueado si quedan subtemas sin aprobar.

**Nota de diseño:** el chequeo de "subtemas completos" se añade como una condición
**separada** dentro de la ruta del examen, sin tocar `entryStatus`. `entryStatus`
sigue significando exactamente lo mismo que hoy ("¿lo anterior en la secuencia está
aprobado?") porque la Task 6 ya la usa para decidir si un subtema es accesible —
si aquí la sobrecargáramos para que también exija "todos los subtemas aprobados",
un tema quedaría en estado `locked` para sí mismo y sus subtemas nunca podrían
empezarse (bloqueo circular).

- [ ] **Step 1: Escribir el test que falla**

Create: `test/module-exam.test.js`

```js
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
    cleanupDb('module-exam');
  }
});
```

- [ ] **Step 2: Ejecutar y confirmar que falla**

Run: `npm test`
Expected: FAIL — hoy el examen de tema 1 responde 200 con 20 preguntas sin pedir
subtemas aprobados.

- [ ] **Step 3: Actualizar constantes (`server.js:16-20`)**

```js
const EXAM_SIZE = course.examSize || 20;
const MODULE_EXAM_SIZE = course.moduleExamSize || EXAM_SIZE;
const SUPER_SIZE = course.superExamSize || 100;
const THRESHOLD = course.passThreshold || 90;
const SUPER_EXAMS = course.superExams || [];
```

- [ ] **Step 4: Usar `MODULE_EXAM_SIZE` y añadir el chequeo de subtemas en la ruta de examen (`server.js:339-378`)**

En `app.post('/api/topic/:id/exam', ...)`, reemplaza:

```js
app.post('/api/topic/:id/exam', (req, res) => {
  const id = Number(req.params.id);
  const entry = getEntry(id);
  if (!entry || !entry.ready) return res.status(404).json({ error: 'No disponible' });

  const prog = store.getProgressMap();
  if (entryStatus(id, prog) === 'locked') {
    return res.status(403).json({
      error: entry.kind === 'superexam'
        ? `Aprueba los ${entry.sourceTopics.length} temas de este nivel para desbloquear el super examen.`
        : 'Tema bloqueado. Aprueba lo anterior con el 90%.'
    });
  }

  let weak = [];
  const last = store.getLastFinishedAttempt(id);
  if (last && !last.attempt.passed) {
    weak = [...new Set(last.answers.filter((a) => !a.is_correct).map((a) => a.subtopic))];
  }

  const size = entry.kind === 'superexam' ? SUPER_SIZE : EXAM_SIZE;
```

por:

```js
app.post('/api/topic/:id/exam', (req, res) => {
  const id = Number(req.params.id);
  const entry = getEntry(id);
  if (!entry || !entry.ready) return res.status(404).json({ error: 'No disponible' });

  const prog = store.getProgressMap();
  if (entryStatus(id, prog) === 'locked') {
    return res.status(403).json({
      error: entry.kind === 'superexam'
        ? `Aprueba los ${entry.sourceTopics.length} temas de este nivel para desbloquear el super examen.`
        : `Tema bloqueado. Aprueba lo anterior con el ${THRESHOLD}%.`
    });
  }

  // Chequeo independiente de entryStatus: el modulo puede estar "disponible" para
  // estudiar sus subtemas y aun asi tener el examen final bloqueado.
  const subtopicsForId = SUBTOPICS_OF_TOPIC.get(id) || [];
  if (entry.kind === 'topic' && subtopicsForId.length &&
      !moduleExamAvailable(subtopicsForId, store.getSubtopicProgressMap(id))) {
    return res.status(403).json({
      error: 'Aprueba todos los subtemas de este modulo para desbloquear el examen.'
    });
  }

  let weak = [];
  const last = store.getLastFinishedAttempt(id);
  if (last && !last.attempt.passed) {
    weak = [...new Set(last.answers.filter((a) => !a.is_correct).map((a) => a.subtopic))];
  }

  const size = entry.kind === 'superexam' ? SUPER_SIZE : MODULE_EXAM_SIZE;
```

También actualiza `app.get('/api/topic/:id')` (`server.js:327`) donde arma
`examSize: entry.kind === 'superexam' ? SUPER_SIZE : EXAM_SIZE` para que use
`MODULE_EXAM_SIZE` en vez de `EXAM_SIZE`.

- [ ] **Step 5: Ejecutar y confirmar que pasa**

Run: `npm test`
Expected: todos los tests en verde, incluidos los de `module-exam.test.js`.

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "feat: examen de modulo de 60 preguntas, bloqueado hasta aprobar todos los subtemas"
```

---

### Task 8: Extender `scripts/validate.js` al nuevo esquema

**Files:**
- Modify: `scripts/validate.js` (entero — mismo patrón, nuevas reglas)

**Interfaces:**
- Consumes: `content/course.json`, `content/topic-XX.json` (con o sin `subtopics`).
- Produces: mismo contrato de CLI (`exit 0` si todo bien, `exit 1` si hay problemas),
  ahora validando también los 2 tipos de pregunta nuevos y el tamaño de banco por
  subtema cuando el tema ya migró al nuevo esquema.

- [ ] **Step 1: Reemplazar `scripts/validate.js`**

```js
// Valida course.json + todos los content/topic-NN.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'content');
const course = JSON.parse(fs.readFileSync(path.join(dir, 'course.json'), 'utf8'));
const labels = course.subtopicLabels || {};
const SUBTOPIC_BANK_SIZE = 50;
let problems = 0;

for (const meta of course.topics) {
  const file = path.join(dir, `topic-${String(meta.id).padStart(2, '0')}.json`);
  if (!fs.existsSync(file)) { console.log(`tema ${meta.id}: (sin archivo)`); continue; }

  let t;
  try { t = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.log(`tema ${meta.id}: JSON INVALIDO - ${e.message}`); problems++; continue; }

  const errs = [];
  if (t.id !== meta.id) errs.push(`id ${t.id} != ${meta.id}`);
  if (!t.lesson || !Array.isArray(t.lesson.sections)) errs.push('sin lesson.sections');
  const qs = t.questions || [];
  const migrated = Array.isArray(t.subtopics) && t.subtopics.length > 0;

  if (migrated) {
    const expected = t.subtopics.length * SUBTOPIC_BANK_SIZE;
    if (qs.length !== expected) {
      errs.push(`${qs.length} preguntas (esperado ${expected} = ${t.subtopics.length} subtemas x ${SUBTOPIC_BANK_SIZE})`);
    }
    const declared = new Set(t.subtopics.map((s) => s.slug));
    for (const s of t.subtopics) {
      if (!s.slug || !s.title) errs.push(`subtopics[]: entrada sin slug/title (${JSON.stringify(s)})`);
    }
    const counts = {};
    for (const q of qs) counts[q.subtopic] = (counts[q.subtopic] || 0) + 1;
    for (const slug of declared) {
      if ((counts[slug] || 0) !== SUBTOPIC_BANK_SIZE) {
        errs.push(`subtema "${slug}": ${counts[slug] || 0} preguntas (esperado ${SUBTOPIC_BANK_SIZE})`);
      }
    }
  } else if (qs.length !== 100) {
    errs.push(`${qs.length} preguntas (esperado 100)`);
  }

  const ids = new Set();
  const subCount = {};
  for (const q of qs) {
    if (ids.has(q.id)) errs.push(`id duplicado ${q.id}`);
    ids.add(q.id);
    subCount[q.subtopic] = (subCount[q.subtopic] || 0) + 1;
    if (!labels[q.subtopic] && !migrated) errs.push(`subtopic sin label: ${q.subtopic}`);
    if (!q.prompt) errs.push(`${q.id}: sin prompt`);
    if (!q.explanation) errs.push(`${q.id}: sin explanation`);

    if (q.type === 'mcq') {
      if (!Array.isArray(q.options) || q.options.length < 2) errs.push(`${q.id}: opciones invalidas`);
      else if (!q.options.includes(q.answer)) errs.push(`${q.id}: answer no esta en options`);
      else if (new Set(q.options).size !== q.options.length) errs.push(`${q.id}: opciones repetidas`);
    } else if (q.type === 'gap' || q.type === 'key-word-transformation') {
      const acc = q.accept && q.accept.length ? q.accept : [q.answer];
      if (!acc || !acc.length || !q.answer) errs.push(`${q.id}: ${q.type} sin accept/answer`);
    } else if (q.type === 'error-correction') {
      if (!Array.isArray(q.segments) || q.segments.length < 2) errs.push(`${q.id}: segments invalidos`);
      else if (typeof q.answerIndex !== 'number' || q.answerIndex < 0 || q.answerIndex >= q.segments.length) {
        errs.push(`${q.id}: answerIndex fuera de rango`);
      }
      if (!q.answer) errs.push(`${q.id}: error-correction sin answer (texto corregido para mostrar)`);
    } else {
      errs.push(`${q.id}: type desconocido "${q.type}"`);
    }
  }

  const secSubs = new Set((t.lesson.sections || []).map((s) => s.subtopic));
  for (const s of Object.keys(subCount)) if (!secSubs.has(s)) errs.push(`subtopic "${s}" en preguntas pero no en secciones`);
  for (const s of secSubs) if (!subCount[s]) errs.push(`seccion "${s}" sin preguntas`);

  if (t.lesson.contrast && !Array.isArray(t.lesson.contrast.rows)) errs.push('contrast sin rows[]');

  const dist = Object.entries(subCount).map(([k, v]) => `${k}:${v}`).join(' ');
  if (errs.length) { problems += errs.length; console.log(`tema ${meta.id} FALLOS:\n  - ${errs.join('\n  - ')}`); }
  else console.log(`tema ${meta.id} OK  (${qs.length} preguntas | ${dist})`);
}

console.log(problems ? `\n${problems} problema(s).` : '\nTodo correcto.');
process.exit(problems ? 1 : 0);
```

- [ ] **Step 2: Ejecutar contra el contenido actual (sin migrar todavía)**

Run: `node scripts/validate.js`
Expected: mismo resultado que antes de este task para los temas 2–16 (100 preguntas,
sin `subtopics[]` → rama legacy). El tema 1 seguirá en 100 hasta el Task 8/9.

- [ ] **Step 3: Commit**

```bash
git add scripts/validate.js
git commit -m "chore: validate.js soporta el esquema de subtemas y los 2 tipos de pregunta nuevos"
```

---

## Fase 2 — Contenido piloto: Módulo 1 (8 subtemas × 50 preguntas)

**Guía de autoría (aplica a todas las tareas de esta fase):**

- Fuentes: reglas de *Advanced English Grammar* (Wendy Wilson); frases/contexto de
  *John Doe*, *Jojo's Story*, *The Fruitcake Special* (nunca copiar un pasaje literal
  largo — usarlos como inspiración de vocabulario/situación); verificación de
  terminología y estilo de examen real en British Council / Cambridge Assessment
  English / EF (búsqueda web).
- Mezcla por subtema (de 50): ~20 `mcq`, ~15 `gap`, ~8 `key-word-transformation`,
  ~7 `error-correction`.
- IDs de pregunta: continuar la numeración `t1-XXX` ya usada (hoy hasta `t1-100`; las
  preguntas nuevas siguen desde `t1-101`).
- `key-word-transformation`: formato Cambridge — frase original, palabra clave en
  mayúsculas, segunda frase con hueco (no reescritura completa). Ver contrato exacto
  en Task 3.
- `error-correction`: 3–5 `segments` en orden, uno de ellos con el error; `answerIndex`
  apunta al tramo erróneo; `answer` lleva el tramo ya corregido (para mostrarlo en la
  revisión).
- Cada pregunta necesita `explanation` (igual que hoy).
- Después de cada subtema, correr `node scripts/validate.js` y confirmar que ese
  subtema ya no aparece en la lista de fallos (mientras el resto de subtemas del tema 1
  siga en 12–13 preguntas, el tema 1 completo seguirá marcado FALLOS hasta terminar
  las 8 tareas — eso es esperado).

Cada una de las 8 tareas siguientes (9–16) es independiente y autocontenida: añade
preguntas para **un solo subtema** hasta llegar a 50, valida, y hace commit. Todas
comparten el mismo contrato (IDs `t1-1xx` en adelante, mezcla ~20 `mcq`/~15 `gap`/~8
`key-word-transformation`/~7 `error-correction`, `explanation` obligatoria) fijado en
la "Guía de autoría" de arriba — no dependen unas de otras y se pueden ejecutar en
cualquier orden o en paralelo.

### Task 9: Banco de 50 — `present-simple-usos`

**Files:** Modify: `content/topic-01.json` (array `questions`)

**Estado actual:** 13 preguntas (`t1-001`..`t1-013` aprox., todas `mcq`) para este
subtema. **Faltan 37** para llegar a 50.

- [ ] **Step 1: Añadir 37 preguntas nuevas para `present-simple-usos`**

Añadir al array `questions` de `content/topic-01.json`, con `"subtopic":
"present-simple-usos"`, IDs continuando desde el máximo ya usado en el archivo (hoy
`t1-100`, así que empezar en `t1-101`), siguiendo la mezcla de la guía de autoría:
aprox. 7 `mcq` más, 15 `gap`, 8 `key-word-transformation`, 7 `error-correction`.
Contenido: usos de Present Simple (rutinas, hechos generales, horarios, instrucciones,
estados permanentes) — reglas de *Advanced English Grammar*, frases inspiradas en los
Cambridge Readers, estilo verificado contra ejemplos de examen B1 real (British
Council / Cambridge Assessment).

- [ ] **Step 2: Validar**

Run: `node scripts/validate.js`
Expected: la línea de `tema 1 FALLOS` ya no incluye `present-simple-usos` en el
desglose de conteos (debe leerse `present-simple-usos:50` una vez termine esta tarea).

- [ ] **Step 3: Commit**

```bash
git add content/topic-01.json
git commit -m "feat(contenido): banco de 50 preguntas para present-simple-usos"
```

### Task 10: Banco de 50 — `present-simple-forma`

**Files:** Modify: `content/topic-01.json` (array `questions`)

**Estado actual:** 12 preguntas para este subtema. **Faltan 38.**

- [ ] **Step 1: Añadir 38 preguntas nuevas para `present-simple-forma`**

Mismo procedimiento que el Step 1 de la Task 9, con `"subtopic": "present-simple-forma"`.
Contenido: formación afirmativa/negativa/interrogativa, ortografía de la `-s` (`-es`
tras -o/-s/-ss/-sh/-ch/-x, consonante+y → -ies), irregular `have→has`.

- [ ] **Step 2: Validar**

Run: `node scripts/validate.js`
Expected: `present-simple-forma:50` en el desglose, sin errores de esquema nuevos.

- [ ] **Step 3: Commit**

```bash
git add content/topic-01.json
git commit -m "feat(contenido): banco de 50 preguntas para present-simple-forma"
```

### Task 11: Banco de 50 — `present-continuous-usos`

**Files:** Modify: `content/topic-01.json` (array `questions`)

**Estado actual:** 13 preguntas para este subtema. **Faltan 37.**

- [ ] **Step 1: Añadir 37 preguntas nuevas para `present-continuous-usos`**

Mismo procedimiento que el Step 1 de la Task 9, con `"subtopic":
"present-continuous-usos"`. Contenido: acción en curso ahora, situación temporal
alrededor de ahora, cambios/tendencias (get/become/improve...), planes futuros
acordados, `always/constantly` para quejas.

- [ ] **Step 2: Validar**

Run: `node scripts/validate.js`
Expected: `present-continuous-usos:50` en el desglose, sin errores de esquema nuevos.

- [ ] **Step 3: Commit**

```bash
git add content/topic-01.json
git commit -m "feat(contenido): banco de 50 preguntas para present-continuous-usos"
```

### Task 12: Banco de 50 — `present-continuous-forma`

**Files:** Modify: `content/topic-01.json` (array `questions`)

**Estado actual:** 12 preguntas para este subtema. **Faltan 38.**

- [ ] **Step 1: Añadir 38 preguntas nuevas para `present-continuous-forma`**

Mismo procedimiento que el Step 1 de la Task 9, con `"subtopic":
"present-continuous-forma"`. Contenido: `am/is/are + -ing`, ortografía del `-ing`
(consonante-vocal-consonante dobla, `-e` muda se quita, `-ie→-ying`, `-y`/`-ee` sin
cambio), negativa y pregunta.

- [ ] **Step 2: Validar**

Run: `node scripts/validate.js`
Expected: `present-continuous-forma:50` en el desglose, sin errores de esquema nuevos.

- [ ] **Step 3: Commit**

```bash
git add content/topic-01.json
git commit -m "feat(contenido): banco de 50 preguntas para present-continuous-forma"
```

### Task 13: Banco de 50 — `marcadores-temporales`

**Files:** Modify: `content/topic-01.json` (array `questions`)

**Estado actual:** 12 preguntas para este subtema. **Faltan 38.**

- [ ] **Step 1: Añadir 38 preguntas nuevas para `marcadores-temporales`**

Mismo procedimiento que el Step 1 de la Task 9, con `"subtopic":
"marcadores-temporales"`. Contenido: adverbios de frecuencia y su posición (antes del
verbo principal, después de `be`), marcadores de Simple vs Continuous, casos
ambiguos (`these days`, `nowadays`, `currently`).

- [ ] **Step 2: Validar**

Run: `node scripts/validate.js`
Expected: `marcadores-temporales:50` en el desglose, sin errores de esquema nuevos.

- [ ] **Step 3: Commit**

```bash
git add content/topic-01.json
git commit -m "feat(contenido): banco de 50 preguntas para marcadores-temporales"
```

### Task 14: Banco de 50 — `verbos-de-estado`

**Files:** Modify: `content/topic-01.json` (array `questions`)

**Estado actual:** 13 preguntas para este subtema. **Faltan 37.**

- [ ] **Step 1: Añadir 37 preguntas nuevas para `verbos-de-estado`**

Mismo procedimiento que el Step 1 de la Task 9, con `"subtopic": "verbos-de-estado"`.
Contenido: verbos de pensamiento/opinión, emociones/preferencias, sentidos/percepción,
posesión/medida — por qué no llevan `-ing` aunque el momento sea "ahora".

- [ ] **Step 2: Validar**

Run: `node scripts/validate.js`
Expected: `verbos-de-estado:50` en el desglose, sin errores de esquema nuevos.

- [ ] **Step 3: Commit**

```bash
git add content/topic-01.json
git commit -m "feat(contenido): banco de 50 preguntas para verbos-de-estado"
```

### Task 15: Banco de 50 — `verbos-estado-o-accion`

**Files:** Modify: `content/topic-01.json` (array `questions`)

**Estado actual:** 12 preguntas para este subtema. **Faltan 38.**

- [ ] **Step 1: Añadir 38 preguntas nuevas para `verbos-estado-o-accion`**

Mismo procedimiento que el Step 1 de la Task 9, con `"subtopic":
"verbos-estado-o-accion"`. Contenido: verbos que cambian de significado
(`think/have/see/taste/smell/look/be/weigh`) según sea estado o acción voluntaria.

- [ ] **Step 2: Validar**

Run: `node scripts/validate.js`
Expected: `verbos-estado-o-accion:50` en el desglose, sin errores de esquema nuevos.

- [ ] **Step 3: Commit**

```bash
git add content/topic-01.json
git commit -m "feat(contenido): banco de 50 preguntas para verbos-estado-o-accion"
```

### Task 16: Banco de 50 — `contraste-simple-continuo`

**Files:** Modify: `content/topic-01.json` (array `questions`)

**Estado actual:** 13 preguntas para este subtema. **Faltan 37.**

- [ ] **Step 1: Añadir 37 preguntas nuevas para `contraste-simple-continuo`**

Mismo procedimiento que el Step 1 de la Task 9, con `"subtopic":
"contraste-simple-continuo"`. Contenido: preguntas que obligan a elegir entre Present
Simple y Present Continuous en el mismo contexto (el punto más difícil del módulo,
conviene que tenga más `error-correction` y `key-word-transformation` que el resto).

- [ ] **Step 2: Validar**

Run: `node scripts/validate.js`
Expected: `contraste-simple-continuo:50` en el desglose, sin errores de esquema nuevos.

- [ ] **Step 3: Commit**

```bash
git add content/topic-01.json
git commit -m "feat(contenido): banco de 50 preguntas para contraste-simple-continuo"
```

### Task 17: Validación final del Módulo 1 completo

**Files:** ninguno (solo verificación)

- [ ] **Step 1:** Run: `node scripts/validate.js`
  Expected: `tema 1 OK  (400 preguntas | present-simple-usos:50 present-simple-forma:50 ...)`
  y `Todo correcto.` (los temas 2–16 siguen en su esquema legacy de 100, eso es
  correcto y esperado en este plan).
- [ ] **Step 2:** Run: `npm test`
  Expected: todos los tests de las Fases 1 pasan igual que antes (usan el tema 1 real).
- [ ] **Step 3: Commit** (si Step 1 requirió ajustes)

```bash
git add content/topic-01.json
git commit -m "fix(contenido): ajustes finales de validacion del banco del Modulo 1"
```

---

## Fase 3 — Frontend: navegación de subtemas y 2 tipos de pregunta nuevos

### Task 18: Navegación de subtemas en la vista de lección

**Files:**
- Modify: `public/js/lesson.js` (función `renderLesson`, tramo de `L.sections`)
- Modify: `public/css/styles.css` (clases nuevas, añadidas al final del archivo)

**Interfaces:**
- Consumes: `GET /api/topic/:id` ya no alcanza para saber el estado de cada subtema
  (esa info vive en `GET /api/topic/:id/subtopic/:slug`); para no disparar 8 requests
  extra al cargar la lección, se pide en `GET /api/topic/:id` un campo adicional
  `subtopicsStatus: [{slug, title, status}]` (ver Step 1).

- [ ] **Step 1: Exponer el estado de subtemas en `GET /api/topic/:id`**

En `server.js`, dentro de `app.get('/api/topic/:id', ...)` (`server.js:285-337`), justo
antes del `res.json({...})` final, añade:

```js
  const subtopicsMeta = SUBTOPICS_OF_TOPIC.get(id) || [];
  const subProgForView = store.getSubtopicProgressMap(id);
  const subtopicsStatus = subtopicsMeta.map((s) => ({
    slug: s.slug,
    title: s.title,
    status: subtopicStatus(id, s.slug, subtopicsMeta, subProgForView)
  }));
  const examLocked = entry.kind === 'topic' && subtopicsMeta.length > 0 &&
    !moduleExamAvailable(subtopicsMeta, subProgForView);
```

y añade `subtopicsStatus,` y `examLocked,` como campos del objeto que ya se envía en
`res.json({...})`. `examLocked` es independiente de `status`: un módulo puede estar
`status: 'available'` (se puede estudiar) y aun así tener `examLocked: true` (el examen
final sigue bloqueado porque faltan subtemas por aprobar).

- [ ] **Step 2: Usar `examLocked` en `ctaBlock` (`public/js/lesson.js:83-109`)**

En `ctaBlock(lr)`, la condición `if (data.status === 'locked')` hoy decide si se
muestra el botón de examen o el mensaje de bloqueo. Cámbiala por
`if (data.status === 'locked' || data.examLocked)` y, dentro de ese bloque, distingue
el mensaje:

```js
    if (data.status === 'locked' || data.examLocked) {
      html += `<div class="cta">
        <span class="locked-note">${isSuper
          ? 'Aprueba los cuatro temas de este nivel para desbloquear el super examen.'
          : data.examLocked
            ? 'Aprueba todos los subtemas de este modulo (mira la lista de arriba) para desbloquear el examen.'
            : 'Aprueba lo anterior con el ' + data.passThreshold + '% para desbloquear la evaluacion.'}</span>
        ${data.nav.prevId ? `<a class="btn-ghost" href="/lesson?topic=${data.nav.prevId}">&larr; Volver</a>` : ''}
      </div>`;
    } else {
      // ... el resto de la funcion (rama "else" con el boton de examen) no cambia.
```

(Deja el resto de `ctaBlock` tal cual está hoy — solo cambió la condición de entrada
del `if` y el texto del mensaje bloqueado.)

- [ ] **Step 3: Renderizar la lista de subtemas en `renderLesson` (`public/js/lesson.js`)**

Dentro de `renderLesson()`, después de `html += header();` y antes de
`if (lr && !lr.passed) html += repasoBox(lr);`, añade (solo si hay subtemas):

```js
    if (data.subtopicsStatus && data.subtopicsStatus.length) {
      html += '<nav class="subtopic-nav"><h2>Subtemas de este modulo</h2><ol>';
      for (const s of data.subtopicsStatus) {
        const icon = s.status === 'passed' ? '&#10003;' : s.status === 'locked' ? '&#128274;' : '&#9654;';
        const cls = 'st-' + s.status;
        html += s.status === 'locked'
          ? `<li class="${cls}"><span class="st-icon">${icon}</span> ${App.esc(s.title)}</li>`
          : `<li class="${cls}"><a href="/lesson?topic=${topicId}#s-${s.slug}" data-subtopic="${App.esc(s.slug)}">
               <span class="st-icon">${icon}</span> ${App.esc(s.title)}</a></li>`;
      }
      html += '</ol></nav>';
    }
```

- [ ] **Step 4: Añadir estilos mínimos en `public/css/styles.css`**

Al final del archivo:

```css
.subtopic-nav { margin: 1.5rem 0; }
.subtopic-nav ol { list-style: none; padding: 0; display: flex; flex-direction: column; gap: .35rem; }
.subtopic-nav li { padding: .4rem .6rem; border-radius: .4rem; }
.subtopic-nav .st-passed { color: var(--ok, #1a7f37); }
.subtopic-nav .st-locked { color: var(--muted, #888); }
.subtopic-nav .st-icon { display: inline-block; width: 1.2em; text-align: center; }
```

(Ajusta los nombres de variables `--ok`/`--muted` a las que ya existan en el archivo;
revisar con `grep -n "^:root" public/css/styles.css` antes de escribir esta parte para
no inventar variables nuevas si ya hay equivalentes.)

- [ ] **Step 5: Verificación manual**

Run: `npm run dev`, abrir `http://localhost:3000/lesson?topic=1` en el navegador.
Expected: aparece la lista de 8 subtemas bajo el encabezado, con el primero en estado
"disponible" (flecha) y el resto "bloqueado" (candado) al no haber progreso, y el botón
de examen del módulo muestra el mensaje de "aprueba todos los subtemas" en vez de un
botón activo.

- [ ] **Step 6: Commit**

```bash
git add server.js public/js/lesson.js public/css/styles.css
git commit -m "feat(ui): lista de subtemas con estado y bloqueo del examen en la vista de leccion"
```

---

### Task 19: Vista y quiz de un subtema (reutilizando el render de examen)

**Files:**
- Modify: `public/js/lesson.js` (generalizar `startExam`/`renderExam`/`submitExam`/
  `renderResults` para aceptar un "modo subtema", y añadir el enrutamiento por hash
  `#s-<slug>` a la vista de un subtema)

**Interfaces:**
- Consumes: `GET /api/topic/:id/subtopic/:slug`,
  `POST /api/topic/:id/subtopic/:slug/quiz`,
  `POST /api/topic/:id/subtopic/:slug/quiz/:attemptId/submit` (Task 6).

- [ ] **Step 1: Detectar el modo subtema al cargar la página**

Al inicio de la IIFE de `public/js/lesson.js`, después de la línea que calcula
`topicId`, añade:

```js
  const subtopicSlug = location.hash.startsWith('#s-') ? location.hash.slice(3) : null;
```

- [ ] **Step 2: Cargar y renderizar la vista de subtema cuando aplica**

Reemplaza la llamada inicial `renderLesson();` (línea 17) por:

```js
  if (subtopicSlug) { renderSubtopic(); } else { renderLesson(); }
```

Y añade, junto a `renderSuper`/`renderLesson`, una nueva función que reutiliza
`renderExam`/`submitExam`/`renderResults` pasándoles las URLs del subtema en vez de
las del tema:

```js
  async function renderSubtopic() {
    let sub;
    try {
      sub = await App.api(`/api/topic/${topicId}/subtopic/${subtopicSlug}`);
    } catch (e) {
      app.innerHTML = header() + '<p class="error">' + App.esc(e.message) + '</p>';
      return;
    }
    let html = header();
    html += `<p class="eyebrow">Subtema &middot; ${App.esc(sub.title)}</p>`;
    if (sub.lessonSection) {
      const sec = sub.lessonSection;
      html += `<article class="lesson"><section class="ls"><div class="ls-main">
        <div class="body">${sec.body}</div>
        ${sec.examples ? '<ul class="ex-list">' + sec.examples.map((x) => '<li>' + x + '</li>').join('') + '</ul>' : ''}
      </div></section></article>`;
    }
    if (sub.status === 'locked') {
      html += `<div class="cta"><span class="locked-note">Aprueba el subtema anterior primero.</span>
        <a class="btn-ghost" href="/lesson?topic=${topicId}">&larr; Volver al modulo</a></div>`;
    } else {
      const label = sub.progress ? 'Volver a intentar el quiz' : 'Empezar quiz del subtema';
      html += `<div class="cta">
        <button id="startSubtopicQuiz" class="btn-primary">${label} &middot; ${sub.quizSize} preguntas</button>
        <a class="btn-ghost" href="/lesson?topic=${topicId}">&larr; Volver al modulo</a>
      </div>`;
    }
    app.innerHTML = html;
    window.scrollTo(0, 0);
    const btn = document.getElementById('startSubtopicQuiz');
    if (btn) btn.onclick = startSubtopicQuiz;

    async function startSubtopicQuiz() {
      app.innerHTML = header() + '<p class="loading">Preparando el quiz&hellip;</p>';
      const quiz = await App.api(`/api/topic/${topicId}/subtopic/${subtopicSlug}/quiz`, { method: 'POST' });
      renderQuizForm(quiz, {
        submitUrl: `/api/topic/${topicId}/subtopic/${subtopicSlug}/quiz/${quiz.attemptId}/submit`,
        onDone: renderSubtopic
      });
    }
  }
```

- [ ] **Step 3: Extraer un render de formulario de examen reutilizable**

`renderExam`/`submitExam` de hoy están acoplados al examen de tema (usan `exam.attemptId`
y una URL fija). Añade esta función nueva (no reemplaza `renderExam`, que sigue
sirviendo al examen de módulo/súper examen sin tocarla) reutilizando el mismo cuerpo de
formulario:

```js
  function renderQuizForm(exam, { submitUrl, onDone }) {
    let html = header();
    html += '<p class="eyebrow">Quiz de subtema &middot; ' + exam.total + ' preguntas</p>';
    html += '<form id="quizForm" class="exam">';
    exam.questions.forEach((q, i) => {
      const qn = String(i + 1).padStart(String(exam.total).length, '0');
      html += `<fieldset class="q-item"><legend><span class="qn">${qn}</span>${App.esc(q.prompt)}</legend>`;
      if (q.type === 'mcq' || q.type === 'error-correction') {
        q.options.forEach((opt, oi) => {
          const val = q.type === 'error-correction' ? String(oi) : opt;
          html += `<label class="opt">
            <input type="radio" name="${App.esc(q.id)}" value="${App.esc(val)}">
            <span>${App.esc(opt)}</span></label>`;
        });
      } else {
        html += `<input type="text" class="gap" name="${App.esc(q.id)}"
          autocomplete="off" autocapitalize="off" spellcheck="false"
          placeholder="Escribe tu respuesta">`;
      }
      html += '</fieldset>';
    });
    html += '<button type="submit" class="btn-primary">Enviar respuestas</button></form>';
    app.innerHTML = html;
    window.scrollTo(0, 0);

    document.getElementById('quizForm').onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const answers = exam.questions.map((q) => ({
        questionId: q.id, given: (fd.get(q.id) || '').toString().trim()
      }));
      const r = await App.api(submitUrl, { method: 'POST', body: { answers } });
      renderQuizResult(r, onDone);
    };
  }

  function renderQuizResult(r, onDone) {
    let html = header();
    html += `<section class="result ${r.passed ? 'pass' : 'fail'}">
      <p class="eyebrow">Resultado del quiz</p>
      <div class="score">${r.score}<span class="score-pct">%</span></div>
      <p class="result-meta">${r.correct} / ${r.total} correctas &middot; umbral ${r.passThreshold}&#8202;%</p>
      <p class="stamp">${r.passed ? 'Aprobado' : 'Insuficiente'}</p>
    </section>`;
    html += '<ol class="review">';
    for (const q of r.results) {
      html += `<li class="${q.isCorrect ? 'ok' : 'no'}">
        <div class="q">${App.esc(q.prompt)}</div>
        ${q.isCorrect ? '' : '<div class="a good">Correcta: <b>' + App.esc(q.correct) + '</b></div>'}
        ${q.explanation ? '<div class="ex">' + App.esc(q.explanation) + '</div>' : ''}
      </li>`;
    }
    html += '</ol><div class="cta"><button class="btn-primary" id="backToSubtopic">Continuar</button></div>';
    app.innerHTML = html;
    window.scrollTo(0, 0);
    document.getElementById('backToSubtopic').onclick = onDone;
  }
```

- [ ] **Step 4: Añadir también el renderizado de `error-correction` en el examen de módulo**

En `renderExam` (`public/js/lesson.js:238-266`), donde hoy dice
`if (q.type === 'mcq') { ... }`, cámbialo por lo mismo que en `renderQuizForm` (Step 3)
para que el examen de módulo también soporte `error-correction`:

```js
      if (q.type === 'mcq' || q.type === 'error-correction') {
        q.options.forEach((opt, oi) => {
          const val = q.type === 'error-correction' ? String(oi) : opt;
          html += `<label class="opt">
            <input type="radio" name="${App.esc(q.id)}" value="${App.esc(val)}">
            <span>${App.esc(opt)}</span></label>`;
        });
      } else {
```

y en `server.js`, en `app.post('/api/topic/:id/exam', ...)` (`server.js:371-377`), donde
arma `options: q.type === 'mcq' ? shuffle(q.options) : null`, cambia a:

```js
      options: q.type === 'mcq' ? shuffle(q.options)
        : q.type === 'error-correction' ? q.segments
        : null
```

- [ ] **Step 5: Verificación manual end-to-end**

Run: `npm run dev`, en el navegador:
1. Ir a `http://localhost:3000/lesson?topic=1`, hacer clic en el primer subtema.
2. Completar el quiz (15 preguntas) con respuestas variadas, enviar.
3. Confirmar que el resultado muestra score/aprobado/no-aprobado y que al volver al
   módulo el segundo subtema ya aparece disponible si se aprobó.
4. Repetir hasta aprobar los 8 subtemas y confirmar que el botón de "Empezar
   evaluación" del examen de módulo pasa de bloqueado a disponible con 60 preguntas.

- [ ] **Step 6: Commit**

```bash
git add server.js public/js/lesson.js
git commit -m "feat(ui): quiz de subtema y soporte de error-correction en los examenes"
```

---

## Fase 4 — Reset y cierre

### Task 20: Backup + reset de `progreso.db`, actualizar README

**Files:**
- Modify: `E:\LearningEnglish\progreso.db` (se elimina, no se versiona igualmente por
  `.gitignore`)
- Modify: `README.md` (reflejar subtemas con quiz propio, banco de 50, examen de
  módulo de 60)

- [ ] **Step 1: Backup**

```bash
cp progreso.db progreso.pre-modulos.db
```

- [ ] **Step 2: Confirmar con el usuario y borrar**

Run: `rm progreso.db` (solo tras confirmación explícita en el chat — ya autorizada
para este cambio; ver spec §2).

- [ ] **Step 3: Actualizar `README.md`**

Reescribe la sección "Como funciona" para describir: subtema con lección + quiz de 15
(80%) que desbloquea el siguiente subtema; examen de módulo de 60 (80%) que desbloquea
el siguiente módulo tras aprobar todos los subtemas; 4 tipos de pregunta
(`mcq`/`gap`/`key-word-transformation`/`error-correction`). Actualiza también la
sección "Estructura" para mencionar `test/`, `scripts/validate.js` y el nuevo campo
`subtopics` en `topic-XX.json`.

- [ ] **Step 4: Prueba end-to-end final**

Run: `npm test && node scripts/validate.js && npm start`
Expected: todos los tests en verde, `Todo correcto.` en la validación de contenido, y
el servidor arranca limpio con `progreso.db` recién creado (vacío).

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: actualizar README con el flujo de subtemas y examen de modulo"
```

---

## Fuera de alcance de este plan (seguir el spec §8-9)

- Migrar los módulos 2–16 al nuevo esquema de subtemas (son planes futuros, uno por
  nivel o por módulo).
- OCR del libro de Swan (no se necesita para el Módulo 1 / nivel B1).
- Cualquier mecanismo de anti-duplicación entre preguntas del quiz de subtema y del
  examen de módulo (riesgo aceptado, ver spec §10.9).
