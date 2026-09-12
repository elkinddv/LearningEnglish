# Ruta de Ingles (B1 - C2)

Sitio personal para aprender ingles: cada tema se **explica**, se **evalua** con 20 preguntas
tomadas de un banco de 100, y no se desbloquea el siguiente hasta **aprobar con el 90%**.
Todo el progreso (preguntas respondidas, aciertos y errores por subtema) se guarda en **SQLite**.

## Requisitos

- Node.js 22.5 o superior (usa el modulo integrado `node:sqlite`, sin dependencias nativas).
  Probado con Node 24.

## Arranque

```bash
npm install
npm start
```

Luego abre:

- En este equipo: `http://localhost:3000`
- En el movil o tablet (misma red Wi-Fi): `http://<IP-de-tu-PC>:3000`
  (la consola muestra la IP al arrancar; en Windows tambien con `ipconfig`).

Si Windows pregunta por el Firewall, permite Node en **redes privadas**.

Cambiar el puerto: `PORT=4000 npm start` (en PowerShell: `$env:PORT=4000; npm start`).

## Como funciona

- **`/`** - Ruta del curso: 16 temas en 4 niveles (B1, B2, C1, C2).
  Estados: aprobado / disponible / bloqueado / en preparacion.
- **`/lesson?topic=N`** - Leccion navegable (anterior / siguiente entre temas aprobados)
  y boton para empezar la evaluacion.
- Evaluacion: 20 preguntas al azar del banco (al menos una por subtema).
  En un reintento, refuerza los subtemas fallados.
- Cada pregunta lleva un `subtopic` **oculto** (tema-subtema): permite ver
  exactamente en que falla el usuario. Se muestra solo en la revision.
- < 90 %: no se avanza. Se marca el "Repaso enfocado" con los subtemas y las
  preguntas falladas, y se genera una nueva evaluacion.

## Estructura

```
server.js              Express + API
db.js                  Esquema y consultas SQLite (node:sqlite)
content/course.json    Los 16 temas, niveles y etiquetas de subtemas
content/topic-01.json  Leccion + banco de 100 preguntas del tema 1
public/                index.html (ruta), lesson.html (tema), css, js
progreso.db            Base de datos (se crea sola; ignorada por git)
```

## Anadir el siguiente tema

Crear `content/topic-02.json` con la misma forma que `topic-01.json`
(`lesson` + `questions` con `subtopic`, `type` "mcq" o "gap"). El servidor lo
detecta al reiniciar y lo marca como disponible cuando el tema 1 este aprobado.

## Reiniciar el progreso

`POST /api/reset-all` (borra intentos, respuestas y progreso). Tambien puedes
borrar el archivo `progreso.db`.
