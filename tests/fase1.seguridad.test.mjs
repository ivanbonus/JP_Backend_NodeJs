// Fase 1 — Verificación en dos pasos, cambio obligatorio de contraseña, sesiones y auditoría.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import {
    env, encenderBase, apagarBase, resetearBase, iniciarServidor, pedir,
    siguienteCodigo, secretos2FA, iniciarSesion,
} from './helpers.mjs';

process.env.DATABASE_URL = env.DATABASE_URL;
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();

const ADMIN = 'administrador';
let password = env.ADMIN_INITIAL_PASSWORD;
let servidor;
let secreto;          // secreto 2FA vigente
let codigosRecuperacion;

const ejecutarScript = (archivo) => execSync(`npx ts-node --transpile-only src/scripts/${archivo}`, {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, ENV_FILE: '.env.test', DATABASE_URL: env.DATABASE_URL },
    encoding: 'utf8',
});

before(async () => {
    await encenderBase();
    resetearBase();
    servidor = await iniciarServidor();
});

after(async () => {
    await prisma.$disconnect();
    servidor?.detener();
    await apagarBase();
});

test('administrador sin verificación en dos pasos: solo puede configurarla', async () => {
    const r = await pedir('POST', '/auth/login', { body: { email: ADMIN, password } });
    assert.equal(r.status, 200);
    assert.equal(r.data.seguridad.debeConfigurar2FA, true);
    const token = r.data.token;

    const bloqueado = await pedir('GET', '/clientes', { token });
    assert.equal(bloqueado.status, 403);
    assert.equal(bloqueado.data.codigo, 'CONFIGURAR_2FA');
    assert.equal((await pedir('GET', '/auth/me', { token })).status, 200);
});

test('activar la verificación: QR, código incorrecto rechazado, códigos de recuperación y secreto cifrado', async () => {
    const tokenPrevio = (await pedir('POST', '/auth/login', { body: { email: ADMIN, password } })).data.token;

    const ini = await pedir('POST', '/auth/2fa/iniciar', { token: tokenPrevio });
    assert.equal(ini.status, 200);
    assert.match(ini.data.qr, /^data:image\/png;base64,/);
    assert.match(ini.data.uri, /^otpauth:\/\/totp\//);
    secreto = ini.data.secreto.replace(/\s/g, '');
    assert.equal(secreto.length, 32);

    const mal = await pedir('POST', '/auth/2fa/activar', { token: tokenPrevio, body: { codigo: '000000' } });
    assert.equal(mal.status, 400);

    const ok = await pedir('POST', '/auth/2fa/activar', { token: tokenPrevio, body: { codigo: await siguienteCodigo(secreto) } });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    codigosRecuperacion = ok.data.codigosRecuperacion;
    assert.equal(codigosRecuperacion.length, 10);
    for (const c of codigosRecuperacion) assert.match(c, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    secretos2FA.set(ADMIN, secreto);

    // La sesión anterior (sin segundo factor) ya no sirve; la nueva sí
    assert.equal((await pedir('GET', '/clientes', { token: tokenPrevio })).status, 401);
    assert.equal((await pedir('GET', '/clientes', { token: ok.data.token })).status, 200);

    const sf = await prisma.segundoFactor.findUnique({ where: { cuenta: 'config' } });
    assert.ok(sf.activo);
    for (const h of sf.codigosRecuperacion) assert.match(h, /^\$2[aby]\$/);
    const disp = await prisma.dispositivoVerificacion.findFirst({ where: { cuenta: 'config', confirmado: true } });
    assert.equal(disp.nombre, 'Celular principal');
    assert.match(disp.secretoCifrado, /^v1:/);
    assert.ok(!disp.secretoCifrado.includes(secreto), 'el secreto no debe guardarse en claro');
});

test('con verificación activa, la contraseña sola no abre sesión', async () => {
    const r = await pedir('POST', '/auth/login', { body: { email: ADMIN, password } });
    assert.equal(r.status, 200);
    assert.equal(r.data.requiere2FA, true);
    assert.equal(r.data.token, undefined);
    assert.ok(r.data.desafio);

    const mal = await pedir('POST', '/auth/login/2fa', { body: { desafio: r.data.desafio, codigo: '123456' } });
    assert.equal(mal.status, 401);

    const codigo = await siguienteCodigo(secreto);
    const ok = await pedir('POST', '/auth/login/2fa', { body: { desafio: r.data.desafio, codigo } });
    assert.equal(ok.status, 200);
    assert.ok(ok.data.token);

    // El mismo código no se puede reutilizar
    const r2 = await pedir('POST', '/auth/login', { body: { email: ADMIN, password } });
    const repetido = await pedir('POST', '/auth/login/2fa', { body: { desafio: r2.data.desafio, codigo } });
    assert.equal(repetido.status, 401);
});

test('un desafío alterado o inventado se rechaza', async () => {
    const r = await pedir('POST', '/auth/login/2fa', { body: { desafio: 'abc.def.ghi', codigo: await siguienteCodigo(secreto) } });
    assert.equal(r.status, 401);
});

test('código de recuperación: sirve una sola vez', async () => {
    const usar = async () => {
        const r = await pedir('POST', '/auth/login', { body: { email: ADMIN, password } });
        return pedir('POST', '/auth/login/2fa', { body: { desafio: r.data.desafio, codigo: codigosRecuperacion[0].toLowerCase() } });
    };
    const primero = await usar();
    assert.equal(primero.status, 200);
    assert.equal(primero.data.codigosRecuperacionRestantes, 9);
    assert.equal((await usar()).status, 401);
});

test('regenerar códigos de recuperación invalida los anteriores', async () => {
    const token = await iniciarSesion(ADMIN, password);
    const sinCodigo = await pedir('POST', '/auth/2fa/codigos', { token, body: { codigo: '000000' } });
    assert.equal(sinCodigo.status, 400);
    const r = await pedir('POST', '/auth/2fa/codigos', { token, body: { codigo: await siguienteCodigo(secreto) } });
    assert.equal(r.status, 200);
    const viejo = codigosRecuperacion[1];
    codigosRecuperacion = r.data.codigosRecuperacion;
    const login = await pedir('POST', '/auth/login', { body: { email: ADMIN, password } });
    assert.equal((await pedir('POST', '/auth/login/2fa', { body: { desafio: login.data.desafio, codigo: viejo } })).status, 401);
});

/** Inicia sesión usando un celular concreto (su secreto) y devuelve la respuesta completa */
const entrarConCelular = async (sec) => {
    const login = await pedir('POST', '/auth/login', { body: { email: ADMIN, password } });
    return pedir('POST', '/auth/login/2fa', { body: { desafio: login.data.desafio, codigo: await siguienteCodigo(sec) } });
};

test('varios celulares: cada uno con nombre, todos generan códigos y se registra cuál se usó', async () => {
    const token = (await entrarConCelular(secreto)).data.token;

    // Agregar exige un código de un celular ya registrado y un nombre
    assert.equal((await pedir('POST', '/auth/2fa/iniciar', { token, body: { nombre: 'Celular de María' } })).status, 400);
    assert.equal((await pedir('POST', '/auth/2fa/iniciar', { token, body: { codigo: await siguienteCodigo(secreto) } })).status, 400);
    const repetido = await pedir('POST', '/auth/2fa/iniciar', { token, body: { nombre: 'celular principal', codigo: await siguienteCodigo(secreto) } });
    assert.equal(repetido.status, 400, 'no se permiten nombres repetidos');

    const ini = await pedir('POST', '/auth/2fa/iniciar', { token, body: { nombre: 'Celular de María', codigo: await siguienteCodigo(secreto) } });
    assert.equal(ini.status, 200, JSON.stringify(ini.data));
    const maria = ini.data.secreto.replace(/\s/g, '');
    assert.notEqual(maria, secreto, 'cada celular tiene su propia clave');

    // Sin confirmar, ese celular todavía no sirve
    assert.equal((await entrarConCelular(maria)).status, 401);
    const act = await pedir('POST', '/auth/2fa/activar', { token, body: { dispositivoId: ini.data.dispositivoId, codigo: await siguienteCodigo(maria) } });
    assert.equal(act.status, 200, JSON.stringify(act.data));
    assert.equal(act.data.codigosRecuperacion, undefined, 'agregar un celular no cambia los códigos de recuperación');

    // Los dos celulares funcionan
    assert.equal((await entrarConCelular(secreto)).status, 200);
    const conMaria = await entrarConCelular(maria);
    assert.equal(conMaria.status, 200);

    const estado = await pedir('GET', '/auth/2fa/estado', { token: conMaria.data.token });
    assert.deepEqual(estado.data.dispositivos.map(d => d.nombre), ['Celular principal', 'Celular de María']);
    assert.equal(estado.data.dispositivos.find(d => d.esteDispositivo)?.nombre, 'Celular de María');

    const reg = await prisma.dispositivoVerificacion.findMany({ where: { cuenta: 'config' } });
    for (const d of reg) assert.match(d.secretoCifrado, /^v1:/);
    globalThis.__maria = { secreto: maria, id: ini.data.dispositivoId, token: conMaria.data.token };
});

test('quitar un celular: deja de generar códigos, cierra sus sesiones y siempre queda al menos uno', async () => {
    const { secreto: maria, id, token: tokenMaria } = globalThis.__maria;
    const tokenPrincipal = (await entrarConCelular(secreto)).data.token;

    const sinCodigo = await pedir('POST', `/auth/2fa/dispositivos/${id}/eliminar`, { token: tokenPrincipal, body: { codigo: '000000' } });
    assert.equal(sinCodigo.status, 400);
    const ok = await pedir('POST', `/auth/2fa/dispositivos/${id}/eliminar`, { token: tokenPrincipal, body: { codigo: await siguienteCodigo(secreto) } });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));

    assert.equal((await entrarConCelular(maria)).status, 401, 'el celular quitado ya no sirve');
    assert.equal((await pedir('GET', '/clientes', { token: tokenMaria })).status, 401, 'la sesión abierta con ese celular se cierra');
    assert.equal((await pedir('GET', '/clientes', { token: tokenPrincipal })).status, 200, 'las demás sesiones siguen');

    const principal = (await prisma.dispositivoVerificacion.findFirst({ where: { cuenta: 'config', confirmado: true } })).id;
    const ultimo = await pedir('POST', `/auth/2fa/dispositivos/${principal}/eliminar`, { token: tokenPrincipal, body: { codigo: await siguienteCodigo(secreto) } });
    assert.equal(ultimo.status, 400, 'no se puede quitar el único celular');
});

test('máximo de 5 celulares', async () => {
    const token = (await entrarConCelular(secreto)).data.token;
    const extras = [];
    for (let i = 2; i <= 5; i++) {
        const ini = await pedir('POST', '/auth/2fa/iniciar', { token, body: { nombre: `Celular ${i}`, codigo: await siguienteCodigo(secreto) } });
        assert.equal(ini.status, 200, JSON.stringify(ini.data));
        const sec = ini.data.secreto.replace(/\s/g, '');
        const act = await pedir('POST', '/auth/2fa/activar', { token, body: { dispositivoId: ini.data.dispositivoId, codigo: await siguienteCodigo(sec) } });
        assert.equal(act.status, 200);
        extras.push(ini.data.dispositivoId);
    }
    const sexto = await pedir('POST', '/auth/2fa/iniciar', { token, body: { nombre: 'Celular 6', codigo: await siguienteCodigo(secreto) } });
    assert.equal(sexto.status, 400);
    // limpiar para las pruebas siguientes
    await prisma.dispositivoVerificacion.deleteMany({ where: { id: { in: extras } } });
});

test('contraseña generada por consola: obliga a cambiarla al entrar y cierra las demás sesiones', async () => {
    const tokenAbierto = await iniciarSesion(ADMIN, password);
    const salida = ejecutarScript('resetAdminPassword.ts');
    const temporal = salida.match(/Contraseña:\s+(\S+)/)[1];

    assert.equal((await pedir('GET', '/clientes', { token: tokenAbierto })).status, 401, 'las sesiones anteriores se cierran');

    const token = await iniciarSesion(ADMIN, temporal);
    const bloqueado = await pedir('GET', '/clientes', { token });
    assert.equal(bloqueado.status, 403);
    assert.equal(bloqueado.data.codigo, 'CAMBIAR_PASSWORD');

    const corta = await pedir('POST', '/auth/cambiar-password', { token, body: { actual: temporal, nueva: 'corta' } });
    assert.equal(corta.status, 400);
    const igual = await pedir('POST', '/auth/cambiar-password', { token, body: { actual: temporal, nueva: temporal } });
    assert.equal(igual.status, 400);

    password = 'tuerca-bahia-cedro-lince-48';
    const ok = await pedir('POST', '/auth/cambiar-password', { token, body: { actual: temporal, nueva: password } });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal(ok.data.seguridad.debeCambiarPassword, false);
    assert.equal((await pedir('GET', '/clientes', { token: ok.data.token })).status, 200, 'el token nuevo funciona');
    assert.equal((await pedir('GET', '/clientes', { token })).status, 401, 'el token anterior ya no');
});

test('restablecer la verificación por consola (celular perdido): hay que configurarla de nuevo', async () => {
    ejecutarScript('reset2FA.ts');
    const r = await pedir('POST', '/auth/login', { body: { email: ADMIN, password } });
    assert.equal(r.status, 200);
    assert.equal(r.data.requiere2FA, undefined);
    assert.equal(r.data.seguridad.debeConfigurar2FA, true);
    secretos2FA.delete(ADMIN);
    await iniciarSesion(ADMIN, password); // el helper la vuelve a configurar
});

test('auditoría: registra accesos y cambios, sin contraseñas, y solo la ve el administrador', async () => {
    const token = await iniciarSesion(ADMIN, password);
    await pedir('POST', '/auth/login', { body: { email: ADMIN, password: 'incorrecta-123' } });
    const cliente = await pedir('POST', '/clientes', { token, body: { nombre: 'Auditado', documento: '87654321', telefono: '999000111' } });
    assert.ok([200, 201].includes(cliente.status));
    await new Promise(r => setTimeout(r, 400));

    const r = await pedir('GET', '/auditoria?porPagina=100', { token });
    assert.equal(r.status, 200);
    const acciones = new Set(r.data.registros.map(x => x.accion));
    for (const a of ['LOGIN_OK', 'LOGIN_FALLIDO', 'LOGIN_2FA_FALLIDO', '2FA_ACTIVADO', '2FA_DISPOSITIVO_AGREGADO', '2FA_DISPOSITIVO_ELIMINADO', 'PASSWORD_CAMBIADA', 'PASSWORD_REGENERADA_CONSOLA', '2FA_RESTABLECIDO_CONSOLA', 'CREAR']) {
        assert.ok(acciones.has(a), `falta la acción ${a}`);
    }
    const creado = r.data.registros.find(x => x.accion === 'CREAR' && x.entidad === 'clientes');
    assert.equal(creado.cuenta !== 'anonimo', true);
    const todo = JSON.stringify(r.data.registros);
    assert.ok(!todo.includes(password), 'la auditoría no debe contener contraseñas');

    const sinSesion = await pedir('GET', '/auditoria');
    assert.equal(sinSesion.status, 401);
});

test('límite de intentos: tras demasiados códigos fallidos el servidor bloquea temporalmente', async () => {
    // En pruebas el límite es 10 × RATE_LIMIT_MULTIPLICADOR; en producción, 10 intentos cada 15 minutos
    const limite = 10 * (Number(env.RATE_LIMIT_MULTIPLICADOR) || 1);
    let bloqueado = false;
    for (let i = 0; i <= limite + 1 && !bloqueado; i++) {
        const r = await pedir('POST', '/auth/login/2fa', { body: { desafio: 'x', codigo: '000000' } });
        bloqueado = r.status === 429;
    }
    assert.ok(bloqueado, 'debería responder 429 al superar el límite');
});
