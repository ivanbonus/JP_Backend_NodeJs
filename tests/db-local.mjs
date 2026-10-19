// PostgreSQL portátil para pruebas (paquete embedded-postgres).
// No necesita instalación, contraseña del sistema ni permisos de administrador.
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, '.pgdata-test');

let instancia = null;

/** Enciende el PostgreSQL portátil y crea la base indicada en DATABASE_URL si no existe. */
export const iniciarBaseLocal = async (databaseUrl, dataDir = DATA_DIR) => {
    const url = new URL(databaseUrl);
    const nombreBase = url.pathname.replace(/^\//, '');

    instancia = new EmbeddedPostgres({
        databaseDir: dataDir,
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        port: Number(url.port),
        persistent: true,
        // Igual que producción (Neon): UTF-8, sin depender del idioma de Windows
        initdbFlags: ['--encoding=UTF8', '--locale=C'],
        onLog: () => {},
        onError: () => {},
    });

    if (!existsSync(path.join(dataDir, 'PG_VERSION'))) {
        await instancia.initialise();
    }
    await instancia.start();

    const cliente = instancia.getPgClient();
    await cliente.connect();
    const existe = await cliente.query('SELECT 1 FROM pg_database WHERE datname = $1', [nombreBase]);
    await cliente.end();
    if (existe.rowCount === 0) await instancia.createDatabase(nombreBase);
};

export const detenerBaseLocal = async () => {
    if (instancia) {
        await instancia.stop();
        instancia = null;
    }
};
