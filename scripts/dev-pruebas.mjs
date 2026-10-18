// Entorno de PRUEBAS local: PostgreSQL portátil + backend con .env.test.
// La base se reinicia en cada arranque y se crean usuarios de prueba con claves conocidas.
// Uso: npm run dev:pruebas   (detener con Ctrl+C)
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT);

const h = await import(pathToFileURL(path.join(ROOT, 'tests', 'helpers.mjs')).href);
process.env.DATABASE_URL = h.env.DATABASE_URL;

console.log('Encendiendo PostgreSQL portátil…');
await h.encenderBase();
console.log('Reiniciando la base de pruebas…');
h.resetearBase();

console.log('Arrancando el backend…');
const servidor = await h.iniciarServidor();

console.log(`
╔════════════════════════════════════════════════════════════════╗
  ENTORNO DE PRUEBAS LISTO  (backend: ${h.BASE})
  Solo datos de prueba. La web real NO se toca.
╠════════════════════════════════════════════════════════════════╣
  Usuario:     administrador
  Contraseña:  ${h.env.ADMIN_INITIAL_PASSWORD}
  Al entrar se te pedirá activar la verificación en dos pasos
  (escanea el QR con Google o Microsoft Authenticator).
╚════════════════════════════════════════════════════════════════╝
  En otra terminal, en D:\\JP_Frontend_React:  npm run dev:pruebas
  Para detener: Ctrl+C
`);

const salir = async () => {
    servidor.detener();
    await h.apagarBase();
    process.exit(0);
};
process.on('SIGINT', salir);
process.on('SIGTERM', salir);
setInterval(() => {}, 1 << 30);
