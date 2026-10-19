// Fase 2A — Control Bancario: cuentas, movimientos, comprobantes, revisión > umbral, exportación.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { env, encenderBase, apagarBase, resetearBase, iniciarServidor, pedir, iniciarSesion, BASE } from './helpers.mjs';

process.env.DATABASE_URL = env.DATABASE_URL;
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();

let servidor, token, cuentaPen, cuentaUsd;

// Archivos de prueba
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const EXE = Buffer.from('MZ\x90\x00 esto no es un comprobante', 'latin1');

const subir = async (movId, archivos, tk = token) => {
    const fd = new FormData();
    for (const [nombre, buf, tipo] of archivos) fd.append('archivos', new Blob([buf], { type: tipo }), nombre);
    const r = await fetch(`${BASE}/bancos/movimientos/${movId}/archivos`, { method: 'POST', headers: { Authorization: `Bearer ${tk}` }, body: fd });
    return { status: r.status, data: await r.json() };
};

before(async () => {
    await encenderBase();
    resetearBase();
    servidor = await iniciarServidor();
    token = await iniciarSesion('administrador', env.ADMIN_INITIAL_PASSWORD);
    cuentaPen = (await pedir('POST', '/bancos/cuentas', { token, body: { banco: 'BCP', nombre: 'BCP Soles', numero: '191-1234567-0-12', moneda: 'PEN', saldoInicial: '1000.00' } })).data;
    cuentaUsd = (await pedir('POST', '/bancos/cuentas', { token, body: { banco: 'BCP', nombre: 'BCP Dólares', numero: '191-7654321-1-98', moneda: 'USD' } })).data;
});

after(async () => {
    await prisma.$disconnect();
    servidor?.detener();
    await apagarBase();
});

test('sin sesión, el control bancario está cerrado', async () => {
    for (const r of ['/bancos/resumen', '/bancos/movimientos', '/bancos/cuentas']) {
        assert.equal((await pedir('GET', r)).status, 401, r);
    }
});

test('cuentas: número enmascarado, CCI validado y sin cambiar moneda con movimientos', async () => {
    assert.equal(cuentaPen.numeroMascara, '•••• 0-12'.replace('0-12', '0-12'.slice(-4)));
    const cciMalo = await pedir('POST', '/bancos/cuentas', { token, body: { nombre: 'X', cci: '123' } });
    assert.equal(cciMalo.status, 400);
});

test('CASO 1: depósito de cliente por S/ 2,500 → revisión, comprobante y conciliación', async () => {
    const r = await pedir('POST', '/bancos/movimientos', {
        token, body: {
            tipo: 'INGRESO', cuentaId: cuentaPen.id, metodo: 'TRANSFERENCIA', monto: '2500.00',
            numeroOperacion: '00012345', concepto: 'Pago reparación de frenos', fecha: new Date().toISOString(),
        },
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const mov = r.data;
    assert.match(mov.codigo, /^MB-\d{4}-\d{6}$/);
    assert.equal(mov.montoPen, '2500');
    assert.equal(mov.requiereRevision, true, 'supera S/ 2,000');
    assert.equal(mov.revisionEstado, 'PENDIENTE');
    assert.equal(mov.estado, 'SIN_IDENTIFICAR', 'ingreso sin contraparte');
    assert.ok(mov.aviso);

    // No se puede aprobar la revisión sin contraparte ni comprobante
    assert.equal((await pedir('POST', `/bancos/movimientos/${mov.id}/revision`, { token, body: { resultado: 'REVISADO' } })).status, 400);

    // Identificar la contraparte
    const ed = await pedir('PUT', `/bancos/movimientos/${mov.id}`, { token, body: { contraparteNombre: 'Transportes Lima SAC', contraparteDoc: '20512345678' } });
    assert.equal(ed.status, 200, JSON.stringify(ed.data));
    assert.equal(ed.data.estado, 'PENDIENTE', 'ya identificado');
    assert.equal((await pedir('POST', `/bancos/movimientos/${mov.id}/revision`, { token, body: { resultado: 'REVISADO' } })).status, 400, 'aún falta el comprobante');

    // Adjuntar comprobante
    const up = await subir(mov.id, [['voucher.png', PNG, 'image/png']]);
    assert.equal(up.status, 201, JSON.stringify(up.data));
    assert.equal(up.data.archivos.length, 1);
    const db = await prisma.archivo.findFirst({ where: { entidadId: mov.id } });
    assert.match(db.sha256, /^[0-9a-f]{64}$/);
    assert.equal(db.almacenamiento, 'local');

    // Ver el comprobante con enlace temporal
    const enl = await pedir('GET', `/bancos/archivos/${up.data.archivos[0].id}/enlace`, { token });
    assert.equal(enl.status, 200);
    const img = await fetch(enl.data.url);
    assert.equal(img.status, 200);
    assert.ok(Buffer.from(await img.arrayBuffer()).equals(PNG), 'el archivo descargado es idéntico');

    // Revisión aprobada
    const rev = await pedir('POST', `/bancos/movimientos/${mov.id}/revision`, { token, body: { resultado: 'REVISADO', nota: 'Cliente frecuente' } });
    assert.equal(rev.status, 200, JSON.stringify(rev.data));
    assert.equal(rev.data.revisionEstado, 'REVISADO');
    assert.ok(rev.data.revisadoPor);

    // Un comprobante NO concilia: hace falta indicar dónde se verificó
    assert.equal((await pedir('POST', `/bancos/movimientos/${mov.id}/conciliar`, { token, body: { conciliado: true } })).status, 400);
    const con = await pedir('POST', `/bancos/movimientos/${mov.id}/conciliar`, { token, body: { conciliado: true, verificacion: 'Banca por internet BCP, movimientos del día' } });
    assert.equal(con.status, 200);
    assert.equal(con.data.estado, 'CONCILIADO');
    assert.ok(con.data.fechaConciliacion);

    // Conciliado: no se cambia el monto
    const intento = await pedir('PUT', `/bancos/movimientos/${mov.id}`, { token, body: { monto: '1.00', observaciones: 'nota' } });
    assert.equal(intento.data.monto, '2500');
    globalThis.__caso1 = mov;
});

test('el mismo n.º de operación no se registra dos veces en la misma cuenta', async () => {
    const r = await pedir('POST', '/bancos/movimientos', {
        token, body: { tipo: 'INGRESO', cuentaId: cuentaPen.id, metodo: 'TRANSFERENCIA', monto: '10', numeroOperacion: '00012345', concepto: 'Repetido', contraparteNombre: 'X' },
    });
    assert.equal(r.status, 409);
    // En otra cuenta sí puede existir
    const otra = await pedir('POST', '/bancos/movimientos', {
        token, body: { tipo: 'INGRESO', cuentaId: cuentaUsd.id, metodo: 'TRANSFERENCIA', monto: '10', tipoCambio: '3.75', numeroOperacion: '00012345', concepto: 'Otra cuenta', contraparteNombre: 'X' },
    });
    assert.equal(otra.status, 201, JSON.stringify(otra.data));
});

test('montos exactos (sin errores de punto flotante) y dólares con tipo de cambio', async () => {
    const usdSinTc = await pedir('POST', '/bancos/movimientos', { token, body: { tipo: 'EGRESO', cuentaId: cuentaUsd.id, metodo: 'TRANSFERENCIA', monto: '100', concepto: 'Pago' } });
    assert.equal(usdSinTc.status, 400, 'en dólares el tipo de cambio es obligatorio');

    const usd = await pedir('POST', '/bancos/movimientos', { token, body: { tipo: 'EGRESO', cuentaId: cuentaUsd.id, metodo: 'TRANSFERENCIA', monto: '600.10', tipoCambio: '3.7531', concepto: 'Repuestos importados', contraparteNombre: 'Proveedor', contraparteDoc: '20100000001' } });
    assert.equal(usd.status, 201);
    assert.equal(usd.data.montoPen, '2252.24', '600.10 × 3.7531 = 2252.23531 → 2252.24');
    assert.equal(usd.data.requiereRevision, true);

    for (const m of ['0.10', '0.20']) {
        await pedir('POST', '/bancos/movimientos', { token, body: { tipo: 'EGRESO', cuentaId: cuentaPen.id, metodo: 'TARJETA', monto: m, concepto: 'Comisión', categoria: 'Comisiones bancarias' } });
    }
    const suma = await prisma.movimientoBancario.aggregate({ where: { concepto: 'Comisión' }, _sum: { monto: true } });
    assert.equal(suma._sum.monto.toString(), '0.3', '0.1 + 0.2 = 0.3 exacto');

    for (const malo of ['-5', '0', 'abc', '1.234', '99999999999']) {
        const r = await pedir('POST', '/bancos/movimientos', { token, body: { tipo: 'EGRESO', cuentaId: cuentaPen.id, metodo: 'TARJETA', monto: malo, concepto: 'X' } });
        assert.equal(r.status, 400, `monto ${malo}`);
    }
});

test('comprobantes: solo tipos permitidos (por contenido), avisa duplicados y se pueden quitar', async () => {
    const mov = (await pedir('POST', '/bancos/movimientos', { token, body: { tipo: 'EGRESO', cuentaId: cuentaPen.id, metodo: 'TRANSFERENCIA', monto: '150', concepto: 'Pago luz', categoria: 'Servicios (luz, agua, internet)' } })).data;

    // Un ejecutable renombrado como .pdf se rechaza
    const exe = await subir(mov.id, [['factura.pdf', EXE, 'application/pdf']]);
    assert.equal(exe.status, 415);

    const pdf = await subir(mov.id, [['recibo.pdf', PDF, 'application/pdf']]);
    assert.equal(pdf.status, 201);
    // El mismo voucher del CASO 1 en otro movimiento: aviso de posible pago duplicado
    const dup = await subir(mov.id, [['voucher-copia.png', PNG, 'image/png']]);
    assert.equal(dup.status, 201);
    assert.ok(dup.data.avisos.some(a => a.includes(globalThis.__caso1.codigo)), JSON.stringify(dup.data.avisos));

    // Quitar (borrado lógico) un comprobante
    const id = pdf.data.archivos[0].id;
    assert.equal((await pedir('DELETE', `/bancos/archivos/${id}`, { token })).status, 200);
    assert.equal((await prisma.archivo.findUnique({ where: { id } })).eliminado, true, 'se conserva marcado');
    // No se quita el comprobante de un movimiento revisado/conciliado
    const delCaso1 = await prisma.archivo.findFirst({ where: { entidadId: globalThis.__caso1.id, eliminado: false } });
    assert.equal((await pedir('DELETE', `/bancos/archivos/${delCaso1.id}`, { token })).status, 400);
});

test('búsqueda por n.º de operación, monto, contraparte y filtro sin comprobante', async () => {
    const porOp = await pedir('GET', '/bancos/movimientos?q=00012345', { token });
    assert.ok(porOp.data.total >= 2);
    const porMonto = await pedir('GET', '/bancos/movimientos?q=2500', { token });
    assert.ok(porMonto.data.movimientos.some(m => m.codigo === globalThis.__caso1.codigo));
    const porNombre = await pedir('GET', '/bancos/movimientos?q=transportes%20lima', { token });
    assert.equal(porNombre.data.total, 1);
    const sinComp = await pedir('GET', '/bancos/movimientos?sinComprobante=1', { token });
    assert.ok(sinComp.data.movimientos.every(m => m.cantidadArchivos === 0));
    const rev = await pedir('GET', '/bancos/movimientos?revision=pendiente', { token });
    assert.ok(rev.data.movimientos.every(m => m.requiereRevision && m.revisionEstado !== 'REVISADO'));
});

test('anular: exige motivo, no borra y deja de contar en el resumen', async () => {
    const mov = (await pedir('POST', '/bancos/movimientos', { token, body: { tipo: 'INGRESO', cuentaId: cuentaPen.id, metodo: 'YAPE', monto: '80', concepto: 'Error de registro', contraparteNombre: 'Ana' } })).data;
    assert.equal((await pedir('POST', `/bancos/movimientos/${mov.id}/anular`, { token, body: { motivo: 'x' } })).status, 400);
    const an = await pedir('POST', `/bancos/movimientos/${mov.id}/anular`, { token, body: { motivo: 'Registrado dos veces' } });
    assert.equal(an.data.estado, 'ANULADO');
    assert.ok(await prisma.movimientoBancario.findUnique({ where: { id: mov.id } }), 'el registro se conserva');
    assert.equal((await pedir('PUT', `/bancos/movimientos/${mov.id}`, { token, body: { concepto: 'otro' } })).status, 400);
    const lista = await pedir('GET', '/bancos/movimientos?q=Error%20de%20registro', { token });
    assert.equal(lista.data.total, 0, 'los anulados no aparecen por defecto');
});

test('resumen: ingresos/egresos, saldos por cuenta y pendientes', async () => {
    const r = await pedir('GET', '/bancos/resumen', { token });
    assert.equal(r.status, 200);
    // 2500 (CASO 1) + 37.50 (10 US$ × 3.75 en la cuenta en dólares); el anulado de 80 no cuenta
    assert.equal(r.data.hoy.ingresos, '2537.5');
    const pen = r.data.saldos.find(s => s.cuentaId === cuentaPen.id);
    // 1000 inicial + 2500 − 0.10 − 0.20 − 150
    assert.equal(pen.saldoRegistrado, '3349.7');
    assert.equal(pen.saldoConciliado, '3500', 'solo lo conciliado');
    assert.ok(r.data.revisionPendiente.cantidad >= 1, 'el pago en dólares sigue pendiente de revisión');
    assert.ok(r.data.sinComprobante >= 1);
});

test('enlace a una venta existente sin superar su monto (no duplica ingresos)', async () => {
    const venta = (await pedir('POST', '/finanzas/transacciones', { token, body: { tipo: 'INGRESO', monto: 300, metodoPago: 'Transferencia', concepto: 'Cambio de pastillas', estado: 'COMPLETADO' } })).data;
    assert.ok(venta.id, JSON.stringify(venta));
    const ok = await pedir('POST', '/bancos/movimientos', { token, body: { tipo: 'INGRESO', cuentaId: cuentaPen.id, metodo: 'TRANSFERENCIA', monto: '300', concepto: 'Pago venta', contraparteNombre: 'Cliente', transaccionId: venta.id } });
    assert.equal(ok.status, 201, JSON.stringify(ok.data));
    assert.equal(ok.data.transaccion.numero, venta.numero);
    const excede = await pedir('POST', '/bancos/movimientos', { token, body: { tipo: 'INGRESO', cuentaId: cuentaPen.id, metodo: 'TRANSFERENCIA', monto: '1', concepto: 'Pago extra', contraparteNombre: 'Cliente', transaccionId: venta.id } });
    assert.equal(excede.status, 400, 'los pagos no pueden superar el monto de la venta');
    // La venta no se duplicó
    assert.equal(await prisma.transaccion.count({ where: { concepto: 'Cambio de pastillas' } }), 1);
});

test('exportación a Excel', async () => {
    const r = await fetch(`${BASE}/bancos/movimientos/exportar`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /spreadsheetml/);
    const b = Buffer.from(await r.arrayBuffer());
    assert.equal(b.subarray(0, 2).toString(), 'PK', 'es un .xlsx (zip)');
    const ExcelJS = (await import('exceljs')).default;
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(b);
    const hoja = libro.getWorksheet('Movimientos');
    assert.equal(hoja.getRow(1).getCell(1).value, 'Código');
    assert.ok(hoja.rowCount >= 6);
});

test('umbral configurable y auditoría de las operaciones bancarias', async () => {
    assert.equal((await pedir('PUT', '/bancos/configuracion/umbral', { token, body: { umbralRevision: '5000' } })).status, 200);
    const m = await pedir('POST', '/bancos/movimientos', { token, body: { tipo: 'INGRESO', cuentaId: cuentaPen.id, metodo: 'DEPOSITO', monto: '3000', concepto: 'Depósito', contraparteNombre: 'Luis' } });
    assert.equal(m.data.requiereRevision, false, 'con umbral 5000, 3000 no requiere revisión');
    await pedir('PUT', '/bancos/configuracion/umbral', { token, body: { umbralRevision: '2000' } });
    await new Promise(r => setTimeout(r, 300));
    const aud = await pedir('GET', '/auditoria?entidad=bancos&porPagina=100', { token });
    const acciones = new Set(aud.data.registros.map(r => r.accion));
    for (const a of ['CREAR', 'EDITAR', 'ANULAR', 'COMPROBANTE_SUBIDO', 'EXPORTAR']) assert.ok(acciones.has(a), `falta ${a}`);
});
