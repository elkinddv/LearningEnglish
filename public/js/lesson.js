// Vista de tema o super examen: leccion/portada -> evaluacion -> resultados -> candado del umbral de aprobado.
(async function () {
  const app = document.getElementById('app');
  const topicId = Number(new URLSearchParams(location.search).get('topic'));
  if (!topicId) { location.href = '/'; return; }

  let data;
  try {
    data = await App.api('/api/topic/' + topicId);
  } catch (e) {
    app.innerHTML = '<p class="error">' + App.esc(e.message) +
      '</p><p><a href="/">&larr; Indice</a></p>';
    return;
  }
  const isSuper = data.kind === 'superexam';
  document.title = isSuper ? data.title : (data.id + '. ' + data.title);
  renderLesson();

  function navLabel(ref, fallbackId) {
    if (!ref) return fallbackId ? 'Tema ' + fallbackId : '';
    return ref.kind === 'superexam' ? '&#9733; Super examen' : 'Tema ' + ref.id;
  }

  // ---------- Cabecera comun ----------
  function header() {
    const n = data.nav;
    const prev = n.prev
      ? `<a href="/lesson?topic=${n.prev.id}">&#8592; ${navLabel(n.prev)}</a>`
      : n.prevId
        ? `<span class="rh-muted">&#8592; ${navLabel(null, n.prevId)}</span>`
        : '<span class="rh-muted">Inicio</span>';
    const next = n.next
      ? `<a href="/lesson?topic=${n.next.id}">${navLabel(n.next)} &#8594;</a>`
      : `<span class="rh-muted" title="${
          data.status === 'passed'
            ? 'Lo siguiente esta en preparacion'
            : 'Aprueba con ' + data.passThreshold + '% para avanzar'
        }">${navLabel(null, n.nextId)} &#8594;</span>`;
    const p = data.progress;
    const PART_OF = { B1: 'I', B2: 'II', C1: 'III', C2: 'IV' };
    const part = data.level ? (PART_OF[data.level.code] || '') : '';
    const eyebrow = isSuper
      ? `Nivel ${data.level ? data.level.code : ''} &middot; Parte ${part} de IV &middot; Super examen`
      : `Nivel ${data.level ? data.level.code : ''} &middot; Parte ${part} &middot; Tema ${data.id} de 16`;
    return `
      <div class="runhead">
        <a class="rh-back" href="/">&#8592; Indice del curso</a>
        <span class="rh-nav">${prev}<span class="rh-dot">&middot;</span>${next}</span>
      </div>
      <header class="opener${isSuper ? ' opener-super' : ''}">
        <span class="opener-no">${isSuper ? '&#9733;' : data.id}</span>
        <div class="opener-text">
          <p class="eyebrow">${eyebrow}</p>
          <h1 class="opener-title">${App.esc(data.title)}</h1>
          <p class="opener-sub">${App.esc(data.subtitle)}</p>
          ${p ? `<p class="opener-meta">Mejor resultado <b>${Math.round(p.best_score)}&#8202;%</b>
            &middot; ${p.attempts_count} intento(s)${p.passed ? ' &middot; <b class="is-ok">aprobado</b>' : ''}</p>` : ''}
        </div>
      </header>`;
  }

  function repasoBox(lr) {
    return `
      <div class="review-box">
        <h2>Repaso enfocado</h2>
        <p>En tu ultimo intento sacaste <b>${lr.score}%</b> y necesitas <b>${data.passThreshold}%</b>.
        Repasa estos subtemas y vuelve a evaluarte:</p>
        <ul>${lr.weakSubtopics.map((s) =>
          '<li>' + App.esc(data.subtopicLabels[s] || s) + '</li>').join('')}</ul>
        <details><summary>Ver las ${lr.wrongQuestions.length} preguntas que fallaste</summary>
          <ol class="wrong-list">${lr.wrongQuestions.map((w) => `
            <li>
              <div class="q">${App.esc(w.prompt)}</div>
              <div class="a bad">Tu respuesta: ${App.esc(w.given || '-')}</div>
              <div class="a good">Correcta: ${App.esc(w.correct)}</div>
              ${w.explanation ? '<div class="ex">' + App.esc(w.explanation) + '</div>' : ''}
            </li>`).join('')}
          </ol>
        </details>
      </div>`;
  }

  function ctaBlock(lr) {
    let html = '';
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
      const label = isSuper
        ? (lr ? 'Repetir super examen' : 'Empezar super examen')
        : (lr ? 'Volver a evaluarme' : 'Empezar evaluacion');
      html += `<div class="cta">
        <button id="startExam" class="btn-primary">${label} &middot; ${data.examSize} preguntas</button>
        ${data.status === 'passed' && data.nav.next
          ? `<a class="btn-ghost" href="/lesson?topic=${data.nav.next.id}">${navLabel(data.nav.next)} &rarr;</a>` : ''}
      </div>`;
    }
    const hasProgress = data.progress && data.progress.attempts_count > 0;
    html += `<section class="admin-row">
      <span class="admin-label">Zona de reinicio</span>
      <button id="resetTopic" class="btn-danger"${hasProgress ? '' : ' disabled'}>${isSuper ? 'Reiniciar este super examen' : 'Reiniciar este tema'}</button>
      <a class="admin-link" href="/">Reiniciar todo el curso &rarr;</a>
    </section>`;
    return html;
  }

  // ---------- Portada del super examen ----------
  function renderSuper() {
    const lr = data.lastResult;
    let html = header();
    if (lr && !lr.passed) html += repasoBox(lr);

    html += `
      <article class="lesson">
        <p class="intro-p">Repaso de <strong>toda la parte</strong>: <strong>${data.superExam.count}</strong> preguntas
        combinadas de los cuatro temas de este nivel. La evaluacion toma <strong>${data.examSize}</strong> al azar
        (al menos 3 por subtema). Necesitas el <strong>${data.passThreshold}&#8202;%</strong> para desbloquear el siguiente nivel.</p>
        <section class="ls"><span class="ls-no">&#9733;</span><div class="ls-main">
          <h2>Temas que entran</h2>
          <ul class="ex-list">${data.superExam.sourceTopics.map((t) =>
            `<li><a href="/lesson?topic=${t.id}">${t.id}. ${App.esc(t.title)}</a></li>`).join('')}</ul>
        </div></section>
      </article>`;

    html += ctaBlock(lr);
    app.innerHTML = html;
    wireLesson();
  }

  // ---------- Leccion de un tema ----------
  function renderLesson() {
    if (isSuper) { renderSuper(); return; }

    const L = data.lesson;
    if (!L) {
      app.innerHTML = header() + '<p class="error">Este tema aun no tiene contenido.</p>';
      return;
    }
    const lr = data.lastResult;
    let html = header();
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
    if (lr && !lr.passed) html += repasoBox(lr);

    html += '<article class="lesson">';
    if (L.intro) html += '<p class="intro-p">' + L.intro + '</p>';

    for (const sec of L.sections) {
      const weak = lr && !lr.passed && lr.weakSubtopics.includes(sec.subtopic);
      const m = sec.heading.match(/^(\d+)\s*[-–—]\s*(.+)$/);
      const num = m ? m[1] : '';
      const htext = m ? m[2] : sec.heading;
      html += `
        <section class="ls ${weak ? 'ls-weak' : ''}" id="s-${sec.subtopic}">
          <span class="ls-no">${num}</span>
          <div class="ls-main">
            <h2>${App.esc(htext)} ${weak ? '<span class="flag">revisar</span>' : ''}</h2>
            <div class="body">${sec.body}</div>
            ${sec.examples ? '<ul class="ex-list">' +
              sec.examples.map((x) => '<li>' + x + '</li>').join('') + '</ul>' : ''}
          </div>
        </section>`;
    }

    if (L.contrast) {
      const headers = L.contrast.headers || [];
      const rows = L.contrast.rows || [];
      html += `
        <section class="ls"><span class="ls-no"></span><div class="ls-main">
          <h2>${App.esc(L.contrast.title || 'Tabla de contraste')}</h2>
          <div class="tbl-wrap"><table class="grammar">
            <thead><tr>${headers.map((h) => '<th>' + App.esc(h) + '</th>').join('')}</tr></thead>
            <tbody>${rows.map((r) =>
              '<tr>' + r.map((cell, i) =>
                i === 0 ? '<td>' + App.esc(cell) + '</td>' : '<td>' + cell + '</td>'
              ).join('') + '</tr>'
            ).join('')}</tbody>
          </table></div>
        </div></section>`;
    }
    if (L.mistakes) {
      html += '<section class="ls"><span class="ls-no"></span><div class="ls-main">' +
        '<h2>Errores tipicos</h2><ul class="mistakes">' +
        L.mistakes.map((m) => '<li>' + m + '</li>').join('') + '</ul></div></section>';
    }
    if (L.sources) {
      html += '<section class="ls sources"><span class="ls-no"></span><div class="ls-main">' +
        '<h2>Fuentes</h2><ul>' +
        L.sources.map((s) =>
          `<li><a href="${App.esc(s.url)}" target="_blank" rel="noopener">${App.esc(s.label)}</a></li>`
        ).join('') + '</ul></div></section>';
    }
    html += '</article>';

    html += ctaBlock(lr);
    app.innerHTML = html;
    wireLesson();
  }

  function wireLesson() {
    const startBtn = document.getElementById('startExam');
    if (startBtn) startBtn.onclick = startExam;
    const rt = document.getElementById('resetTopic');
    if (rt && !rt.disabled) rt.onclick = resetTopic;
    window.scrollTo(0, 0);
  }

  async function resetTopic() {
    if (!confirm(
      (isSuper ? 'Reiniciar este super examen' : 'Reiniciar este tema') +
      ' borra sus intentos, respuestas y el "aprobado".\nNo afecta al resto. Continuar?'
    )) return;
    try {
      await App.api('/api/topic/' + topicId + '/reset', { method: 'POST' });
      data = await App.api('/api/topic/' + topicId);
      renderLesson();
    } catch (e) {
      alert(e.message);
    }
  }

  // ---------- Evaluacion ----------
  async function startExam() {
    app.innerHTML = header() + '<p class="loading">Preparando' + (isSuper ? ' el super examen' : ' la evaluacion') + '&hellip;</p>';
    let exam;
    try {
      exam = await App.api('/api/topic/' + topicId + '/exam', { method: 'POST' });
    } catch (e) {
      app.innerHTML = header() + '<p class="error">' + App.esc(e.message) +
        '</p><p><button class="btn-ghost" onclick="location.reload()">Reintentar</button></p>';
      return;
    }
    renderExam(exam);
  }

  function renderExam(exam) {
    let html = header();
    html += '<p class="eyebrow">' + (isSuper ? 'Super examen' : 'Evaluacion') + ' &middot; ' + exam.total + ' preguntas</p>';
    if (exam.focus && exam.focus.length) {
      html += '<div class="focus-note">Refuerza: ' + exam.focus.map(App.esc).join(' &middot; ') + '</div>';
    }
    html += '<form id="examForm" class="exam">';
    exam.questions.forEach((q, i) => {
      const qn = String(i + 1).padStart(String(exam.total).length, '0');
      html += `<fieldset class="q-item"><legend><span class="qn">${qn}</span>${App.esc(q.prompt)}</legend>`;
      if (q.type === 'mcq') {
        for (const opt of q.options) {
          html += `<label class="opt">
            <input type="radio" name="${App.esc(q.id)}" value="${App.esc(opt)}">
            <span>${App.esc(opt)}</span></label>`;
        }
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

    document.getElementById('examForm').onsubmit = (ev) => submitExam(ev, exam);
  }

  async function submitExam(ev, exam) {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const answers = exam.questions.map((q) => ({
      questionId: q.id,
      given: (fd.get(q.id) || '').toString().trim()
    }));
    const missing = answers.filter((a) => !a.given).length;
    if (missing && !confirm('Tienes ' + missing + ' pregunta(s) sin responder. Enviar de todas formas?')) return;

    const btn = ev.target.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Corrigiendo…';
    let r;
    try {
      r = await App.api(`/api/topic/${topicId}/exam/${exam.attemptId}/submit`, {
        method: 'POST',
        body: { answers }
      });
    } catch (e) {
      alert(e.message);
      btn.disabled = false;
      btn.textContent = 'Enviar respuestas';
      return;
    }
    data = await App.api('/api/topic/' + topicId);
    renderResults(r);
  }

  // ---------- Resultados ----------
  function renderResults(r) {
    let html = header();
    const verdict = r.passed
      ? (isSuper ? 'Nivel superado. Siguiente parte desbloqueada.' : 'Siguiente desbloqueado.')
      : 'Repasa los subtemas marcados y vuelve a intentarlo.';
    html += `
      <section class="result ${r.passed ? 'pass' : 'fail'}">
        <p class="eyebrow">${isSuper ? 'Super examen' : 'Resultado'}</p>
        <div class="score">${r.score}<span class="score-pct">%</span></div>
        <p class="result-meta">${r.correct} / ${r.total} correctas &middot; umbral ${r.passThreshold}&#8202;%</p>
        <p class="stamp">${r.passed ? 'Aprobado' : 'Insuficiente'}</p>
        <p class="verdict">${verdict}</p>
      </section>`;

    if (isSuper && r.byTopic && r.byTopic.length) {
      html += '<h2 class="section-h">Por tema</h2><ul class="ledger">';
      for (const b of r.byTopic) {
        const p = App.pct(b.correct, b.total);
        html += `<li class="${p < r.passThreshold ? 'weak' : ''}">
          <span class="ldg-label">${App.esc(b.label)}</span>
          <span class="ldg-val">${b.correct}/${b.total} &middot; ${p}%</span></li>`;
      }
      html += '</ul>';
    }

    html += '<h2 class="section-h">Por subtema</h2><ul class="ledger">';
    for (const s of r.bySubtopic) {
      const p = App.pct(s.correct, s.total);
      html += `<li class="${s.correct < s.total ? 'weak' : ''}">
        <span class="ldg-label">${App.esc(s.label)}</span>
        <span class="ldg-val">${s.correct}/${s.total} &middot; ${p}%</span></li>`;
    }
    html += '</ul>';

    html += '<h2 class="section-h">Revision</h2><ol class="review">';
    for (const q of r.results) {
      html += `<li class="${q.isCorrect ? 'ok' : 'no'}">
        <div class="q">${App.esc(q.prompt)}</div>
        <div class="a">Tu respuesta: <b>${App.esc(q.given || '-')}</b></div>
        ${q.isCorrect ? '' : '<div class="a good">Correcta: <b>' + App.esc(q.correct) + '</b></div>'}
        ${q.explanation ? '<div class="ex">' + App.esc(q.explanation) + '</div>' : ''}
        <div class="sub">${App.esc(q.subtopicLabel)}</div>
      </li>`;
    }
    html += '</ol>';

    html += '<div class="cta">';
    if (r.passed) {
      html += data.nav.next
        ? `<a class="btn-primary" href="/lesson?topic=${data.nav.next.id}">${navLabel(data.nav.next)} &rarr;</a>`
        : '<a class="btn-primary" href="/">&larr; Indice del curso</a>';
    } else {
      html += '<button class="btn-primary" id="retry">Repasar fallos y reintentar</button>';
    }
    html += '<a class="btn-ghost" href="/">Indice del curso</a></div>';

    app.innerHTML = html;
    window.scrollTo(0, 0);
    const retry = document.getElementById('retry');
    if (retry) retry.onclick = renderLesson;
  }
})();
