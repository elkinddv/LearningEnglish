// Capa de datos: SQLite integrado en Node (node:sqlite). Sin dependencias nativas.
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Ruta de la BD. Por defecto progreso.db; se puede sobreescribir con PROGRESO_DB
// (util para pruebas: nunca tocar el progreso real del usuario).
const DB_PATH = process.env.PROGRESO_DB
  ? path.resolve(__dirname, process.env.PROGRESO_DB)
  : path.join(__dirname, 'progreso.db');
const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS attempts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_id      INTEGER NOT NULL,
    started_at    TEXT    NOT NULL,
    finished_at   TEXT,
    score         REAL,
    correct_count INTEGER,
    total         INTEGER,
    passed        INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS answers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_id  INTEGER NOT NULL,
    topic_id    INTEGER NOT NULL,
    question_id TEXT    NOT NULL,
    subtopic    TEXT    NOT NULL,
    given       TEXT,
    correct     TEXT    NOT NULL,
    is_correct  INTEGER NOT NULL,
    answered_at TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS topic_progress (
    topic_id       INTEGER PRIMARY KEY,
    passed         INTEGER NOT NULL DEFAULT 0,
    best_score     REAL    NOT NULL DEFAULT 0,
    attempts_count INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TEXT
  );

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

  CREATE INDEX IF NOT EXISTS idx_answers_attempt ON answers(attempt_id);
  CREATE INDEX IF NOT EXISTS idx_answers_subtopic ON answers(subtopic);
  CREATE INDEX IF NOT EXISTS idx_subtopic_answers_attempt ON subtopic_answers(attempt_id);
`);

export function createAttempt(topicId) {
  const info = db
    .prepare(`INSERT INTO attempts (topic_id, started_at) VALUES (?, ?)`)
    .run(topicId, new Date().toISOString());
  return Number(info.lastInsertRowid);
}

export function finishAttempt({ attemptId, score, correct, total, passed }) {
  db.prepare(
    `UPDATE attempts
        SET finished_at = ?, score = ?, correct_count = ?, total = ?, passed = ?
      WHERE id = ?`
  ).run(new Date().toISOString(), score, correct, total, passed ? 1 : 0, attemptId);
}

export function insertAnswers(rows) {
  const stmt = db.prepare(
    `INSERT INTO answers
       (attempt_id, topic_id, question_id, subtopic, given, correct, is_correct, answered_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const r of rows) {
    stmt.run(
      r.attempt_id, r.topic_id, r.question_id, r.subtopic,
      r.given, r.correct, r.is_correct, r.answered_at
    );
  }
}

export function upsertProgress(topicId, score, passed) {
  db.prepare(`
    INSERT INTO topic_progress (topic_id, passed, best_score, attempts_count, last_attempt_at)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(topic_id) DO UPDATE SET
      passed          = MAX(topic_progress.passed, excluded.passed),
      best_score      = MAX(topic_progress.best_score, excluded.best_score),
      attempts_count  = topic_progress.attempts_count + 1,
      last_attempt_at = excluded.last_attempt_at
  `).run(topicId, passed ? 1 : 0, score, new Date().toISOString());
}

export function getProgressMap() {
  const map = {};
  for (const r of db.prepare(`SELECT * FROM topic_progress`).all()) {
    map[r.topic_id] = r;
  }
  return map;
}

export function getLastFinishedAttempt(topicId) {
  const attempt = db
    .prepare(
      `SELECT * FROM attempts
        WHERE topic_id = ? AND finished_at IS NOT NULL
        ORDER BY id DESC LIMIT 1`
    )
    .get(topicId);
  if (!attempt) return null;
  const answers = db.prepare(`SELECT * FROM answers WHERE attempt_id = ?`).all(attempt.id);
  return { attempt, answers };
}

export function getStats() {
  const totals = db
    .prepare(`SELECT COUNT(*) AS answered, COALESCE(SUM(is_correct), 0) AS correct FROM answers`)
    .get();
  const bySubtopic = db
    .prepare(`
      SELECT subtopic, COUNT(*) AS total, COALESCE(SUM(is_correct), 0) AS correct
        FROM answers GROUP BY subtopic ORDER BY subtopic
    `)
    .all();
  const attempts = db
    .prepare(`SELECT COUNT(*) AS n FROM attempts WHERE finished_at IS NOT NULL`)
    .get();
  return {
    answered: totals.answered,
    correct: totals.correct,
    wrong: totals.answered - totals.correct,
    attempts: attempts.n,
    bySubtopic
  };
}

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

export default db;
