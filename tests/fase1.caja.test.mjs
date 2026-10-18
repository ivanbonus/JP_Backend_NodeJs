// Fase 1 — Cálculos de caja: métodos de pago, saldo inicial, cierres, numeración y zona horaria de Lima.
// Ejecutar: npm run test:caja   (usa .env.test y una base LOCAL que se reinicia)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { env, encenderBase, apagarBase, resetearBase, iniciarServidor, pedir, iniciarSesion } from './helpers.mjs';

// Helpers puros del backend (Node ejecuta TypeScript eliminando los tipos)
const { hoyLima, horaLima, parsearFecha, mismoDia, variantesFecha } = await import('../src/utils/fechas.ts');
const { normalizarMetodoPago, esSaldoInicial, siguienteCorrelativo } = await import('../src/utils/caja.ts');

process.env.DATABASE_URL = env.DATABASE_URL;
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();

const ADMIN = { usuario: 'administrador', password: env.ADMIN_INITIAL_PASSWORD };
let servidor;
let token;

const HOY = hoyLima();
const AYER = hoyLima(new Date(Date.now() - 24 * 60 * 60 * 1000));
const numeroSaldo = `SALDO-${HOY.replace(/\//g, '')}`;

const crearTxn = (datos) => pedir('POST', '/finanzas/transacciones', {
    token,
    body: { tipo: 'INGRESO', concepto: 'Prueba', categoria: 'Servicio de taller', fecha: HOY, hora: '10:00', estado: 'COMPLETADO', ...datos },
});
const dashboard = async () => {
    const r = await pedir('GET', '/dashboard', { token });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data;
};

before(async () => {
    await encenderBase();
    resetearBase();
    servidor = await iniciarServidor();
    token = await iniciarSesion(ADMIN.usuario, ADMIN.password);
});

after(async () => {
    await prisma.$disconnect();
    servidor?.detener();
    await apagarBase();
});

test('helper de fecha: usa la hora de Lima, no la del servidor (UTC)', () => {
    // 23:30 del 17/10/2026 en Lima = 04:30 del 18/10/2026 en UTC
    const instante = new Date('2026-10-18T04:30:00Z');
    assert.equal(instante.getUTCDate(), 18);
    assert.equal(hoyLima(instante), '17/10/2026');
    assert.equal(horaLima(instante), '23:30');
    // 00:10 del 01/01/2027 en Lima = 05:10 UTC del mismo día
    assert.equal(hoyLima(new Date('2027-01-01T05:10:00Z')), '01/01/2027');
    assert.equal(hoyLima(new Date('2027-01-01T04:59:00Z')), '31/12/2026');

    assert.deepEqual(parsearFecha('1/3/2026'), { dia: 1, mes: 3, anio: 2026 });
    assert.equal(parsearFecha('2026-03-01'), null);
    assert.ok(mismoDia('1/3/2026', '01/03/2026'));
    assert.ok(!mismoDia('01/03/2026', '01/04/2026'));
    assert.deepEqual(variantesFecha('01/03/2026').sort(), ['01/03/2026', '01/3/2026', '1/03/2026', '1/3/2026']);
});

test('normalizador de método de pago y detección del saldo inicial', () => {
    for (const v of ['Efectivo', 'EFECTIVO', ' efectivo ']) assert.equal(normalizarMetodoPago(v), 'EFECTIVO');
    for (const v of ['Transferencia', 'TRANSFERENCIA', 'transferencia bancaria']) assert.equal(normalizarMetodoPago(v), 'TRANSFERENCIA');
    for (const v of ['Yape/Plin', 'YAPE', 'yape', 'PLIN', 'Plin']) assert.equal(normalizarMetodoPago(v), 'YAPE_PLIN');
    for (const v of ['Tarjeta', 'TARJETA', 'Tarjeta de crédito', 'débito']) assert.equal(normalizarMetodoPago(v), 'TARJETA');
    // Un método desconocido o vacío NO se asume efectivo
    assert.equal(normalizarMetodoPago(''), 'OTRO');
    assert.equal(normalizarMetodoPago('Cheque'), 'OTRO');

    assert.ok(esSaldoInicial({ numero: 'SALDO-17102026', categoria: 'Otro' }));
    assert.ok(esSaldoInicial({ numero: 'TXN-001', categoria: 'Saldo Inicial' }));
    assert.ok(!esSaldoInicial({ numero: 'TXN-001', categoria: 'Otro' }));
    assert.equal(siguienteCorrelativo('TXN', ['TXN-001', 'TXN-009', 'SALDO-17102026', 'EGR-050']), 'TXN-010');
});

test('dashboard: transferencia, Yape/Plin y tarjeta no se cuentan como efectivo; el saldo inicial no es ingreso', async () => {
    const r0 = await pedir('POST', '/finanzas/transacciones', {
        token,
        body: { numero: numeroSaldo, tipo: 'INGRESO', monto: 200, metodoPago: 'Efectivo', concepto: 'Saldo Inicial de Apertura', categoria: 'Otro', fecha: HOY, hora: '08:00', estado: 'COMPLETADO' },
    });
    assert.equal(r0.status, 201, JSON.stringify(r0.data));

    for (const [metodoPago, monto] of [['Efectivo', 100], ['Transferencia', 50], ['Yape/Plin', 30], ['TARJETA', 20], ['yape', 10]]) {
        const r = await crearTxn({ metodoPago, monto });
        assert.equal(r.status, 201, JSON.stringify(r.data));
    }
    assert.equal((await crearTxn({ tipo: 'EGRESO', metodoPago: 'Efectivo', monto: 15, categoria: 'Otro' })).status, 201);
    assert.equal((await crearTxn({ tipo: 'EGRESO', metodoPago: 'Transferencia', monto: 5, categoria: 'Servicios' })).status, 201);
    // Pendiente: no suma como ingreso, sí como por cobrar
    assert.equal((await crearTxn({ metodoPago: 'Efectivo', monto: 70, estado: 'PENDIENTE' })).status, 201);

    const d = await dashboard();
    assert.equal(d.kpis.ingresoHoy, 210, 'el saldo inicial (200) no debe sumarse a los ingresos');
    assert.equal(d.kpis.egresoHoy, 20);
    assert.equal(d.kpis.ingresoMes, 210);
    assert.equal(d.kpis.porCobrar, 70);
    assert.deepEqual(d.kpis.ingresosHoyPorMetodo, { Efectivo: 100, Transferencia: 50, 'Yape/Plin': 40, Tarjeta: 20 });
    assert.deepEqual(d.kpis.egresosHoyPorMetodo, { Efectivo: 15, Transferencia: 5 });
    assert.equal(d.kpis.efectivoHoy, 85);

    const pct = Object.fromEntries(d.distribuciones.distribPago.map(x => [x.label, x.pct]));
    assert.equal(pct.Efectivo, Math.round((100 / 210) * 100));
    assert.equal(pct.Transferencia, Math.round((50 / 210) * 100));
    assert.equal(pct['Yape/Plin'], Math.round((40 / 210) * 100));

    const mesActual = Number(HOY.split('/')[1]) - 1;
    assert.equal(d.chartData.ingresosData[mesActual], 210);
    assert.ok(!d.ultimasTxns.some(t => t.id.startsWith('SALDO-')), 'el saldo no aparece como venta');
});

test('saldo inicial: un segundo registro el mismo día actualiza el existente en lugar de fallar', async () => {
    const r = await pedir('POST', '/finanzas/transacciones', {
        token,
        body: { numero: numeroSaldo, tipo: 'INGRESO', monto: 250, metodoPago: 'Efectivo', concepto: 'Saldo Inicial de Apertura', categoria: 'Otro', fecha: HOY, hora: '09:00', estado: 'COMPLETADO' },
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.numero, numeroSaldo);
    assert.equal(r.data.monto, 250);

    const saldos = await prisma.transaccion.findMany({ where: { numero: { startsWith: 'SALDO-' } } });
    assert.equal(saldos.length, 1);
    assert.equal(saldos[0].monto, 250);

    const d = await dashboard();
    assert.equal(d.kpis.ingresoHoy, 210, 'cambiar el saldo no altera los ingresos');
});

test('numeración: el servidor asigna un número libre si el sugerido ya existe (también en simultáneo)', async () => {
    const a = await crearTxn({ numero: 'TXN-500', metodoPago: 'Efectivo', monto: 1 });
    const b = await crearTxn({ numero: 'TXN-500', metodoPago: 'Efectivo', monto: 1 });
    assert.equal(a.status, 201, JSON.stringify(a.data));
    assert.equal(b.status, 201, JSON.stringify(b.data));
    assert.equal(a.data.numero, 'TXN-500');
    assert.match(b.data.numero, /^TXN-\d{3,}$/);
    assert.notEqual(b.data.numero, a.data.numero);

    // Varias creaciones simultáneas con el mismo número sugerido
    const res = await Promise.all(Array.from({ length: 4 }, () =>
        crearTxn({ tipo: 'EGRESO', numero: 'EGR-001', metodoPago: 'Efectivo', monto: 1, categoria: 'Otro' })));
    for (const r of res) assert.equal(r.status, 201, JSON.stringify(r.data));
    const numeros = res.map(r => r.data.numero);
    assert.equal(new Set(numeros).size, 4, `números repetidos: ${numeros}`);
    for (const n of numeros) assert.match(n, /^EGR-\d{3,}$/);

    // Sin número sugerido también funciona
    const c = await crearTxn({ metodoPago: 'Efectivo', monto: 1 });
    assert.equal(c.status, 201);
    assert.match(c.data.numero, /^TXN-\d{3,}$/);

    // Anular para no alterar los totales de las siguientes pruebas
    for (const r of [a, b, c, ...res]) {
        assert.equal((await pedir('PUT', `/finanzas/transacciones/${r.data.id}/anular`, { token })).status, 200);
    }
});

test('cierre de caja: solo vincula las transacciones cobradas del día (Lima) que no estaban cerradas', async () => {
    // Ya cerrada en un cierre anterior
    const cierreViejo = await prisma.cierreCaja.create({ data: { estado: 'CERRADA', fechaCierre: new Date() } });
    const yaCerrada = await prisma.transaccion.create({
        data: { numero: 'TXN-900', tipo: 'INGRESO', monto: 40, metodoPago: 'Efectivo', concepto: 'Ya cerrada', fecha: HOY, hora: '07:00', cierreCajaId: cierreViejo.id },
    });
    // De ayer, sin cerrar
    const deAyer = await prisma.transaccion.create({
        data: { numero: 'TXN-901', tipo: 'INGRESO', monto: 60, metodoPago: 'Efectivo', concepto: 'De ayer', fecha: AYER, hora: '18:00' },
    });
    // De hoy, escrita sin ceros (registro antiguo)
    const [d, m, y] = HOY.split('/');
    const sinCeros = await prisma.transaccion.create({
        data: { numero: 'TXN-902', tipo: 'INGRESO', monto: 5, metodoPago: 'Efectivo', concepto: 'Formato antiguo', fecha: `${Number(d)}/${Number(m)}/${y}`, hora: '11:00' },
    });

    // getTransacciones expone cierreCajaId para que el frontend filtre
    const lista = await pedir('GET', '/finanzas/transacciones', { token });
    assert.equal(lista.status, 200);
    assert.ok(lista.data.every(t => 'cierreCajaId' in t));
    assert.equal(lista.data.find(t => t.id === yaCerrada.id).cierreCajaId, cierreViejo.id);

    const abiertasHoy = await prisma.transaccion.findMany({
        where: { fecha: { in: variantesFecha(HOY) }, estado: 'COMPLETADO', cierreCajaId: null },
    });

    const r = await pedir('POST', '/finanzas/cierres', {
        token,
        body: { turno: 'Día completo', montoInicial: 250, efectivoCaja: 340, totalEfectivo: 90, totalTarjeta: 20, totalTransferencia: 45, totalYape: 40, totalGeneral: 195, diferencia: 0, cerradoPor: 'Administrador', observaciones: '' },
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.transaccionesVinculadas, abiertasHoy.length);

    const vinculadas = await prisma.transaccion.findMany({ where: { cierreCajaId: r.data.id } });
    assert.deepEqual(vinculadas.map(t => t.id).sort((a, b) => a - b), abiertasHoy.map(t => t.id).sort((a, b) => a - b));
    assert.ok(vinculadas.some(t => t.id === sinCeros.id), 'incluye la fecha escrita sin ceros');
    assert.ok(vinculadas.every(t => t.estado === 'COMPLETADO'), 'no vincula pendientes ni anuladas');

    assert.equal((await prisma.transaccion.findUnique({ where: { id: yaCerrada.id } })).cierreCajaId, cierreViejo.id, 'no se re-vincula una ya cerrada');
    assert.equal((await prisma.transaccion.findUnique({ where: { id: deAyer.id } })).cierreCajaId, null, 'no vincula las de otro día');

    // Un segundo cierre el mismo día no vuelve a tomar las ya cerradas
    const r2 = await pedir('POST', '/finanzas/cierres', {
        token,
        body: { turno: 'Día completo', montoInicial: 0, efectivoCaja: 0, totalEfectivo: 0, totalTarjeta: 0, totalTransferencia: 0, totalYape: 0, totalGeneral: 0, diferencia: 0, cerradoPor: 'Administrador' },
    });
    assert.equal(r2.status, 201);
    assert.equal(r2.data.transaccionesVinculadas, 0);
    assert.equal(await prisma.transaccion.count({ where: { cierreCajaId: r.data.id } }), abiertasHoy.length);
});
