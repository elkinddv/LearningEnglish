// Pagina inicial: la ruta del curso (16 temas + 4 super examenes en 4 partes)
// + banner "continua aqui" + libro de registro.
(async function () {
  const app = document.getElementById('app');
  const ROMAN = ['I', 'II', 'III', 'IV'];
  let PASS = 80; // umbral de aprobado (se toma de la API en render)

  try {
    const c = await App.api('/api/course');
    document.title = c.title;
    render(c);
  } catch (e) {
    app.innerHTML = '<p class="error">' + App.esc(e.message) + '</p>';
  }

  function render(c) {
    PASS = c.passThreshold;
    // Estructura por partes, con la secuencia lineal (temas + super examen)
    const parts = c.levels.map((L, i) => {
      const seq = [
        ...L.topics.map((t) => ({ ...t, kind: 'topic' })),
        ...(L.superExam ? [{ ...L.superExam, kind: 'super' }] : [])
      ];
      return { idx: i, code: L.code, name: L.name, topics: L.topics, superExam: L.superExam || null, seq };
    });
    const seq = parts.flatMap((p) => p.seq);
    const allTopics = c.levels.flatMap((l) => l.topics);
    const passedTopics = allTopics.filter((t) => t.status === 'passed').length;
    const current = seq.find((s) => s.status === 'available') || null;
    const allDone = seq.length > 0 && seq.every((s) => s.status === 'passed');
    const currentPart = current ? parts.find((p) => p.seq.some((s) => s.id === current.id)) : null;

    let html = `
      <section class="hero">
        <p class="eyebrow">Gramatica inglesa &middot; niveles B1 a C2</p>
        <h1 class="hero-title">${App.esc(c.title)}</h1>
        <p class="hero-lead">16 temas en 4 partes. Cada tema se estudia y se aprueba con el
          ${c.passThreshold}&#8202;%; al final de cada parte, un super examen de 100 preguntas.</p>
        <div class="meter">
          <span class="meter-figure">${passedTopics} / ${allTopics.length}</span>
          <span class="meter-label">temas aprobados${currentPart ? ' &middot; vas por la Parte ' + ROMAN[currentPart.idx] : ''}</span>
          <span class="meter-track"><span style="width:${App.pct(passedTopics, allTopics.length)}%"></span></span>
        </div>
      </section>`;

    html += resumeBanner(current, currentPart, allDone);

    parts.forEach((p) => {
      html += `
        <section class="part">
          <p class="eyebrow">Parte ${ROMAN[p.idx]}${partStatus(p)}</p>
          <h2 class="part-title">${App.esc(p.code)} &mdash; ${App.esc(p.name)}</h2>
          <div class="part-rule"></div>
          <div class="chapters">
            ${p.topics.map((t) => chapter(t, current && current.kind === 'topic' && current.id === t.id)).join('')}
            ${p.superExam ? superRow(p.superExam, current && current.kind === 'super' && current.id === p.superExam.id) : ''}
          </div>
        </section>`;
    });

    if (c.stats.answered > 0) html += ledger(c.stats, c.subtopicLabels);

    html += `
      <section class="admin-row">
        <span class="admin-label">Zona de reinicio</span>
        <button id="resetAll" class="btn-danger">Reiniciar todo el curso</button>
      </section>`;

    app.innerHTML = html;

    document.getElementById('resetAll').onclick = async (ev) => {
      if (!confirm(
        'Esto borra TODO tu avance del curso: intentos, respuestas, temas y super examenes aprobados.\n' +
        'No se puede deshacer. Continuar?'
      )) return;
      ev.target.disabled = true;
      try {
        await App.api('/api/reset-all', { method: 'POST' });
        location.reload();
      } catch (e) {
        alert(e.message);
        ev.target.disabled = false;
      }
    };
  }

  function resumeBanner(current, part, allDone) {
    if (allDone) {
      return `
        <section class="resume resume-done">
          <p class="eyebrow">Curso completado</p>
          <p class="resume-msg">Has aprobado los 16 temas y los 4 super examenes. Enhorabuena.</p>
        </section>`;
    }
    if (!current) return '';
    const what = current.kind === 'super'
      ? '&#9733; ' + App.esc(current.title)
      : 'Tema ' + current.id + ' &middot; ' + App.esc(current.title);
    const done = current.kind === 'super'
      ? 'Ultimo paso de la parte'
      : (part.topics.filter((t) => t.status === 'passed').length) + ' de 4 temas de la parte';
    return `
      <a class="resume" href="/lesson?topic=${current.id}">
        <span class="resume-head">
          <span class="eyebrow" style="margin:0">Continua aqui &middot; Parte ${ROMAN[part.idx]} &middot; ${App.esc(part.code)}</span>
          <span class="resume-sub">${done}</span>
        </span>
        <span class="resume-what">${what}</span>
        <span class="resume-go">Continuar &#8594;</span>
      </a>`;
  }

  function partStatus(p) {
    const passed = p.topics.filter((t) => t.status === 'passed').length;
    const seLabel = !p.superExam ? ''
      : p.superExam.status === 'passed' ? ' &middot; super examen &#10003;'
      : p.superExam.status === 'available' ? ' &middot; super examen disponible'
      : '';
    if (passed === p.topics.length && p.superExam && p.superExam.status === 'passed') {
      return ' &middot; completada &#10003;';
    }
    return ` &middot; ${passed}/${p.topics.length} temas${seLabel}`;
  }

  function chapter(t, isCurrent) {
    const clickable = t.status === 'passed' || t.status === 'available';
    const no = String(t.id).padStart(2, '0');
    const mark = {
      passed: `<span class="mk mk-ok">&#10003; ${t.bestScore != null ? Math.round(t.bestScore) + '%' : 'hecho'}</span>`,
      available: '<span class="mk mk-go">Empezar &#8594;</span>',
      locked: '<span class="mk mk-wait">Bloqueado</span>',
      soon: '<span class="mk mk-wait">En preparacion</span>'
    }[t.status];

    const inner = `
      <span class="chapter-no">${no}</span>
      <span class="chapter-body">
        <span class="chapter-eyebrow">Tema ${t.id}${isCurrent ? ' &middot; <b>estas aqui</b>' : (t.attempts ? ' &middot; ' + t.attempts + ' intento(s)' : '')}</span>
        <span class="chapter-title">${App.esc(t.title)}</span>
        <span class="chapter-sub">${App.esc(t.subtitle)}</span>
      </span>
      ${mark}`;

    const cls = `chapter chapter-${t.status}${isCurrent ? ' chapter-current' : ''}`;
    return clickable
      ? `<a class="${cls}" href="/lesson?topic=${t.id}">${inner}</a>`
      : `<div class="${cls}">${inner}</div>`;
  }

  function superRow(se, isCurrent) {
    const clickable = se.status === 'passed' || se.status === 'available';
    const mark = {
      passed: `<span class="mk mk-ok">&#10003; ${se.bestScore != null ? Math.round(se.bestScore) + '%' : 'hecho'}</span>`,
      available: '<span class="mk mk-go">Empezar &#8594;</span>',
      locked: '<span class="mk mk-wait">Bloqueado</span>',
      soon: '<span class="mk mk-wait">En preparacion</span>'
    }[se.status];

    const inner = `
      <span class="chapter-no">&#9733;</span>
      <span class="chapter-body">
        <span class="chapter-eyebrow">Super examen${isCurrent ? ' &middot; <b>estas aqui</b>' : (se.attempts ? ' &middot; ' + se.attempts + ' intento(s)' : '')}</span>
        <span class="chapter-title">${App.esc(se.title)}</span>
        <span class="chapter-sub">${App.esc(se.subtitle)} &middot; hace falta el ${PASS}&#8202;% para pasar de nivel</span>
      </span>
      ${mark}`;

    const cls = `chapter chapter-super chapter-${se.status}${isCurrent ? ' chapter-current' : ''}`;
    return clickable
      ? `<a class="${cls}" href="/lesson?topic=${se.id}">${inner}</a>`
      : `<div class="${cls}">${inner}</div>`;
  }

  function ledger(s, labels) {
    const acc = App.pct(s.correct, s.answered);
    const rows = s.bySubtopic.map((r) => {
      const p = App.pct(r.correct, r.total);
      return `<li class="${p < PASS ? 'weak' : ''}">
        <span class="ldg-label">${App.esc(labels[r.subtopic] || r.subtopic)}</span>
        <span class="ldg-val">${r.correct}/${r.total} &middot; ${p}%</span>
      </li>`;
    }).join('');

    return `
      <section class="part">
        <p class="eyebrow">Libro de registro</p>
        <h2 class="part-title">Tu seguimiento</h2>
        <div class="part-rule"></div>
        <div class="figures">
          <div><b>${s.answered}</b><span>respuestas</span></div>
          <div><b>${s.correct}</b><span>aciertos</span></div>
          <div><b>${s.wrong}</b><span>errores</span></div>
          <div><b>${acc}%</b><span>precision</span></div>
          <div><b>${s.attempts}</b><span>evaluaciones</span></div>
        </div>
        <ul class="ledger">${rows}</ul>
      </section>`;
  }
})();
