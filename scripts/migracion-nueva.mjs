// Genera una migración SQL comparando las migraciones existentes con prisma/schema.prisma.
// Usa el PostgreSQL portátil como "shadow database" (no necesita Docker ni la base real).
// Uso: npm run migracion:nueva -- nombre_descriptivo
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT);

const nombre = (process.argv[2] || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_');
if (!nombre) {
    console.error('Indica un nombre: npm run migracion:nueva -- agregar_tabla_x');
    process.exit(1);
}

const h = await import(pathToFileURL(path.join(ROOT, 'tests', 'helpers.mjs')).href);
const { iniciarBaseLocal, detenerBaseLocal } = await import(pathToFileURL(path.join(ROOT, 'tests', 'db-local.mjs')).href);

// Base "shadow" temporal en el mismo PostgreSQL portátil
// Instancia propia (puerto 5434 y carpeta aparte) para no chocar con `npm run dev:pruebas` ni con las pruebas
const shadowUrl = new URL(h.env.DATABASE_URL);
shadowUrl.pathname = '/jp_shadow_migraciones';
shadowUrl.port = '5434';
await iniciarBaseLocal(shadowUrl.toString(), path.join(ROOT, '.pgdata-migraciones'));

try {
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const sql = execFileSync(npx, [
        'prisma', 'migrate', 'diff',
        '--from-migrations', 'prisma/migrations',
        '--to-schema-datamodel', 'prisma/schema.prisma',
        '--shadow-database-url', shadowUrl.toString(),
        '--script',
    ], { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' });

    if (!sql.trim() || /This is an empty migration/i.test(sql)) {
        console.log('El esquema ya coincide con las migraciones: no hay nada que generar.');
    } else {
        const d = new Date();
        const p = (n) => String(n).padStart(2, '0');
        const marca = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
        const carpeta = path.join(ROOT, 'prisma', 'migrations', `${marca}_${nombre}`);
        if (existsSync(carpeta)) throw new Error(`Ya existe ${carpeta}`);
        mkdirSync(carpeta, { recursive: true });
        writeFileSync(path.join(carpeta, 'migration.sql'), sql);
        console.log(`Migración creada: prisma/migrations/${marca}_${nombre}/migration.sql`);
    }
} finally {
    await detenerBaseLocal();
}
