// Fase 3 — Compras, proveedores y cuentas por pagar.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { env, encenderBase, apagarBase, resetearBase, iniciarServidor, pedir, iniciarSesion, BASE } from './helpers.mjs';

process.env.DATABASE_URL = env.DATABASE_URL;
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();

let servidor, token, cuenta, provA, provB;

/** RUC con dígito verificador correcto a partir de 10 dígitos */
const ruc = (base10) => {
    const f = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    const r = 11 - (f.reduce((s, x, i) => s + x * Number(base10[i]), 0) % 11);
    return base10 + (r === 10 ? 0 : r === 11 ? 1 : r);
};
const hoy = () => new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
const diasAtras = (n) => new Date(Date.now() - 5 * 3600000 - n * 86400000).toISOString().slice(0, 10);

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

const factura = (numero, total, extra = {}) => {
    const base = Math.round((total / 1.18) * 100) / 100;
    const igv = Math.round((total - base) * 100) / 100;
    return pedir('POST', '/compras/documentos', {
        token, body: {
            tipo: 'FACTURA', serie: 'F001', numero, proveedorId: provA.id, fechaEmision: hoy(), condicionPago: 'CONTADO',
            moneda: 'PEN', baseImponible: base.toFixed(2), igv: igv.toFixed(2), total: total.toFixed(2), ...extra,
        },
    });
};
const pagar = (body) => pedir('POST', '/compras/pagos', { token, body });
const detalle = async (id) => (await pedir('GET', `/compras/documentos/${id}`, { token })).data;

before(async () => {
    await encenderBase();
    resetearBase();
    servidor = await iniciarServidor();
    token = await iniciarSesion('administrador', env.ADMIN_INITIAL_PASSWORD);
    cuenta = (await pedir('POST', '/bancos/cuentas', { token, body: { banco: 'BCP', nombre: 'BCP Soles', numero: '191-1234567-0-12', moneda: 'PEN' } })).data;
    provA = (await pedir('POST', '/compras/proveedores', { token, body: { ruc: ruc('2060012345'), razonSocial: 'Repuestos del Norte SAC', diasCredito: 30 } })).data;
    provB = (await pedir('POST', '/compras/proveedores', { token, body: { ruc: ruc('2050098765'), razonSocial: 'Frenos Lima EIRL' } })).data;
});

after(async () => {
    await prisma.$disconnect();
    servidor?.detener();
    await apagarBase();
});

test('proveedores: RUC con dígito verificador, sin duplicados y protegido por sesión', async () => {
    assert.ok(provA.id, JSON.stringify(provA));
    assert.equal((await pedir('GET', '/compras/proveedores')).status, 401);
    const malo = await pedir('POST', '/compras/proveedores', { token, body: { ruc: '20600123456', razonSocial: 'X' } });
    if (ruc('2060012345') !== '20600123456') assert.equal(malo.status, 400, 'dígito verificador incorrecto');
    assert.equal((await pedir('POST', '/compras/proveedores', { token, body: { ruc: '123', razonSocial: 'X' } })).status, 400);
    const dup = await pedir('POST', '/compras/proveedores', { token, body: { ruc: provA.ruc, razonSocial: 'Otro' } });
    assert.equal(dup.status, 409);
    assert.equal(dup.data.proveedor.id, provA.id);
});

test('registro de factura: importes cuadrados, detalle de productos y vencimiento por días de crédito', async () => {
    // Base + IGV no coincide con el total
    const mal = await pedir('POST', '/compras/documentos', {
        token, body: { tipo: 'FACTURA', serie: 'F001', numero: '900', proveedorId: provA.id, fechaEmision: hoy(), baseImponible: '100.00', igv: '18.00', total: '150.00' },
    });
    assert.equal(mal.status, 400);

    const r = await pedir('POST', '/compras/documentos', {
        token, body: {
            tipo: 'FACTURA', serie: 'f001', numero: '000123', proveedorId: provA.id, fechaEmision: hoy(), condicionPago: 'CREDITO',
            baseImponible: '200.00', igv: '36.00', total: '236.00',
            detalles: [
                { codigoProveedor: 'DE-01', descripcion: 'Disco de embrague 240mm', unidad: 'und', cantidad: '2', valorUnitario: '80' },
                { descripcion: 'Rodaje de empuje', cantidad: '1', valorUnitario: '40' },
            ],
        },
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    const d = r.data;
    assert.match(d.codigo, /^CP-\d{4}-\d{6}$/);
    assert.equal(d.serie, 'F001');
    assert.equal(d.numero, '123', 'sin ceros a la izquierda');
    assert.equal(d.detalles.length, 2);
    assert.equal(d.detalles[0].igv, '28.8');
    assert.equal(d.detalles[0].total, '188.8');
    assert.equal(d.estadoPago, 'PENDIENTE');
    assert.equal(d.saldo, '236.00');
    const dias = Math.round((new Date(d.fechaVencimiento) - new Date(d.fechaEmision)) / 86400000);
    assert.equal(dias, 30, 'vence con los días de crédito del proveedor');
    assert.equal(d.estadoRecepcion, 'PENDIENTE', 'no mueve inventario al registrarse');

    // La suma de líneas debe coincidir con el total
    const lineasMal = await pedir('POST', '/compras/documentos', {
        token, body: {
            tipo: 'FACTURA', serie: 'F001', numero: '901', proveedorId: provA.id, fechaEmision: hoy(), baseImponible: '100.00', igv: '18.00', total: '118.00',
            detalles: [{ descripcion: 'X', cantidad: '1', valorUnitario: '50' }],
        },
    });
    assert.equal(lineasMal.status, 400);
});

test('CASO 5: la misma factura no se registra dos veces (y se cuenta el intento)', async () => {
    const r1 = await factura('5001', 590);
    assert.equal(r1.status, 201, JSON.stringify(r1.data));
    const r2 = await factura('05001', 590); // mismo número con ceros
    assert.equal(r2.status, 409);
    assert.equal(r2.data.duplicado.id, r1.data.id);
    // Otro proveedor con la misma serie-número sí es otro comprobante
    assert.equal((await factura('5001', 100, { proveedorId: provB.id })).status, 201);
    const resumen = (await pedir('GET', '/compras/resumen', { token })).data;
    assert.ok(resumen.duplicadosDetectados.intentos >= 1);
});

test('CASO 2: transferencia de S/ 3,500 a proveedor, enlazada a su factura', async () => {
    const f = (await factura('7001', 3500)).data;
    const r = await pagar({
        asignaciones: [{ documentoId: f.id, monto: '3500.00' }], origen: 'nuevo', metodoPago: 'Transferencia',
        banco: { cuentaId: cuenta.id, numeroOperacion: 'OP-35000' },
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.match(r.data.transaccion.numero, /^EGR-\d{3}$/);
    assert.equal(r.data.transaccion.monto, 3500);
    const mov = await prisma.movimientoBancario.findUnique({ where: { id: r.data.movimientoBancario.id } });
    assert.equal(mov.tipo, 'EGRESO');
    assert.equal(mov.categoria, 'Pago a proveedor');
    assert.equal(mov.contraparteNombre, 'Repuestos del Norte SAC');
    assert.equal(mov.contraparteDoc, provA.ruc);
    assert.equal(mov.requiereRevision, true, 'supera S/ 2,000');
    assert.equal(mov.transaccionId, r.data.transaccion.id);
    const d = r.data.documentos[0];
    assert.equal(d.estadoPago, 'PAGADO');
    assert.equal(d.saldo, '0.00');
    assert.equal(d.asignaciones[0].transaccion.movimientosBancarios[0].codigo, mov.codigo);
    // Ya pagada: no admite más
    assert.equal((await pagar({ asignaciones: [{ documentoId: f.id, monto: '1.00' }], origen: 'nuevo', metodoPago: 'Efectivo' })).status, 400);
});

test('CASO 6: una factura pagada con dos transferencias (pago parcial)', async () => {
    const f = (await factura('7002', 1000)).data;
    const p1 = await pagar({ asignaciones: [{ documentoId: f.id, monto: '400.00' }], origen: 'nuevo', metodoPago: 'Transferencia', banco: { cuentaId: cuenta.id, numeroOperacion: 'OP-6A' } });
    assert.equal(p1.status, 201, JSON.stringify(p1.data));
    assert.equal(p1.data.documentos[0].estadoPago, 'PARCIAL');
    assert.equal(p1.data.documentos[0].saldo, '600.00');
    // No se puede pagar más que el saldo
    assert.equal((await pagar({ asignaciones: [{ documentoId: f.id, monto: '700.00' }], origen: 'nuevo', metodoPago: 'Transferencia' })).status, 400);
    const p2 = await pagar({ asignaciones: [{ documentoId: f.id, monto: '600.00' }], origen: 'nuevo', metodoPago: 'Yape/Plin', banco: { cuentaId: cuenta.id, numeroOperacion: 'OP-6B' } });
    assert.equal(p2.status, 201, JSON.stringify(p2.data));
    const d = p2.data.documentos[0];
    assert.equal(d.estadoPago, 'PAGADO');
    assert.equal(d.asignaciones.length, 2);
    assert.notEqual(d.asignaciones[0].transaccion.id, d.asignaciones[1].transaccion.id);
});

test('CASO 7: una transferencia ya registrada en el banco cancela varias facturas', async () => {
    const f1 = (await factura('7101', 300)).data;
    const f2 = (await factura('7102', 450)).data;
    const f3 = (await factura('7103', 200)).data;
    // Transferencia registrada antes en Control Bancario (p. ej. desde el extracto)
    const mov = (await pedir('POST', '/bancos/movimientos', {
        token, body: { tipo: 'EGRESO', cuentaId: cuenta.id, metodo: 'TRANSFERENCIA', monto: '850.00', numeroOperacion: 'OP-7', concepto: 'Transferencia a Repuestos del Norte', contraparteNombre: 'Repuestos del Norte SAC' },
    })).data;
    assert.ok(mov.id, JSON.stringify(mov));

    // No alcanza para las tres (950)
    const excede = await pagar({ origen: 'movimiento', movimientoId: mov.id, asignaciones: [{ documentoId: f1.id, monto: '300.00' }, { documentoId: f2.id, monto: '450.00' }, { documentoId: f3.id, monto: '200.00' }] });
    assert.equal(excede.status, 400);

    // 300 + 450 completas y 100 a cuenta de la tercera
    const r = await pagar({ origen: 'movimiento', movimientoId: mov.id, asignaciones: [{ documentoId: f1.id, monto: '300.00' }, { documentoId: f2.id, monto: '450.00' }, { documentoId: f3.id, monto: '100.00' }] });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.deepEqual(r.data.documentos.map(d => d.estadoPago), ['PAGADO', 'PAGADO', 'PARCIAL']);
    const enlazado = await prisma.movimientoBancario.findUnique({ where: { id: mov.id } });
    assert.equal(enlazado.transaccionId, r.data.transaccion.id, 'el movimiento queda enlazado a un único egreso');
    assert.equal(r.data.transaccion.monto, 850);
    // Sin saldo disponible en ese movimiento
    const disp = (await pedir('GET', '/compras/pagos/disponibles', { token })).data;
    assert.ok(!disp.movimientos.some(m => m.id === mov.id));

    // Otra factura de otro proveedor no se mezcla
    const fb = (await factura('7104', 50, { proveedorId: provB.id })).data;
    assert.equal((await pagar({ asignaciones: [{ documentoId: f3.id, monto: '10.00' }, { documentoId: fb.id, monto: '10.00' }], origen: 'nuevo', metodoPago: 'Efectivo' })).status, 400);
});

test('pago con un egreso de caja, quitar el pago de la factura y protección del egreso', async () => {
    const f = (await factura('7201', 500)).data;
    const egreso = (await pedir('POST', '/finanzas/transacciones', {
        token, body: { tipo: 'EGRESO', monto: 800, metodoPago: 'Efectivo', concepto: 'Pago en efectivo a proveedor', categoria: 'Compra de repuestos' },
    })).data;
    const r = await pagar({ origen: 'egreso', transaccionId: egreso.id, asignaciones: [{ documentoId: f.id, monto: '500.00' }] });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    // Quedan 300 disponibles del egreso
    const disp = (await pedir('GET', '/compras/pagos/disponibles', { token })).data;
    assert.equal(disp.egresos.find(e => e.id === egreso.id).disponiblePen, '300.00');

    // El egreso aplicado no se anula ni se reduce por debajo de lo aplicado
    assert.equal((await pedir('PUT', `/finanzas/transacciones/${egreso.id}/anular`, { token })).status, 409);
    assert.equal((await pedir('PUT', `/finanzas/transacciones/${egreso.id}`, { token, body: { monto: 400 } })).status, 409);
    // La factura con pagos no se anula
    assert.equal((await pedir('POST', `/compras/documentos/${f.id}/anular`, { token, body: { motivo: 'Error de registro' } })).status, 409);

    // Quitar el pago: la factura vuelve a pendiente
    const asig = (await detalle(f.id)).asignaciones[0];
    const q = await pedir('POST', `/compras/asignaciones/${asig.id}/anular`, { token, body: { motivo: 'Se aplicó a la factura equivocada' } });
    assert.equal(q.status, 200, JSON.stringify(q.data));
    assert.equal(q.data.documento.estadoPago, 'PENDIENTE');
    assert.equal(q.data.documento.saldo, '500.00');
    assert.ok(q.data.avisos.length);
    // Ahora sí se anulan
    assert.equal((await pedir('POST', `/compras/documentos/${f.id}/anular`, { token, body: { motivo: 'Error de registro' } })).status, 200);
    assert.equal((await pedir('PUT', `/finanzas/transacciones/${egreso.id}/anular`, { token })).status, 200);
});

test('revisión exige el comprobante adjunto; contabilidad y cuentas por pagar con vencidas', async () => {
    const f = (await factura('7301', 236, { condicionPago: 'CREDITO', fechaEmision: diasAtras(40), fechaVencimiento: diasAtras(10) })).data;
    assert.equal((await pedir('POST', `/compras/documentos/${f.id}/revision`, { token, body: { resultado: 'REVISADO' } })).status, 400, 'sin archivo');
    assert.equal((await pedir('POST', `/compras/documentos/${f.id}/revision`, { token, body: { resultado: 'OBSERVADO' } })).status, 400, 'sin nota');

    const fd = new FormData();
    fd.append('archivos', new Blob([PDF], { type: 'application/pdf' }), 'factura-7301.pdf');
    const up = await fetch(`${BASE}/compras/documentos/${f.id}/archivos`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
    assert.equal(up.status, 201, await up.clone().text());
    const enlace = await pedir('GET', `/compras/archivos/${(await up.json()).archivos[0].id}/enlace`, { token });
    assert.equal(enlace.status, 200);
    assert.ok(enlace.data.url);

    const rev = await pedir('POST', `/compras/documentos/${f.id}/revision`, { token, body: { resultado: 'REVISADO' } });
    assert.equal(rev.status, 200, JSON.stringify(rev.data));
    assert.equal(rev.data.estadoRevision, 'REVISADO');
    // Revisado: los importes ya no se cambian
    await pedir('PUT', `/compras/documentos/${f.id}`, { token, body: { total: '999.00', observaciones: 'Entregar a la contadora' } });
    const d = await detalle(f.id);
    assert.equal(d.total, '236');
    assert.equal(d.observaciones, 'Entregar a la contadora');

    const c = await pedir('POST', `/compras/documentos/${f.id}/contabilidad`, { token, body: { entregado: true } });
    assert.equal(c.data.entregadoContabilidad, true);

    const cxp = (await pedir('GET', '/compras/por-pagar', { token })).data;
    const fila = cxp.documentos.find(x => x.id === f.id);
    assert.equal(fila.vencido, true);
    assert.ok(fila.diasVencido >= 10);
    assert.ok(cxp.resumen.vencidos >= 1);
    assert.ok(!cxp.documentos.some(x => x.estadoPago === 'PAGADO'));
});

test('CASO 9: historial de precios de un producto entre dos proveedores', async () => {
    const producto = await prisma.producto.create({ data: { sku: 'PAST-01', nombre: 'Pastillas de freno', precio: 120 } });
    const linea = (valor) => [{ descripcion: 'Pastillas de freno delanteras', unidad: 'JGO', cantidad: '2', valorUnitario: valor, productoId: producto.id }];
    const doc = (prov, numero, valor, dias) => {
        const base = (2 * Number(valor)).toFixed(2);
        const igv = (2 * Number(valor) * 0.18).toFixed(2);
        return pedir('POST', '/compras/documentos', {
            token, body: {
                tipo: 'FACTURA', serie: 'F002', numero, proveedorId: prov.id, fechaEmision: diasAtras(dias),
                baseImponible: base, igv, total: (Number(base) + Number(igv)).toFixed(2), detalles: linea(valor),
            },
        });
    };
    assert.equal((await doc(provA, '1', '50.00', 20)).status, 201);
    assert.equal((await doc(provB, '1', '45.00', 10)).status, 201);
    assert.equal((await doc(provA, '2', '55.00', 1)).status, 201);

    const h = (await pedir('GET', `/compras/historial?productoId=${producto.id}`, { token })).data;
    assert.equal(h.lineas.length, 3);
    assert.equal(h.lineas[0].costoUnitarioPen, '55', 'la más reciente primero');
    assert.equal(h.lineas[0].variacionPct, 22.2, '55 frente a 45');
    const e = h.estadisticas.find(x => x.unidad === 'JGO');
    assert.equal(e.compras, 3);
    assert.equal(e.minimoPen, '45');
    assert.equal(e.maximoPen, '55');
    assert.equal(e.ultimoPen, '55');
    assert.equal(e.proveedorMasEconomico.id, provB.id);
    assert.equal((await prisma.producto.findUnique({ where: { id: producto.id } })).stockActual, 0, 'registrar compras no cambia el stock');
});
