# Rediseño del curso: Módulos con subtemas, bancos de 50 y examen de módulo de 60

Fecha: 2026-09-12
Proyecto: `E:\LearningEnglish` (Node + Express + `node:sqlite`)
Estado: aprobado en brainstorming, pendiente de plan de implementación

## 1. Contexto y objetivo

El sitio actual (`ver README.md`) tiene 16 **temas** agrupados en 4 niveles (B1-C2). Cada
tema ya contiene "subtemas" como etiqueta (p. ej. `present-simple-usos`,
`present-continuous-forma`) usados solo para clasificar preguntas y detectar puntos
débiles, pero:

- Comparten un único banco de ~100 preguntas por tema completo (no 50 por subtema).
- El examen de tema es de 20 preguntas; no hay unidad de aprendizaje al nivel de
  subtema con su propio quiz y bloqueo.
- Los "súper exámenes" de 100 preguntas ya existen, pero son de fin de **nivel**
  (B1/B2/C1/C2), no de fin de módulo.
- Los tipos de pregunta son solo `mcq` y `gap`.

**Objetivo:** convertir cada subtema en una unidad de aprendizaje completa
(explicación + ejemplos + banco propio de 50 preguntas + quiz corto de progresión),
y cada módulo (el actual "tema") termina con un examen de 60 preguntas que
desbloquea el siguiente módulo — todo con estilo y variedad de pregunta más cercana
a un examen real MCER/Cambridge.

## 2. Decisiones tomadas (brainstorming)

| Decisión | Elegido |
|---|---|
| Gating de subtemas | Quiz por subtema **sí bloquea** el avance al siguiente subtema dentro del módulo |
| Tamaño / umbral quiz de subtema | 15 preguntas de las 50 del banco, **80%** para aprobar |
| Tamaño / umbral examen de módulo | 60 preguntas (estratificadas entre subtemas), **80%** para aprobar |
| Progreso actual (`progreso.db`) | Se **resetea por completo** en este cambio (autorización explícita del usuario; hacer backup del archivo antes de borrar) |
| Libros escaneados sin texto (Swan, *In the Shadow of the Mountain*, *A Dangerous Sky*, *English Grammar Guide*) | Solo se hace **OCR del libro de Swan** (Oxford Practical English Usage); los otros tres se omiten como fuente |
| Tipos de pregunta | Se amplía de 2 a 4: `mcq`, `gap`, `key-word-transformation`, `error-correction` |

## 3. Inventario de fuentes de contenido

| Archivo | Estado | Uso previsto |
|---|---|---|
| `Advanced English Grammar` (Wendy Wilson, 2020) | Texto real extraído (313 KB en `.md`) | Fuente principal de reglas gramaticales |
| `Oxford Practical English Usage` (Swan, 3ª ed.) | **PDF escaneado sin capa de texto** (0 bytes en `.md`; `pdftotext` confirma ausencia de `/Font`, solo `/Image`) | Requiere OCR (ver §7) antes de poder usarse; es la referencia más completa para C1/C2 |
| `John Doe` (Cambridge Readers, Level 1) | Texto real (26 KB) | Frases/contextos auténticos de nivel básico para ejemplos y preguntas de comprensión |
| `Jojo's Story` (Cambridge Readers, Level 2) | Texto real (52 KB) | Igual que arriba, nivel algo más alto; temática sensible (conflicto armado) — usar con criterio si se citan pasajes |
| `The Fruitcake Special and Other Stories` | Texto real (103 KB) | Relatos cortos variados, buena fuente de frases naturales para gap-fill y transformación |
| `In the Shadow of the Mountain` | PDF escaneado sin texto | **Omitido** en este proyecto |
| `A Dangerous Sky` (Level 6) | PDF escaneado sin texto | **Omitido** en este proyecto |
| `English Grammar Guide` (Twin) | PDF escaneado sin texto; el `.md` solo trae la tabla de contenidos | **Omitido** en este proyecto |
| Búsqueda en internet | — | Verificar reglas, terminología y estilo real de examen (British Council, Cambridge Assessment English, EF) para cada subtema, y para redactar `key-word-transformation`/`error-correction` con el formato auténtico de Cambridge |

Nota de derechos de autor: los Cambridge Readers y Swan son obras con copyright.
Se usan como **inspiración de contexto y estilo** (vocabulario, estructuras,
situaciones) para escribir preguntas y ejemplos originales — nunca se debe copiar
literalmente un pasaje extenso ni republicar el texto del libro dentro del
contenido del curso.

## 4. Modelo de datos

### 4.1 `content/course.json`

Se mantiene la forma general (niveles, súper exámenes) y se añaden los nuevos
tamaños/umbrales:

```json
{
  "passThresholdSubtopic": 80,
  "passThresholdModule": 80,
  "subtopicQuizSize": 15,
  "subtopicBankSize": 50,
  "moduleExamSize": 60,
  "superExamSize": 100
}
```

`subtopicLabels` (hoy un diccionario plano slug → texto) deja de ser la única
fuente de verdad: cada `topic-XX.json` declara sus subtemas como objetos propios
(ver 4.2), y `subtopicLabels` puede quedar como índice derivado para
retrocompatibilidad de las etiquetas ya usadas en la UI de progreso.

### 4.2 `content/topic-XX.json` (módulo)

```jsonc
{
  "id": 1,
  "slug": "presentes-aspecto",
  "level": "B1",
  "title": "Tiempos presentes y aspecto verbal",
  "subtopics": [
    {
      "slug": "present-simple-usos",
      "title": "Present Simple - usos",
      "lesson": { "heading": "...", "body": "...", "examples": ["..."] },
      "questionBank": [ /* 50 preguntas, mezcla de los 4 tipos */ ]
    },
    { "slug": "present-simple-forma", "...": "..." }
    // resto de subtemas del módulo
  ],
  "moduleExam": {
    "strategy": "stratified",
    "size": 60
    // las preguntas se muestrean en runtime de los questionBank de cada subtopic,
    // no se duplica contenido en un banco aparte
  }
}
```

Cada pregunta gana un campo `type`: `"mcq" | "gap" | "key-word-transformation" |
"error-correction"`, y para `key-word-transformation` se guarda la palabra clave
obligatoria y la(s) forma(s) aceptada(s) de la reescritura (normalizadas para
comparar sin distinguir mayúsculas/espacios extra).

### 4.3 Base de datos (`db.js`)

Tablas nuevas/ajustadas:

- `subtopic_progress(user, module_id, subtopic_slug, status, best_score, attempts)`
- `subtopic_attempts` / `subtopic_answers` — igual que las de módulo actuales pero a nivel subtema, para mantener el "repaso enfocado" ya existente.
- Las tablas de módulo y nivel se mantienen, solo cambia el tamaño de examen (60) y de dónde se muestrean las preguntas (todos los `questionBank` de los subtemas en vez de un banco plano de tema).

**Migración:** no aplica — se resetea `progreso.db` (con backup previo del
archivo, p. ej. `progreso.pre-modulos.db`, por si se necesita auditar algo).

## 5. Motor de progresión (gating)

```
Módulo N
├─ Subtema 1: lección → quiz (15 preg., ≥80%) ──► desbloquea Subtema 2
├─ Subtema 2: lección → quiz (15 preg., ≥80%) ──► desbloquea Subtema 3
├─ ...
└─ Todos los subtemas aprobados ──► Examen de módulo (60 preg. estratificadas, ≥80%)
                                      ├─ Aprueba ──► desbloquea Módulo N+1
                                      └─ No aprueba ──► "repaso enfocado" (subtemas/preguntas falladas) y nuevo intento
```

Reglas a conservar del sistema actual: cada pregunta lleva su `subtopic` oculto
(ya no hace falta ocultarlo del lado de datos, pero sí de la UI de examen); el
reintento reordena preguntas priorizando lo fallado; no se muestra el resultado
por subtema hasta la revisión final.

## 6. Tipos de pregunta y motor de calificación

| Tipo | Ya existe | Cambio necesario |
|---|---|---|
| `mcq` | Sí | Ninguno |
| `gap` | Sí | Ninguno (comparación de texto exacto/normalizado) |
| `key-word-transformation` | No | Nuevo componente de UI (frase original + palabra clave fija + input de reescritura) y comparación contra una lista de variantes aceptadas, normalizando espacios/mayúsculas/contracciones |
| `error-correction` | No | Nuevo componente de UI (frase con un tramo resaltable/seleccionable o un `<select>` de opción de error) y verificación de que se identificó el tramo correcto |

Se recomienda que cada banco de 50 preguntas de un subtema tenga una mezcla
aproximada (ajustable por subtema según qué tan bien encaje el tipo): ~40% mcq,
~30% gap, ~15% key-word-transformation, ~15% error-correction.

## 7. OCR del libro de Swan

1. Instalar Tesseract OCR en la máquina (Windows: `choco install tesseract` o
   instalador oficial de UB-Mannheim) + idioma inglés (`eng.traineddata`, viene
   por defecto).
2. Convertir cada página del PDF a imagen (`pdftoppm -r 300`, ya se confirmó que
   viene con Git for Windows) y pasar `tesseract` sobre cada imagen.
3. Concatenar el texto por página, revisar manualmente las secciones que se vayan
   a usar como fuente de reglas (el reconocimiento de tablas y cursivas de un
   libro de gramática antiguo puede fallar; no confiar en el texto crudo para
   ejemplos citados literalmente, sí para orientar qué reglas cubrir).
4. Guardar el resultado como referencia interna (no como contenido publicado del
   curso — ver nota de copyright en §3).

## 8. Plan de contenido por fases (evita generar los ~6,400 ítems de una sola vez)

1. **Piloto:** un solo módulo completo (propuesto: Módulo 1, "Tiempos presentes y
   aspecto verbal", 8 subtemas) con lecciones + 50 preguntas por subtema + examen
   de módulo de 60. Se entrega para tu revisión de tono/nivel/dificultad antes de
   continuar.
2. **Nivel B1** (Módulos 1-4) completo.
3. **Nivel B2** (Módulos 5-8).
4. **Nivel C1** (Módulos 9-12).
5. **Nivel C2** (Módulos 13-16), donde más se necesita el OCR de Swan para el
   nivel de detalle (subjuntivo, clefts, inversión, registro formal).

## 9. Fuera de alcance (explícito)

- No se tocan los súper exámenes de nivel (100 preguntas) más allá de que ahora
  muestrean de bancos de subtema en vez de bancos de tema — su tamaño y umbral no
  cambian.
- No se migra progreso existente (decisión: reset total).
- No se hace OCR de *In the Shadow of the Mountain*, *A Dangerous Sky* ni
  *English Grammar Guide*.
- No se rediseña la identidad visual del sitio; los cambios de UI son los
  mínimos para navegar subtemas y soportar los 2 tipos de pregunta nuevos.

## 10. Huecos y riesgos identificados (lo que pediste que señalara)

1. **Volumen de contenido subestimado a mano:** ~128 subtemas × 50 preguntas =
   ~6,400 preguntas + ~128 lecciones. Aun con generación asistida, revisar todo
   con calidad de examen real es la parte más costosa del proyecto, no el código.
   El plan por fases (§8) existe justo para no descubrir esto a mitad de camino.
2. **Motor de calificación de `key-word-transformation`:** el examen real de
   Cambridge acepta varias reescrituras válidas para una misma respuesta; hace
   falta una lista de variantes aceptadas por pregunta (no un único string), y
   normalizar contracciones (`don't`/`do not`), mayúsculas y espacios — si no,
   se rechazarán respuestas correctas.
3. **`error-correction` necesita una interacción de UI que hoy no existe**
   (seleccionar un tramo de texto o elegir entre opciones resaltadas), no es solo
   una pregunta de texto libre.
4. **Calidad del OCR de Swan es incierta hasta probarla:** libros de gramática
   antiguos con tablas, cursivas y símbolos fonéticos suelen dar peor resultado
   de OCR que texto corrido; puede que solo sirva como guía de qué reglas cubrir,
   no como fuente citable.
5. **Contenido sensible en *Jojo's Story***: trata sobre un conflicto armado y
   violencia hacia una familia. Si se usa como fuente de contexto/vocabulario
   para preguntas, conviene evitar tomar las escenas más duras como base de
   ejemplos, sobre todo si el sitio lo usará también un adolescente u otro
   estudiante más joven — a confirmar si aplica.
6. **No hay política de "examen real MCER" formalizada:** pediste que las
   preguntas se sientan como un examen real MCER, pero no se definió *para qué
   examen específico* (PET/First/Advanced/Proficiency) calibrar cada nivel; el
   plan asume la equivalencia CEFR estándar (B1≈PET, B2≈First, C1≈Advanced,
   C2≈Proficiency) salvo que prefieras otra referencia.
7. **No hay mecanismo de control de calidad automatizado** (p. ej. detectar
   preguntas duplicadas o ambiguas dentro de un banco de 50) — queda como
   revisión manual en cada fase del plan de contenido.
8. **Tiempo real de estudio no estimado:** con quiz de subtema + examen de
   módulo + súper examen de nivel, el curso se vuelve bastante más largo que
   hoy; no se ha estimado cuántas horas añade esto al recorrido completo B1→C2.
9. **Sin definir:** si el quiz de subtema y el examen de módulo deben evitar
   repetir exactamente las mismas preguntas entre sí (para que aprobar el quiz no
   "regale" respuestas del examen final).

## 11. Siguiente paso

Este documento es la base para un plan de implementación por fases (empezando
por el piloto del Módulo 1). El siguiente paso natural es invocar el flujo de
`writing-plans` sobre este spec para producir un plan detallado y ejecutable.
