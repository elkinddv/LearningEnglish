import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as store from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const __filename = fileURLToPath(import.meta.url);
const PORT = Number(process.env.PORT) || 3000;

// ---------- Contenido ----------
const course = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'content', 'course.json'), 'utf8')
);
const SUBTOPIC_LABELS = course.subtopicLabels || {};
const EXAM_SIZE = course.examSize || 20;
const MODULE_EXAM_SIZE = course.moduleExamSize || 60;
const SUPER_SIZE = course.superExamSize || 100;
const THRESHOLD = course.passThreshold || 90;
const SUPER_EXAMS = course.superExams || [];

// Temas reales (con su banco de preguntas)
const topics = new Map();
for (const meta of course.topics) {
  const file = path.join(
    __dirname, 'content', `topic-${String(meta.id).padStart(2, '0')}.json`
  );
  if (fs.existsSync(file)) {
    topics.set(meta.id, JSON.parse(fs.readFileSync(file, 'utf8')));
    meta.ready = true;
  } else {
    meta.ready = false;
  }
}

// slug -> titulo, en orden, para cada tema que ya adopto el esquema de subtemas.
const SUBTOPICS_OF_TOPIC = new Map();
for (const [tid, t] of topics) {
  if (Array.isArray(t.subtopics) && t.subtopics.length) {
    SUBTOPICS_OF_TOPIC.set(tid, t.subtopics);
  }
}

// Mapas globales: id de pregunta -> pregunta y -> tema de origen
const QUESTION_BY_ID = new Map();
const TOPIC_OF_QUESTION = new Map();
for (const [tid, t] of topics) {
  for (const q of t.questions) {
    QUESTION_BY_ID.set(q.id, q);
    TOPIC_OF_QUESTION.set(q.id, tid);
  }
}

// ---------- Entradas: tema o super examen ----------
function isSuper(id) {
  return SUPER_EXAMS.some((s) => s.id === id);
}

function superMeta(id) {
  return SUPER_EXAMS.find((s) => s.id === id) || null;
}

// Devuelve { id, kind, title, subtitle, level, ready, questions[] }
function getEntry(id) {
  const s = superMeta(id);
  if (s) {
    const ok = s.sourceTopics.every((tid) => topics.has(tid));
    const questions = ok
      ? s.sourceTopics.flatMap((tid) => topics.get(tid).questions)
      : [];
    const names = s.sourceTopics
      .map((tid) => course.topics.find((t) => t.id === tid))
      .filter(Boolean);
    return {
      id: s.id,
      kind: 'superexam',
      title: `Super examen ${s.code}`,
      subtitle: `${SUPER_SIZE} preguntas de los temas ${s.sourceTopics[0]}–${s.sourceTopics[s.sourceTopics.length - 1]}`,
      level: { code: s.code, name: (course.levels.find((l) => l.code === s.code) || {}).name || '' },
      ready: ok,
      questions,
      sourceTopics: names.map((m) => ({ id: m.id, title: m.title }))
    };
  }
  const meta = course.topics.find((t) => t.id === id);
  if (!meta) return null;
  const t = topics.get(id);
  return {
    id,
    kind: 'topic',
    title: meta.title,
    subtitle: meta.subtitle,
    level: levelOf(id),
    ready: !!meta.ready,
    questions: t ? t.questions : [],
    lesson: t ? t.lesson : null
  };
}

// Secuencia lineal para el candado y la navegacion:
// t1..t4, SE101, t5..t8, SE102, t9..t12, SE103, t13..t16, SE104
const SEQUENCE = [];
course.levels.forEach((L) => {
  L.topicIds.forEach((tid) => SEQUENCE.push({ id: tid, kind: 'topic' }));
  if (L.superExamId) SEQUENCE.push({ id: L.superExamId, kind: 'superexam' });
});

function levelOf(topicId) {
  const L = course.levels.find((l) => l.topicIds.includes(topicId));
  return L ? { code: L.code, name: L.name } : null;
}

function entryStatus(id, prog) {
  if (prog[id]?.passed) return 'passed';

  const s = superMeta(id);
  if (s) {
    if (!s.sourceTopics.every((tid) => topics.has(tid))) return 'soon';
    return s.sourceTopics.every((tid) => prog[tid]?.passed) ? 'available' : 'locked';
  }

  const meta = course.topics.find((t) => t.id === id);
  if (!meta || !meta.ready) return 'soon';
  const idx = SEQUENCE.findIndex((e) => e.id === id);
  if (idx <= 0) return 'available';
  const prev = SEQUENCE[idx - 1];
  return prog[prev.id]?.passed ? 'available' : 'locked';
}

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

function titleOf(id) {
  const s = superMeta(id);
  if (s) return `Super examen ${s.code}`;
  return (course.topics.find((t) => t.id === id) || {}).title || '';
}

function navFor(id, prog) {
  const idx = SEQUENCE.findIndex((e) => e.id === id);
  const prevE = idx > 0 ? SEQUENCE[idx - 1] : null;
  const nextE = idx >= 0 && idx < SEQUENCE.length - 1 ? SEQUENCE[idx + 1] : null;
  const thisPassed = !!prog[id]?.passed;
  return {
    prev: prevE && prog[prevE.id]?.passed
      ? { id: prevE.id, title: titleOf(prevE.id), kind: prevE.kind }
      : null,
    next: nextE && thisPassed
      ? { id: nextE.id, title: titleOf(nextE.id), kind: nextE.kind }
      : null,
    prevId: prevE ? prevE.id : null,
    nextId: nextE ? nextE.id : null,
    nextKind: nextE ? nextE.kind : null,
    thisPassed
  };
}

// ---------- Helpers de evaluacion ----------
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickExam(pool, size, weak = [], perSubMin = 1) {
  const bySub = {};
  for (const q of pool) (bySub[q.subtopic] ??= []).push(q);

  const chosen = [];
  const used = new Set();

  // Cobertura base: perSubMin preguntas por subtema
  for (const sub of Object.keys(bySub)) {
    for (const q of shuffle(bySub[sub]).slice(0, perSubMin)) {
      if (chosen.length >= size) break;
      chosen.push(q); used.add(q.id);
    }
  }
  // Reintento: hasta el 60% desde los subtemas fallados
  if (weak.length) {
    const target = Math.min(Math.round(size * 0.6), size);
    for (const q of shuffle(pool.filter((q) => weak.includes(q.subtopic) && !used.has(q.id)))) {
      if (chosen.length >= target) break;
      chosen.push(q); used.add(q.id);
    }
  }
  // Rellenar el resto al azar
  for (const q of shuffle(pool.filter((q) => !used.has(q.id)))) {
    if (chosen.length >= size) break;
    chosen.push(q); used.add(q.id);
  }
  return shuffle(chosen).slice(0, size);
}

function normalize(s) {
  return String(s ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.]+$/, '');
}

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

// ---------- App ----------
const app = express();

// ---------- Basic auth (opcional) ----------
// Se activa solo si defines SITE_PASSWORD en el entorno.
// Usuario por defecto: "alumno" (cambialo con SITE_USER).
const AUTH_USER = process.env.SITE_USER || 'alumno';
const AUTH_PASS = process.env.SITE_PASSWORD || '';

function safeEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

if (AUTH_PASS) {
  app.use((req, res, next) => {
    const header = req.headers.authorization || '';
    const [scheme, encoded] = header.split(' ');
    if (scheme === 'Basic' && encoded) {
      const [user, ...rest] = Buffer.from(encoded, 'base64').toString().split(':');
      const pass = rest.join(':');
      if (safeEqual(user, AUTH_USER) && safeEqual(pass, AUTH_PASS)) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Learning English", charset="UTF-8"');
    res.status(401).send('Autenticacion requerida.');
  });
  console.log('  [auth] Proteccion por contrasena ACTIVADA');
} else {
  console.log('  [auth] Sin contrasena (define SITE_PASSWORD para activarla)');
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/course', (req, res) => {
  const prog = store.getProgressMap();
  const levels = course.levels.map((L) => {
    const level = {
      code: L.code,
      name: L.name,
      topics: L.topicIds.map((tid) => {
        const meta = course.topics.find((t) => t.id === tid);
        const p = prog[tid];
        return {
          id: tid,
          title: meta.title,
          subtitle: meta.subtitle,
          ready: !!meta.ready,
          status: entryStatus(tid, prog),
          bestScore: p ? p.best_score : null,
          attempts: p ? p.attempts_count : 0
        };
      })
    };
    if (L.superExamId) {
      const e = getEntry(L.superExamId);
      const p = prog[L.superExamId];
      level.superExam = {
        id: L.superExamId,
        title: e.title,
        subtitle: e.subtitle,
        status: entryStatus(L.superExamId, prog),
        bestScore: p ? p.best_score : null,
        attempts: p ? p.attempts_count : 0
      };
    }
    return level;
  });
  res.json({
    title: course.title,
    passThreshold: THRESHOLD,
    examSize: EXAM_SIZE,
    superExamSize: SUPER_SIZE,
    subtopicLabels: SUBTOPIC_LABELS,
    levels,
    stats: store.getStats()
  });
});

app.get('/api/topic/:id', (req, res) => {
  const id = Number(req.params.id);
  const entry = getEntry(id);
  if (!entry) return res.status(404).json({ error: 'No encontrado' });

  const prog = store.getProgressMap();
  const status = entryStatus(id, prog);

  let lastResult = null;
  const last = store.getLastFinishedAttempt(id);
  if (last) {
    const wrong = last.answers.filter((a) => !a.is_correct);
    lastResult = {
      score: last.attempt.score,
      passed: !!last.attempt.passed,
      correct: last.attempt.correct_count,
      total: last.attempt.total,
      date: last.attempt.finished_at,
      weakSubtopics: [...new Set(wrong.map((a) => a.subtopic))],
      wrongQuestions: wrong.map((a) => {
        const q = QUESTION_BY_ID.get(a.question_id) || {};
        return {
          prompt: q.prompt || '(pregunta)',
          given: a.given,
          correct: a.correct,
          explanation: q.explanation || '',
          subtopic: a.subtopic,
          subtopicLabel: SUBTOPIC_LABELS[a.subtopic] || a.subtopic
        };
      })
    };
  }

  const subtopicsMeta = SUBTOPICS_OF_TOPIC.get(id) || [];
  const subProgForView = store.getSubtopicProgressMap(id);
  const subtopicsStatus = subtopicsMeta.map((s) => ({
    slug: s.slug,
    title: s.title,
    status: subtopicStatus(id, s.slug, subtopicsMeta, subProgForView)
  }));
  const examLocked = entry.kind === 'topic' && subtopicsMeta.length > 0 &&
    !moduleExamAvailable(subtopicsMeta, subProgForView);

  res.json({
    id,
    kind: entry.kind,
    title: entry.title,
    subtitle: entry.subtitle,
    level: entry.level,
    ready: entry.ready,
    status,
    passThreshold: THRESHOLD,
    examSize: entry.kind === 'superexam' ? SUPER_SIZE : MODULE_EXAM_SIZE,
    lesson: entry.kind === 'topic' ? entry.lesson : null,
    superExam: entry.kind === 'superexam'
      ? { sourceTopics: entry.sourceTopics, count: entry.questions.length }
      : null,
    subtopicLabels: SUBTOPIC_LABELS,
    subtopicsStatus,
    examLocked,
    progress: prog[id] || null,
    lastResult,
    nav: navFor(id, prog)
  });
});

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
  const perSubMin = entry.kind === 'superexam' ? 3 : 1;
  const qs = pickExam(entry.questions, size, weak, perSubMin);
  const attemptId = store.createAttempt(id);

  res.json({
    attemptId,
    topicId: id,
    kind: entry.kind,
    passThreshold: THRESHOLD,
    total: qs.length,
    focus: weak.map((s) => SUBTOPIC_LABELS[s] || s),
    questions: qs.map((q) => ({
      id: q.id,
      type: q.type,
      prompt: q.prompt,
      options: q.type === 'mcq' ? shuffle(q.options) : null
    }))
  });
});

app.post('/api/topic/:id/exam/:attemptId/submit', (req, res) => {
  const id = Number(req.params.id);
  const attemptId = Number(req.params.attemptId);
  const entry = getEntry(id);
  if (!entry) return res.status(404).json({ error: 'No disponible' });

  const submitted = Array.isArray(req.body?.answers) ? req.body.answers : [];
  const now = new Date().toISOString();
  const results = [];
  const rows = [];
  let correct = 0;

  for (const item of submitted) {
    const q = QUESTION_BY_ID.get(item.questionId);
    if (!q) continue;
    const ok = grade(q, item.given);
    if (ok) correct++;
    rows.push({
      attempt_id: attemptId,
      topic_id: id,
      question_id: q.id,
      subtopic: q.subtopic,
      given: item.given ?? '',
      correct: q.answer,
      is_correct: ok ? 1 : 0,
      answered_at: now
    });
    results.push({
      questionId: q.id,
      prompt: q.prompt,
      type: q.type,
      given: item.given ?? '',
      correct: q.answer,
      isCorrect: ok,
      subtopic: q.subtopic,
      subtopicLabel: SUBTOPIC_LABELS[q.subtopic] || q.subtopic,
      explanation: q.explanation || '',
      fromTopic: TOPIC_OF_QUESTION.get(q.id) || null
    });
  }

  const total = results.length;
  const score = total ? Math.round((correct / total) * 100) : 0;
  const passed = score >= THRESHOLD;

  if (total > 0) {
    store.insertAnswers(rows);
    store.finishAttempt({ attemptId, score, correct, total, passed });
    store.upsertProgress(id, score, passed);
  }

  const bySub = {};
  for (const r of results) {
    const s = (bySub[r.subtopic] ??= {
      subtopic: r.subtopic, label: r.subtopicLabel, total: 0, correct: 0
    });
    s.total++;
    if (r.isCorrect) s.correct++;
  }

  // Desglose por tema (util en el super examen)
  const byTopic = {};
  for (const r of results) {
    if (!r.fromTopic) continue;
    const meta = course.topics.find((t) => t.id === r.fromTopic);
    const b = (byTopic[r.fromTopic] ??= {
      topicId: r.fromTopic, label: meta ? `${meta.id}. ${meta.title}` : String(r.fromTopic),
      total: 0, correct: 0
    });
    b.total++;
    if (r.isCorrect) b.correct++;
  }

  res.json({
    score,
    correct,
    total,
    passed,
    passThreshold: THRESHOLD,
    kind: entry.kind,
    results,
    bySubtopic: Object.values(bySub),
    byTopic: entry.kind === 'superexam'
      ? Object.values(byTopic).sort((a, b) => a.topicId - b.topicId)
      : [],
    weakSubtopics: Object.values(bySub).filter((s) => s.correct < s.total).map((s) => s.subtopic)
  });
});

app.post('/api/reset-all', (req, res) => {
  store.resetAll();
  res.json({ ok: true });
});

app.post('/api/topic/:id/reset', (req, res) => {
  const id = Number(req.params.id);
  if (!getEntry(id)) return res.status(404).json({ error: 'No encontrado' });
  store.resetTopic(id);
  res.json({ ok: true });
});

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

app.get('/lesson', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'lesson.html'))
);

// ---------- Arranque ----------
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

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
