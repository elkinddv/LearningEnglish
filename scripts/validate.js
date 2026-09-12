// Valida course.json + todos los content/topic-NN.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'content');
const course = JSON.parse(fs.readFileSync(path.join(dir, 'course.json'), 'utf8'));
const labels = course.subtopicLabels || {};
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
  if (qs.length !== 100) errs.push(`${qs.length} preguntas (esperado 100)`);

  const ids = new Set();
  const subCount = {};
  for (const q of qs) {
    if (ids.has(q.id)) errs.push(`id duplicado ${q.id}`);
    ids.add(q.id);
    subCount[q.subtopic] = (subCount[q.subtopic] || 0) + 1;
    if (!labels[q.subtopic]) errs.push(`subtopic sin label: ${q.subtopic}`);
    if (!q.prompt) errs.push(`${q.id}: sin prompt`);
    if (!q.explanation) errs.push(`${q.id}: sin explanation`);
    if (q.type === 'mcq') {
      if (!Array.isArray(q.options) || q.options.length < 2) errs.push(`${q.id}: opciones invalidas`);
      else if (!q.options.includes(q.answer)) errs.push(`${q.id}: answer no esta en options`);
      else if (new Set(q.options).size !== q.options.length) errs.push(`${q.id}: opciones repetidas`);
    } else if (q.type === 'gap') {
      const acc = q.accept && q.accept.length ? q.accept : [q.answer];
      if (!acc || !acc.length || !q.answer) errs.push(`${q.id}: gap sin accept/answer`);
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
