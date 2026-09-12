// test/helpers.js — arranca la app en un puerto efimero para pruebas de integracion.
import { unlinkSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function testDbPath(name) {
  return path.join(__dirname, `${name}.test.db`);
}

// Llamar SIEMPRE antes de importar '../server.js' (que abre la conexion sqlite),
// nunca despues de stopTestServer(): en Windows el archivo .db sigue bloqueado
// mientras el proceso vive, y borrarlo a mitad de proceso lanza EBUSY. Como cada
// archivo de test corre en su propio proceso (comportamiento por defecto de
// `node --test`), el archivo se libera solo al terminar ese proceso, y esta misma
// llamada de "limpieza previa" se encarga de borrar lo que haya dejado la corrida
// anterior antes de la siguiente.
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

// Solo cierra el servidor HTTP, no la conexion sqlite (que es un singleton de
// modulo compartido entre todos los test() de un mismo archivo) — cerrar la
// conexion aqui rompería cualquier test() posterior en el mismo archivo.
export function stopTestServer(server) {
  return new Promise((resolve) => server.close(resolve));
}
