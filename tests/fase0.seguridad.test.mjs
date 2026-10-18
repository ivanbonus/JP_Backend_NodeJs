// Fase 0 — Seguridad: autenticación, permisos por rol y endpoints públicos.
// Ejecutar: npm run test:fase0   (usa .env.test y una base LOCAL que se reinicia)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { env, encenderBase, apagarBase, resetearBase, iniciarServidor, pedir, iniciarSesion } from './helpers.mjs';

process.env.DATABASE_URL = env.DATABASE_URL;
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();

let servidor;
const tokens = {};
const ADMIN = { usuario: 'administrador', password: env.ADMIN_INITIAL_PASSWORD };

before(async () => {
    await encenderBase();
    resetearBase();
    servidor = await iniciarServidor();
    tokens.admin = await iniciarSesion(ADMIN.usuario, ADMIN.password);

    for (const [clave, rol] of [['operador', 'OPERADOR'], ['contabilidad', 'CONTABILIDAD']]) {
        const r = await pedir('POST', '/usuarios', {
            token: tokens.admin,
            body: { nombre: `Prueba ${rol}`, email: `${clave}@prueba.local`, password: 'ClaveSegura2026', rol },
        });
        assert.equal(r.status, 201, JSON.stringify(r.data));
        tokens[clave] = await iniciarSesion(`${clave}@prueba.local`, 'ClaveSegura2026');
    }

    const reg = await pedir('POST', '/auth/register', { body: { nombre: 'Cliente Web', email: 'cliente@prueba.local', password: 'ClaveSegura2026' } });
    assert.equal(reg.status, 201, JSON.stringify(reg.data));
    tokens.cliente = reg.data.token;
});

after(async () => {
    await prisma.$disconnect();
    servidor?.detener();
    await apagarBase();
});

test('sin sesión, las rutas del panel responden 401', async () => {
    for (const ruta of ['/clientes', '/finanzas/transacciones', '/dashboard', '/inventario', '/taller/guias', '/configuracion', '/personal', '/usuarios', '/cotizaciones', '/web/admin/novedades', '/web/reclamaciones']) {
        const r = await pedir('GET', ruta);
        assert.equal(r.status, 401, `GET ${ruta} debería ser 401 y fue ${r.status}`);
    }
});

test('un token alterado se rechaza', async () => {
    const alterado = tokens.admin.slice(0, -4) + 'abcd';
    const r = await pedir('GET', '/clientes', { token: alterado });
    assert.equal(r.status, 401);
});

test('el endpoint de borrado masivo ya no existe', async () => {
    const r = await pedir('DELETE', '/admin/limpiar-todo');
    assert.ok([401, 404].includes(r.status), `respondió ${r.status}`);
    assert.ok((await prisma.configuracion.count()) === 1);
});

test('la configuración nunca devuelve la contraseña', async () => {
    const r = await pedir('GET', '/configuracion', { token: tokens.admin });
    assert.equal(r.status, 200);
    assert.equal(r.data.password, undefined);
});

test('las contraseñas se guardan cifradas (bcrypt)', async () => {
    const config = await prisma.configuracion.findFirst();
    assert.match(config.password, /^\$2[aby]\$/);
    const usuarios = await prisma.usuario.findMany({ where: { password: { not: null } } });
    assert.ok(usuarios.length >= 3);
    for (const u of usuarios) assert.match(u.password, /^\$2[aby]\$/, `${u.email} sin cifrar`);
});

test('una contraseña antigua en texto plano sigue funcionando y se cifra al iniciar sesión', async () => {
    await prisma.usuario.create({ data: { nombre: 'Legacy', email: 'legacy@prueba.local', password: 'TextoPlano1', rol: 'OPERADOR' } });
    await iniciarSesion('legacy@prueba.local', 'TextoPlano1');
    const u = await prisma.usuario.findUnique({ where: { email: 'legacy@prueba.local' } });
    assert.match(u.password, /^\$2[aby]\$/);
    const mal = await pedir('POST', '/auth/login', { body: { email: 'legacy@prueba.local', password: 'otra' } });
    assert.equal(mal.status, 401);
});

test('cambio de contraseña del administrador exige la actual y la guarda cifrada', async () => {
    const mal = await pedir('PUT', '/configuracion', { token: tokens.admin, body: { passwordActual: 'incorrecta', nuevaPassword: 'NuevaClave123' } });
    assert.equal(mal.status, 400);
    const debil = await pedir('PUT', '/configuracion', { token: tokens.admin, body: { passwordActual: ADMIN.password, nuevaPassword: 'corta' } });
    assert.equal(debil.status, 400);
    const ok = await pedir('PUT', '/configuracion', { token: tokens.admin, body: { passwordActual: ADMIN.password, nuevaPassword: 'NuevaClave123' } });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    // Cambiar la contraseña cierra las sesiones abiertas
    assert.equal((await pedir('GET', '/clientes', { token: tokens.admin })).status, 401);
    const tokenNuevo = await iniciarSesion(ADMIN.usuario, 'NuevaClave123');
    // restaurar
    const rest = await pedir('PUT', '/configuracion', { token: tokenNuevo, body: { passwordActual: 'NuevaClave123', nuevaPassword: ADMIN.password } });
    assert.equal(rest.status, 200, JSON.stringify(rest.data));
    tokens.admin = await iniciarSesion(ADMIN.usuario, ADMIN.password);
});

test('ADMIN: acceso completo', async () => {
    for (const ruta of ['/clientes', '/personal', '/configuracion', '/usuarios', '/dashboard', '/finanzas/transacciones']) {
        const r = await pedir('GET', ruta, { token: tokens.admin });
        assert.equal(r.status, 200, `GET ${ruta}: ${r.status}`);
    }
});

test('OPERADOR: opera pero no elimina, no anula ni accede a personal/configuración', async () => {
    const crear = await pedir('POST', '/clientes', { token: tokens.operador, body: { nombre: 'Cliente', apellidos: 'Prueba', documento: '12345678', tipoDocumento: 'DNI', telefono: '999999999' } });
    assert.ok([200, 201].includes(crear.status), `crear cliente: ${crear.status} ${JSON.stringify(crear.data)}`);
    const id = crear.data?.id;
    assert.ok(id, 'el cliente creado debe tener id');

    assert.equal((await pedir('DELETE', `/clientes/${id}`, { token: tokens.operador })).status, 403);
    assert.equal((await pedir('GET', '/personal', { token: tokens.operador })).status, 403);
    assert.equal((await pedir('GET', '/configuracion', { token: tokens.operador })).status, 403);
    assert.equal((await pedir('GET', '/usuarios', { token: tokens.operador })).status, 403);
    assert.equal((await pedir('PUT', '/finanzas/transacciones/1/anular', { token: tokens.operador })).status, 403);
    assert.equal((await pedir('GET', '/dashboard', { token: tokens.operador })).status, 200);
});

test('CONTABILIDAD: solo lectura', async () => {
    assert.equal((await pedir('GET', '/finanzas/transacciones', { token: tokens.contabilidad })).status, 200);
    assert.equal((await pedir('GET', '/clientes', { token: tokens.contabilidad })).status, 200);
    const escribir = await pedir('POST', '/finanzas/transacciones', { token: tokens.contabilidad, body: { tipo: 'INGRESO', monto: 10 } });
    assert.equal(escribir.status, 403);
    assert.equal((await pedir('POST', '/clientes', { token: tokens.contabilidad, body: { nombre: 'X' } })).status, 403);
});

test('cliente de la web (USER): sin acceso al panel', async () => {
    for (const ruta of ['/clientes', '/dashboard', '/finanzas/transacciones', '/web/admin/novedades']) {
        assert.equal((await pedir('GET', ruta, { token: tokens.cliente })).status, 403, ruta);
    }
});

test('el registro público no permite elegir rol ni contraseñas débiles', async () => {
    const r = await pedir('POST', '/auth/register', { body: { nombre: 'Hacker', email: 'h@prueba.local', password: 'ClaveSegura2026', rol: 'ADMIN' } });
    assert.equal(r.status, 201);
    assert.equal(r.data.user.rol, 'USER');
    const debil = await pedir('POST', '/auth/register', { body: { nombre: 'X', email: 'x@prueba.local', password: '123' } });
    assert.equal(debil.status, 400);
});

test('un administrador no puede crear usuarios con rol inválido', async () => {
    const r = await pedir('POST', '/usuarios', { token: tokens.admin, body: { nombre: 'X', email: 'rol@prueba.local', password: 'ClaveSegura2026', rol: 'SUPERUSER' } });
    assert.equal(r.status, 400);
});

test('rutas públicas de la web siguen funcionando sin sesión', async () => {
    assert.equal((await pedir('GET', '/web/novedades')).status, 200);
    assert.equal((await pedir('GET', '/web/productos-web')).status, 200);
    assert.equal((await pedir('GET', '/web/bloqueos')).status, 200);
    assert.equal((await pedir('GET', '/web/resenas/publicadas')).status, 200);
    const cot = await pedir('POST', '/cotizaciones', { body: { nombre: 'Juan', telefono: '999111222', servicio: 'Frenos' } });
    assert.ok([200, 201].includes(cot.status), `cotización: ${cot.status}`);
    const cotServicios = await pedir('POST', '/web/cotizaciones', { body: { nombre: 'Ana', telefono: '999333444', servicio: 'Embrague' } });
    assert.ok([200, 201].includes(cotServicios.status), `cotización desde Servicios: ${cotServicios.status}`);
});

test('la boleta de una venta web solo se descarga con su token', async () => {
    const sinToken = await pedir('POST', '/web/ventas/1/boleta', { body: {} });
    assert.equal(sinToken.status, 403);
    const tokenFalso = await pedir('POST', '/web/ventas/1/boleta', { body: { token: tokens.admin } });
    assert.equal(tokenFalso.status, 403, 'un token de sesión no sirve como token de boleta');
});

test('los errores no exponen detalles internos', async () => {
    const r = await fetch(`http://localhost:${env.PORT || 3100}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{json roto',
    });
    assert.equal(r.status, 400);
    const data = await r.json();
    assert.equal(data.stack, undefined);
    assert.equal(data.details, undefined);
});

test('el personal del panel necesita 12+ caracteres y no se aceptan contraseñas previsibles', async () => {
    const corta = await pedir('POST', '/usuarios', { token: tokens.admin, body: { nombre: 'X', email: 'corta@prueba.local', password: 'Abc12345678', rol: 'OPERADOR' } });
    assert.equal(corta.status, 400);
    for (const previsible of ['JuanPablo2026!', 'Administrador123', 'contraseña123456']) {
        const r = await pedir('PUT', '/configuracion', { token: tokens.admin, body: { passwordActual: ADMIN.password, nuevaPassword: previsible } });
        assert.equal(r.status, 400, `${previsible} debería rechazarse`);
    }
});

test('el comando admin:password genera una frase segura, la guarda cifrada y reemplaza la anterior', async () => {
    const { execSync } = await import('node:child_process');
    const salida = execSync('npx ts-node --transpile-only src/scripts/resetAdminPassword.ts', {
        cwd: new URL('..', import.meta.url),
        env: { ...process.env, ENV_FILE: '.env.test', DATABASE_URL: env.DATABASE_URL },
        encoding: 'utf8',
    });
    const frase = salida.match(/Contraseña:\s+(\S+)/)?.[1];
    assert.match(frase, /^([A-Z][a-z]+-){5}\d{3}$/, 'formato de frase');
    assert.ok(frase.length >= 20);
    await iniciarSesion(ADMIN.usuario, frase);
    const anterior = await pedir('POST', '/auth/login', { body: { email: ADMIN.usuario, password: ADMIN.password } });
    assert.equal(anterior.status, 401, 'la contraseña anterior ya no debe funcionar');
    const config = await prisma.configuracion.findFirst();
    assert.match(config.password, /^\$2[aby]\$/);
    assert.ok(!config.password.includes(frase));
});
