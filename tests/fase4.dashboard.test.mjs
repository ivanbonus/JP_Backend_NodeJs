// Fase 4 — Dashboard por pestañas: los indicadores coinciden con los módulos de origen.
// Ejecutar: npm run test:dashboard   (usa .env.test y una base LOCAL que se reinicia)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { env, encenderBase, apagarBase, resetearBase, iniciarServidor, pedir, iniciarSesion, BASE } from './helpers.mjs';

const { hoyLima } = await import('../src/utils/fechas.ts');

process.env.DATABASE_URL = env.DATABASE_URL;
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();

let servidor, token, tokenConta, cuentaPen, cuentaUsd, prov;

const ruc = (base10) => {
    const f = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    const r = 11 - (f.reduce((s, x, i) => s + x * Number(base10[i]), 0) % 11);
    return base10 + (r === 10 ? 0 : r === 11 ? 1 : r);
};
const diaIso = (n = 0) => new Date(Date.now() - 5 * 3600000 - n * 86400000).toISOString().slice(0, 10);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

const movimiento = (body) => pedir('POST', '/bancos/movimientos', {
    token, body: { metodo: 'TRANSFERENCIA', concepto: 'Prueba', contraparteNombre: 'Cliente Prueba', fecha: new Date().toISOString(), ...body },
});
const factura = (numero, total, extra = {}) => {
    const base = Math.round((total / 1.18) * 100) / 100;
    const igv = Math.round((total - base) * 100) / 100;
    return pedir('POST', '/compras/documentos', {
        token, body: {
            tipo: 'FACTURA', serie: 'F001', numero, proveedorId: prov.id, fechaEmision: diaIso(), condicionPago: 'CONTADO',
            moneda: 'PEN', baseImponible: base.toFixed(2), igv: igv.toFixed(2), total: total.toFixed(2), ...extra,
        },
    });
};
const indicadores = async (t = token) => {
    const r = await pedir('GET', '/dashboard/indicadores', { token: t });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data;
};

before(async () => {
    await encenderBase();
    resetearBase();
    servidor = await iniciarServidor();
    token = await iniciarSesion('administrador', env.ADMIN_INITIAL_PASSWORD);
    const u = await pedir('POST', '/usuarios', { token, body: { nombre: 'Contadora', email: 'conta@prueba.local', password: 'ClaveSegura2026', rol: 'CONTABILIDAD' } });
    assert.equal(u.status, 201, JSON.stringify(u.data));
    tokenConta = await iniciarSesion('conta@prueba.local', 'ClaveSegura2026');
    cuentaPen = (await pedir('POST', '/bancos/cuentas', { token, body: { banco: 'BCP', nombre: 'BCP Soles', numero: '191-1234567-0-12', moneda: 'PEN', saldoInicial: '1000.00' } })).data;
    cuentaUsd = (await pedir('POST', '/bancos/cuentas', { token, body: { banco: 'BCP', nombre: 'BCP Dólares', numero: '191-7654321-1-98', moneda: 'USD', saldoInicial: '50.00' } })).data;
    prov = (await pedir('POST', '/compras/proveedores', { token, body: { ruc: ruc('2060012345'), razonSocial: 'Repuestos del Norte SAC', diasCredito: 30 } })).data;
});

after(async () => {
    await prisma.$disconnect();
    servidor?.detener();
    await apagarBase();
});

test('indicadores: requieren sesión; contabilidad los consulta (solo lectura)', async () => {
    assert.equal((await pedir('GET', '/dashboard/indicadores')).status, 401);
    const r = await indicadores(tokenConta);
    assert.ok(r.bancos && r.compras && r.taller && r.inventario);
});

test('bancos: saldo conciliado, ingresos/pagos del mes y operaciones > umbral iguales a Control Bancario', async () => {
    const dep = await movimiento({ tipo: 'INGRESO', cuentaId: cuentaPen.id, monto: '2800.00', numeroOperacion: '000111', contraparteDoc: '45678912' });
    assert.equal(dep.status, 201, JSON.stringify(dep.data));
    const pago = await movimiento({ tipo: 'EGRESO', cuentaId: cuentaPen.id, monto: '300.00', numeroOperacion: '000222', concepto: 'Pago proveedor' });
    assert.equal(pago.status, 201, JSON.stringify(pago.data));
    const usd = await movimiento({ tipo: 'INGRESO', cuentaId: cuentaUsd.id, monto: '100.00', tipoCambio: '3.75', numeroOperacion: '000333' });
    assert.equal(usd.status, 201, JSON.stringify(usd.data));

    // Solo el egreso se concilia
    const con = await pedir('POST', `/bancos/movimientos/${pago.data.id}/conciliar`, { token, body: { conciliado: true, verificacion: 'Banca por internet' } });
    assert.equal(con.status, 200, JSON.stringify(con.data));

    const ind = await indicadores();
    const modulo = (await pedir('GET', '/bancos/resumen', { token })).data;

    // Saldo conciliado en soles: 1000 inicial − 300 conciliado (el depósito aún no se concilia)
    assert.equal(ind.bancos.saldoConciliadoPen, '700.00');
    assert.equal(ind.bancos.saldoRegistradoPen, '3500.00');
    assert.equal(ind.bancos.saldoConciliadoUsd, '50.00');
    assert.equal(ind.bancos.hayCuentasUsd, true);
    // Mismas cifras que el módulo (en soles, el USD convertido con su tipo de cambio)
    assert.equal(Number(ind.bancos.mes.ingresos), Number(modulo.mes.ingresos));
    assert.equal(Number(ind.bancos.mes.ingresos), 2800 + 375);
    assert.equal(Number(ind.bancos.mes.egresos), 300);
    assert.deepEqual(ind.bancos.mayoresUmbralMes, modulo.mayoresUmbralMes);
    assert.equal(ind.bancos.mayoresUmbralMes.cantidad, 1);
    assert.equal(ind.bancos.revisionPendiente.cantidad, modulo.revisionPendiente.cantidad);
    assert.equal(ind.bancos.pendientesConciliacion.cantidad, modulo.pendientesConciliacion.cantidad);
    assert.equal(ind.bancos.pendientesConciliacion.cantidad, 2);
    assert.equal(ind.bancos.sinComprobante, modulo.sinComprobante);
    assert.equal(ind.bancos.sinComprobante, 3);
});

test('compras: del mes, por pagar, vencidas, por vencer y sin archivo iguales a Compras y Proveedores', async () => {
    const a = (await factura('501', 1180)).data;
    const b = (await factura('502', 590, { condicionPago: 'CREDITO', fechaEmision: diaIso(40), fechaVencimiento: diaIso(10) })).data;
    const c = (await factura('503', 236, { condicionPago: 'CREDITO', fechaVencimiento: diaIso(-3) })).data;
    assert.ok(a.id && b.id && c.id, JSON.stringify({ a, b, c }));

    // Solo la primera tiene su PDF
    const fd = new FormData();
    fd.append('archivos', new Blob([PDF], { type: 'application/pdf' }), 'f501.pdf');
    const up = await fetch(`${BASE}/compras/documentos/${a.id}/archivos`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
    assert.equal(up.status, 201, await up.clone().text());

    const ind = await indicadores();
    const modulo = (await pedir('GET', '/compras/resumen', { token })).data;

    assert.deepEqual(ind.compras.mes, modulo.mes);
    assert.deepEqual(ind.compras.pendientesPago, modulo.pendientesPago);
    assert.equal(ind.compras.pendientesPago.saldoPen, '2006.00');
    assert.deepEqual(ind.compras.vencidos, { documentos: 1, saldoPen: '590.00' });
    // Por vencer en 7 días: la de crédito (vence en 3 días) y la de contado sin pagar (vence hoy)
    assert.deepEqual(ind.compras.porVencer7Dias, { documentos: 2, saldoPen: '1416.00' });
    assert.equal(ind.compras.sinArchivo, 2);
    assert.equal(modulo.sinArchivo, 2);

    // El acceso directo "sin archivo" lista exactamente esas facturas
    const lista = (await pedir('GET', '/compras/documentos?sinArchivo=1', { token })).data;
    assert.deepEqual(lista.map(d => d.numero).sort(), ['502', '503']);
});

test('por cobrar: el saldo vencido solo cuenta ventas sin cobrar de hace más de 30 días', async () => {
    const venta = (fecha, monto, estado = 'PENDIENTE') => pedir('POST', '/finanzas/transacciones', {
        token, body: { tipo: 'INGRESO', concepto: 'Servicio', categoria: 'Servicio de taller', fecha, hora: '10:00', estado, monto, metodoPago: 'EFECTIVO' },
    });
    const antigua = await venta(hoyLima(new Date(Date.now() - 45 * 86400000)), 400);
    assert.equal(antigua.status, 201, JSON.stringify(antigua.data));
    assert.equal((await venta(hoyLima(), 150)).status, 201);
    assert.equal((await venta(hoyLima(new Date(Date.now() - 60 * 86400000)), 999, 'COMPLETADO')).status, 201);

    const r = await pedir('GET', '/dashboard', { token });
    assert.equal(r.status, 200);
    assert.equal(r.data.kpis.porCobrar, 550);
    assert.deepEqual(r.data.kpis.porCobrarVencido, { cantidad: 1, monto: 400, dias: 30 });
});

test('taller e inventario: vehículos en taller y stock bajo con el criterio de Inventario (≤ 5)', async () => {
    await prisma.producto.createMany({
        data: [
            { sku: 'P-1', nombre: 'Pastilla', precio: 50, stockActual: 2 },
            { sku: 'P-2', nombre: 'Disco', precio: 90, stockActual: 5 },
            { sku: 'P-3', nombre: 'Zapata', precio: 40, stockActual: 20 },
        ],
    });
    const ind = await indicadores();
    assert.deepEqual(ind.inventario, { stockBajo: 2, limite: 5 });
    const dash = (await pedir('GET', '/dashboard', { token })).data;
    assert.equal(ind.taller.enTaller, dash.kpis.vehiculosTaller);
});
