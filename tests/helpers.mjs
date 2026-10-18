// Utilidades para pruebas de integración contra una base de datos LOCAL.
import { spawn, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { iniciarBaseLocal, detenerBaseLocal } from './db-local.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = process.env.ENV_FILE || '.env.test';

/** Lee el archivo .env.test sin depender de librerías */
export const leerEnv = () => {
    const contenido = readFileSync(path.join(ROOT, ENV_FILE), 'utf8');
    const env = {};
    for (const linea of contenido.split(/\r?\n/)) {
        const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return env;
};

export const env = leerEnv();
export const BASE = `http://localhost:${env.PORT || 3100}/api`;

/** Protección: jamás ejecutar pruebas contra una base que no sea local */
const assertBaseLocal = () => {
    const url = env.DATABASE_URL || '';
    let host = '';
    try { host = new URL(url).hostname; } catch { /* inválida */ }
    if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
        throw new Error(`Las pruebas solo se ejecutan contra una base LOCAL. Host recibido: "${host || 'desconocido'}"`);
    }
    if (url.includes('TU_CLAVE_POSTGRES')) {
        throw new Error('Configura la contraseña de PostgreSQL local en .env.test antes de ejecutar las pruebas.');
    }
};

/** Enciende el PostgreSQL portátil (puerto de .env.test) */
export const encenderBase = async () => {
    assertBaseLocal();
    await iniciarBaseLocal(env.DATABASE_URL);
};
export const apagarBase = () => detenerBaseLocal();

/** Recrea el esquema de la base de pruebas desde cero */
export const resetearBase = () => {
    assertBaseLocal();
    execSync('npx prisma migrate reset --force --skip-seed --skip-generate', {
        cwd: ROOT,
        env: { ...process.env, DATABASE_URL: env.DATABASE_URL },
        stdio: 'pipe',
    });
};

/** Arranca el servidor con .env.test y espera a que responda */
export const iniciarServidor = async () => {
    assertBaseLocal();
    // Si ya hay algo escuchando en el puerto (p. ej. `npm run dev:pruebas` encendido), las pruebas
    // terminarían usando ese servidor con otros datos: mejor detenerse con un aviso claro.
    try {
        await fetch(BASE.replace(/\/api$/, '/'), { signal: AbortSignal.timeout(1500) });
        throw new Error(`El puerto ${env.PORT || 3100} ya está en uso. Detén "npm run dev:pruebas" u otro servidor antes de ejecutar las pruebas.`);
    } catch (e) {
        if (e instanceof Error && e.message.startsWith('El puerto')) throw e;
        /* puerto libre: continuar */
    }
    const proceso = spawn('npx', ['ts-node', '--transpile-only', 'src/index.ts'], {
        cwd: ROOT,
        env: { ...process.env, ENV_FILE, NODE_ENV: 'test', DATABASE_URL: env.DATABASE_URL },
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    proceso.stdout.on('data', d => { log += d; });
    proceso.stderr.on('data', d => { log += d; });

    for (let i = 0; i < 120; i++) {
        try {
            const r = await fetch(BASE.replace(/\/api$/, '/'));
            if (r.ok) {
                // Esperar a que initAdmin termine de crear la configuración
                await new Promise(r => setTimeout(r, 1500));
                return { detener: () => detener(proceso), log: () => log };
            }
        } catch { /* aún no arranca */ }
        await new Promise(r => setTimeout(r, 500));
    }
    detener(proceso);
    throw new Error('El servidor no arrancó:\n' + log);
};

const detener = (proceso) => {
    if (process.platform === 'win32') {
        try { execSync(`taskkill /pid ${proceso.pid} /T /F`, { stdio: 'ignore' }); } catch { /* ya terminó */ }
    } else {
        proceso.kill('SIGTERM');
    }
};

/** Petición JSON con token opcional */
export const pedir = async (metodo, ruta, { token, body } = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(BASE + ruta, { method: metodo, headers, body: body ? JSON.stringify(body) : undefined });
    let data = null;
    const tipo = r.headers.get('content-type') || '';
    if (tipo.includes('application/json')) data = await r.json();
    return { status: r.status, data, headers: r.headers };
};

// ==========================================
// TOTP (lo que haría la app del celular)
// ==========================================
import crypto from 'node:crypto';

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const base32 = (texto) => {
    let bits = 0, valor = 0;
    const bytes = [];
    for (const c of texto.toUpperCase().replace(/[^A-Z2-7]/g, '')) {
        valor = (valor << 5) | ALFABETO.indexOf(c);
        bits += 5;
        if (bits >= 8) { bytes.push((valor >>> (bits - 8)) & 255); bits -= 8; }
    }
    return Buffer.from(bytes);
};
export const codigoTotp = (secreto, paso) => {
    const msg = Buffer.alloc(8);
    msg.writeBigUInt64BE(BigInt(paso));
    const h = crypto.createHmac('sha1', base32(secreto)).update(msg).digest();
    const o = h[h.length - 1] & 15;
    return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
};

// El servidor no acepta dos veces el mismo intervalo: se usa el siguiente disponible (±30 s permitidos)
const ultimoPaso = new Map();
export const siguienteCodigo = async (secreto) => {
    for (;;) {
        const actual = Math.floor(Date.now() / 30000);
        const usado = ultimoPaso.get(secreto) ?? -Infinity;
        const paso = Math.max(actual, usado + 1);
        if (paso <= actual + 1) {
            ultimoPaso.set(secreto, paso);
            return codigoTotp(secreto, paso);
        }
        await new Promise(r => setTimeout(r, 1000));
    }
};

/** Secretos 2FA configurados durante las pruebas, por usuario de login */
export const secretos2FA = new Map();

/**
 * Inicio de sesión completo como lo haría el administrador:
 * contraseña → (código 2FA si está activo) → configura 2FA si es obligatorio y falta.
 */
export const iniciarSesion = async (email, password) => {
    const r = await pedir('POST', '/auth/login', { body: { email, password } });
    if (r.status !== 200) throw new Error(`Login falló para ${email}: ${r.status} ${JSON.stringify(r.data)}`);

    let datos = r.data;
    if (datos.requiere2FA) {
        const secreto = secretos2FA.get(email);
        if (!secreto) throw new Error(`No se conoce el secreto 2FA de ${email}`);
        const r2 = await pedir('POST', '/auth/login/2fa', { body: { desafio: datos.desafio, codigo: await siguienteCodigo(secreto) } });
        if (r2.status !== 200) throw new Error(`Código 2FA rechazado para ${email}: ${r2.status} ${JSON.stringify(r2.data)}`);
        datos = r2.data;
    }

    if (datos.seguridad?.debeConfigurar2FA && !datos.seguridad?.debeCambiarPassword) {
        datos = await configurar2FA(email, datos.token);
    }
    return datos.token;
};

/** Configura la verificación en dos pasos y devuelve la respuesta de activación (token nuevo + códigos). */
export const configurar2FA = async (email, token) => {
    const ini = await pedir('POST', '/auth/2fa/iniciar', { token });
    if (ini.status !== 200) throw new Error(`No se pudo iniciar 2FA: ${ini.status} ${JSON.stringify(ini.data)}`);
    const secreto = ini.data.secreto.replace(/\s/g, '');
    const act = await pedir('POST', '/auth/2fa/activar', { token, body: { codigo: await siguienteCodigo(secreto) } });
    if (act.status !== 200) throw new Error(`No se pudo activar 2FA: ${act.status} ${JSON.stringify(act.data)}`);
    secretos2FA.set(email, secreto);
    return act.data;
};
