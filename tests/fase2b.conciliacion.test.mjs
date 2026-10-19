// Fase 2B — Conciliación con extractos bancarios (CASO 10 del prompt y escenarios de seguridad/duplicados).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { env, encenderBase, apagarBase, resetearBase, iniciarServidor, pedir, iniciarSesion, BASE } from './helpers.mjs';

process.env.DATABASE_URL = env.DATABASE_URL;
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
const ExcelJS = (await import('exceljs')).default;

let servidor, token, cuenta;
const hoy = new Date();
const fecha = (diasAtras) => {
    const d = new Date(hoy.getTime() - diasAtras * 86400000);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};
const iso = (diasAtras) => new Date(hoy.getTime() - diasAtras * 86400000).toISOString();

// Extracto estilo BCP (CSV con ; y montos con signo)
const csvBcp = () => [
    'Movimientos de la cuenta 191-1234567-0-12',
    'Moneda: Soles',
    '',
    'Fecha;Fecha valuta;Descripción operación;Monto;Saldo;Sucursal - agencia;Operación - Número;Operación - Hora',
    `${fecha(5)};${fecha(5)};TRAN.CTAS.TERC.TRANSPORTES LIMA;2,500.00;7,500.00;LIMA;00012345;10:15`,
    `${fecha(4)};${fecha(4)};PAGO PROVEEDOR REPUESTOS NORTE;-3,500.00;4,000.00;LIMA;00055120;11:20`,
    `${fecha(3)};${fecha(3)};YAPE DE MARIA PEREZ;180.00;4,180.00;;00099112;09:00`,
    `${fecha(2)};${fecha(2)};COMISION MANTENIMIENTO;-15.00;4,165.00;;;`,
    `${fecha(2)};${fecha(2)};DEPOSITO EN EFECTIVO AGENTE;450.00;4,615.00;;00077001;16:40`,
    `${fecha(1)};${fecha(1)};TRANSF. JUAN QUISPE;1,200.00;5,815.00;;00088002;12:00`,
    '',
    'Total abonos;;;4,330.00;;;;',
].join('\r\n');

const subirExtracto = async (ruta, contenido, nombre, campos = {}) => {
    const fd = new FormData();
    fd.append('cuentaId', String(cuenta.id));
    for (const [k, v] of Object.entries(campos)) fd.append(k, typeof v === 'string' ? v : JSON.stringify(v));
    fd.append('archivo', new Blob([contenido]), nombre);
    const r = await fetch(`${BASE}${ruta}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
    return { status: r.status, data: await r.json() };
};

before(async () => {
    await encenderBase();
    resetearBase();
    servidor = await iniciarServidor();
    token = await iniciarSesion('administrador', env.ADMIN_INITIAL_PASSWORD);
    cuenta = (await pedir('POST', '/bancos/cuentas', { token, body: { banco: 'BCP', nombre: 'BCP Soles', numero: '191-1234567-0-12', moneda: 'PEN', saldoInicial: '5000' } })).data;

    // Lo que el taller registró en el sistema
    const mov = (b) => pedir('POST', '/bancos/movimientos', { token, body: { cuentaId: cuenta.id, metodo: 'TRANSFERENCIA', ...b } });
    globalThis.__m = {
        exacto: (await mov({ tipo: 'INGRESO', monto: '2500', numeroOperacion: '12345', concepto: 'Reparación frenos', contraparteNombre: 'Transportes Lima SAC', fecha: iso(5) })).data,
        diferencia: (await mov({ tipo: 'EGRESO', monto: '3550', numeroOperacion: '55120', concepto: 'Repuestos', contraparteNombre: 'Repuestos del Norte', fecha: iso(4) })).data,
        sugerido: (await mov({ tipo: 'INGRESO', monto: '180', metodo: 'YAPE', concepto: 'Pastillas', contraparteNombre: 'María Pérez', fecha: iso(3) })).data,
        noEnBanco: (await mov({ tipo: 'INGRESO', monto: '999', numeroOperacion: '424242', concepto: 'Depósito que no llegó', contraparteNombre: 'Pedro', fecha: iso(2) })).data,
        dup1: (await mov({ tipo: 'EGRESO', monto: '70', concepto: 'Gasolina', contraparteNombre: 'Grifo', fecha: iso(1) })).data,
        dup2: (await mov({ tipo: 'EGRESO', monto: '70', concepto: 'Gasolina (otra vez)', contraparteNombre: 'Grifo', fecha: iso(1) })).data,
    };
    globalThis.__ventas = await prisma.transaccion.count();
});

after(async () => {
    await prisma.$disconnect();
    servidor?.detener();
    await apagarBase();
});

test('vista previa: detecta encabezados y columnas del BCP', async () => {
    const r = await subirExtracto('/bancos/extractos/previsualizar', csvBcp(), 'movimientos.csv');
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const enc = r.data.encabezados;
    assert.equal(enc[r.data.mapeo.fecha], 'Fecha');
    assert.equal(enc[r.data.mapeo.descripcion], 'Descripción operación');
    assert.equal(enc[r.data.mapeo.monto], 'Monto');
    assert.equal(enc[r.data.mapeo.numeroOperacion], 'Operación - Número');
    assert.equal(enc[r.data.mapeo.saldo], 'Saldo');
    assert.equal(r.data.totalLineas, 6, 'omite la fila de totales');
    assert.equal(r.data.lineasMuestra[1].tipo, 'EGRESO');
    assert.equal(r.data.lineasMuestra[1].monto, '3500');
});

test('CASO 10: importar extracto → coincidencias, diferencias y sin identificar', async () => {
    const r = await subirExtracto('/bancos/extractos/importar', csvBcp(), 'movimientos.csv');
    if (r.status !== 201) console.log('LOG SERVIDOR:', servidor.log().slice(-4000));
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.lineasNuevas, 6);
    assert.equal(r.data.conciliadasAutomaticamente, 1, 'solo el exacto (n.º de operación y monto)');
    assert.equal(r.data.conDiferencia, 1, 'mismo n.º de operación con distinto monto');

    const m = globalThis.__m;
    assert.equal((await prisma.movimientoBancario.findUnique({ where: { id: m.exacto.id } })).estado, 'CONCILIADO');
    assert.equal((await prisma.movimientoBancario.findUnique({ where: { id: m.diferencia.id } })).estado, 'DIFERENCIA');
    assert.equal((await prisma.movimientoBancario.findUnique({ where: { id: m.sugerido.id } })).estado, 'PENDIENTE', 'lo aproximado NO se concilia solo');

    const e = await pedir('GET', `/bancos/conciliacion?cuentaId=${cuenta.id}`, { token });
    assert.equal(e.status, 200);
    const yape = e.data.lineas.find(l => l.descripcion.includes('YAPE'));
    assert.equal(yape.sugerencias[0].movimiento.id, m.sugerido.id, 'sugerencia por monto y fecha');
    assert.ok(yape.sugerencias[0].motivos.includes('mismo monto'));
    const sinId = e.data.lineas.filter(l => l.estado === 'SIN_IDENTIFICAR').map(l => l.descripcion);
    assert.ok(sinId.some(d => d.includes('COMISION')) && sinId.some(d => d.includes('DEPOSITO')) && sinId.some(d => d.includes('JUAN QUISPE')), JSON.stringify(sinId));
    assert.ok(e.data.noEnBanco.some(x => x.id === m.noEnBanco.id), 'registrado pero no aparece en el banco');
    assert.equal(e.data.posiblesDuplicados.length, 1, 'dos gasolinas iguales el mismo día');
    assert.equal(e.data.resumen.diferencias, 1);
});

test('el mismo extracto no se importa dos veces; uno que se solapa no duplica líneas', async () => {
    const otraVez = await subirExtracto('/bancos/extractos/importar', csvBcp(), 'movimientos.csv');
    assert.equal(otraVez.status, 409);
    const solapado = csvBcp().replace('\r\n\r\nTotal abonos', `\r\n${fecha(0)};${fecha(0)};ABONO NUEVO;50.00;5,865.00;;00011111;08:00\r\n\r\nTotal abonos`);
    const r = await subirExtracto('/bancos/extractos/importar', solapado, 'movimientos-2.csv');
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.lineasNuevas, 1);
    assert.equal(r.data.lineasRepetidas, 6);
    assert.equal(await prisma.lineaExtracto.count({ where: { cuentaId: cuenta.id } }), 7);
});

test('aprobar una sugerencia (vincular) y deshacerla', async () => {
    const yape = await prisma.lineaExtracto.findFirst({ where: { descripcion: { contains: 'YAPE' } } });
    const v = await pedir('POST', '/bancos/conciliacion/vincular', { token, body: { lineaId: yape.id, movimientoId: globalThis.__m.sugerido.id } });
    assert.equal(v.status, 200, JSON.stringify(v.data));
    assert.equal((await prisma.movimientoBancario.findUnique({ where: { id: globalThis.__m.sugerido.id } })).estado, 'CONCILIADO');
    // Un movimiento no se vincula a dos líneas
    const otra = await prisma.lineaExtracto.findFirst({ where: { descripcion: { contains: 'DEPOSITO' } } });
    assert.equal((await pedir('POST', '/bancos/conciliacion/vincular', { token, body: { lineaId: otra.id, movimientoId: globalThis.__m.sugerido.id } })).status, 400);
    // Deshacer
    assert.equal((await pedir('POST', '/bancos/conciliacion/desvincular', { token, body: { lineaId: yape.id } })).status, 200);
    assert.equal((await prisma.movimientoBancario.findUnique({ where: { id: globalThis.__m.sugerido.id } })).estado, 'PENDIENTE');
    await pedir('POST', '/bancos/conciliacion/vincular', { token, body: { lineaId: yape.id, movimientoId: globalThis.__m.sugerido.id } });
});

test('montos distintos exigen confirmar la diferencia', async () => {
    const dep = await prisma.lineaExtracto.findFirst({ where: { descripcion: { contains: 'DEPOSITO' } } });
    const r = await pedir('POST', '/bancos/conciliacion/vincular', { token, body: { lineaId: dep.id, movimientoId: globalThis.__m.noEnBanco.id } });
    assert.equal(r.status, 409);
    assert.equal(r.data.diferencia, '-549.00');
});

test('registrar desde el extracto lo que faltaba (comisión) e ignorar con motivo', async () => {
    const com = await prisma.lineaExtracto.findFirst({ where: { descripcion: { contains: 'COMISION' } } });
    const r = await pedir('POST', '/bancos/conciliacion/registrar-desde-linea', { token, body: { lineaId: com.id, concepto: 'Comisión de mantenimiento', categoria: 'Comisiones bancarias', metodo: 'OTRO' } });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.estado, 'CONCILIADO');
    assert.equal(r.data.monto, '15');

    const juan = await prisma.lineaExtracto.findFirst({ where: { descripcion: { contains: 'JUAN QUISPE' } } });
    assert.equal((await pedir('POST', '/bancos/conciliacion/ignorar', { token, body: { lineaId: juan.id, motivo: 'x' } })).status, 400);
    assert.equal((await pedir('POST', '/bancos/conciliacion/ignorar', { token, body: { lineaId: juan.id, motivo: 'Traspaso entre cuentas propias' } })).status, 200);
    assert.equal((await prisma.lineaExtracto.findUnique({ where: { id: juan.id } })).estado, 'IGNORADO');
});

test('CASO 11: la importación no crea ventas ni ingresos en Caja', async () => {
    assert.equal(await prisma.transaccion.count(), globalThis.__ventas, 'no se crearon transacciones');
});

test('al anular un movimiento conciliado, su línea del banco vuelve a pendiente', async () => {
    const linea = await prisma.lineaExtracto.findFirst({ where: { movimientoId: globalThis.__m.exacto.id } });
    await pedir('POST', `/bancos/movimientos/${globalThis.__m.exacto.id}/anular`, { token, body: { motivo: 'Prueba de anulación' } });
    const despues = await prisma.lineaExtracto.findUnique({ where: { id: linea.id } });
    assert.equal(despues.movimientoId, null);
    assert.equal(despues.estado, 'PENDIENTE');
});

test('Excel (.xlsx) con columnas de cargo y abono, y mapeo recordado', async () => {
    const libro = new ExcelJS.Workbook();
    const h = libro.addWorksheet('Movimientos');
    h.addRow(['Extracto BCP']);
    h.addRow(['Fecha', 'Descripción', 'Cargo', 'Abono', 'Nro. Operación']);
    const d = new Date(Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()));
    h.addRow([d, 'ABONO EXCEL', null, 1234.5, '0077889']);
    h.addRow([d, 'CARGO EXCEL', 99.9, null, '0077890']);
    const buf = Buffer.from(await libro.xlsx.writeBuffer());
    const prev = await subirExtracto('/bancos/extractos/previsualizar', buf, 'extracto.xlsx');
    assert.equal(prev.status, 200, JSON.stringify(prev.data));
    assert.equal(prev.data.mapeo.monto, -1);
    assert.equal(prev.data.lineasMuestra[0].tipo, 'INGRESO');
    assert.equal(prev.data.lineasMuestra[0].monto, '1234.5');
    assert.equal(prev.data.lineasMuestra[1].tipo, 'EGRESO');
    const imp = await subirExtracto('/bancos/extractos/importar', buf, 'extracto.xlsx', { mapeo: prev.data.mapeo });
    assert.equal(imp.status, 201, JSON.stringify(imp.data));
    const c = await prisma.cuentaBancaria.findUnique({ where: { id: cuenta.id } });
    assert.equal(c.mapeoExtracto.mapeo.cargo, prev.data.mapeo.cargo, 'mapeo guardado para la próxima vez');
});

test('CASO 13: archivos dañados o en formato no soportado se rechazan', async () => {
    const biff = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(100)]);
    const r1 = await subirExtracto('/bancos/extractos/previsualizar', biff, 'viejo.xls');
    assert.equal(r1.status, 400);
    assert.match(r1.data.error, /\.xlsx/);
    const roto = Buffer.concat([Buffer.from('PK'), Buffer.alloc(50, 1)]);
    assert.equal((await subirExtracto('/bancos/extractos/previsualizar', roto, 'roto.xlsx')).status, 400);
    assert.equal((await subirExtracto('/bancos/extractos/previsualizar', 'hola;mundo\n1;2', 'x.csv')).status, 400, 'sin encabezados de extracto');
    const grande = Buffer.alloc(5 * 1024 * 1024 + 10, 65);
    assert.equal((await subirExtracto('/bancos/extractos/previsualizar', grande, 'grande.csv')).status, 413);
});
