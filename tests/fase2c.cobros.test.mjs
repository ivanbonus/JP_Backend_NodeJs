// Fase 2C — Cobros: pagos en partes (adelantos), pedidos web por verificar y su registro en Control Bancario.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { env, encenderBase, apagarBase, resetearBase, iniciarServidor, pedir, iniciarSesion } from './helpers.mjs';

process.env.DATABASE_URL = env.DATABASE_URL;
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();

let servidor, token, cuenta, producto;

const dashboard = async () => (await pedir('GET', '/dashboard', { token })).data.kpis;
const nuevaVenta = async (monto, extra = {}) => {
    const r = await pedir('POST', '/finanzas/transacciones', {
        token, body: { tipo: 'INGRESO', monto, metodoPago: 'Efectivo', concepto: 'Reparación de embrague', categoria: 'Servicio', estado: 'PENDIENTE', clienteNombre: 'Carlos Ruiz', ...extra },
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data;
};
const pagar = (id, body) => pedir('POST', `/finanzas/transacciones/${id}/pagos`, { token, body });
const pedidoWeb = (cantidad, extra = {}) => pedir('POST', '/web/ventas', {
    body: { clienteNombre: 'Ana Torres', clienteDoc: '45678912', metodoPago: 'Yape/Plin', monto: 1, productos: [{ id: producto.id, cantidad, precio: 0.01 }], ...extra },
});
const stock = async () => (await prisma.producto.findUnique({ where: { id: producto.id } })).stockActual;

before(async () => {
    await encenderBase();
    resetearBase();
    servidor = await iniciarServidor();
    token = await iniciarSesion('administrador', env.ADMIN_INITIAL_PASSWORD);
    cuenta = (await pedir('POST', '/bancos/cuentas', { token, body: { banco: 'BCP', nombre: 'BCP Soles', numero: '191-1234567-0-12', moneda: 'PEN' } })).data;
    producto = await prisma.producto.create({ data: { sku: 'DISCO-01', nombre: 'Disco de embrague', precio: 50, stockActual: 5, visibleEnWeb: true } });
});

after(async () => {
    await prisma.$disconnect();
    servidor?.detener();
    await apagarBase();
});

test('adelanto y pago del saldo: cada pago entra a caja el día que se recibe y la venta no se cuenta dos veces', async () => {
    const antes = await dashboard();
    const venta = await nuevaVenta(300);
    assert.equal(venta.estado, 'PENDIENTE');

    // Adelanto en efectivo
    const p1 = await pagar(venta.id, { monto: 100, metodoPago: 'Efectivo' });
    assert.equal(p1.status, 201, JSON.stringify(p1.data));
    assert.match(p1.data.pago.numero, /^PAG-\d{3}$/);
    assert.equal(p1.data.pago.ventaId, venta.id);
    assert.equal(p1.data.pago.estado, 'COMPLETADO');
    assert.match(p1.data.pago.concepto, /^Adelanto de /);
    assert.equal(p1.data.venta.estado, 'PARCIAL');
    assert.equal(p1.data.venta.pagoEnPartes, true);
    assert.equal(p1.data.venta.saldo, 200);

    // No se puede cobrar más que el saldo
    assert.equal((await pagar(venta.id, { monto: 250, metodoPago: 'Efectivo' })).status, 400);
    // Método desconocido
    assert.equal((await pagar(venta.id, { monto: 10, metodoPago: 'Bitcoin' })).status, 400);

    // Saldo por Yape, registrado también en el banco
    const p2 = await pagar(venta.id, { monto: 200, metodoPago: 'Yape/Plin', banco: { cuentaId: cuenta.id, numeroOperacion: 'YP-778899' } });
    assert.equal(p2.status, 201, JSON.stringify(p2.data));
    assert.match(p2.data.pago.concepto, /^Pago a cuenta de /);
    assert.equal(p2.data.venta.estado, 'COMPLETADO');
    assert.equal(p2.data.venta.saldo, 0);
    const mov = p2.data.movimientoBancario;
    assert.equal(mov.transaccionId, p2.data.pago.id, 'el movimiento bancario queda enlazado al pago');
    assert.equal(mov.metodo, 'YAPE');
    assert.equal(mov.montoPen, '200');
    assert.equal(mov.categoria, 'Venta / servicio');

    // Ya está cobrada
    assert.equal((await pagar(venta.id, { monto: 1, metodoPago: 'Efectivo' })).status, 409);

    // Dashboard: entra 300 (100 + 200), no 600
    const despues = await dashboard();
    assert.equal(Math.round((despues.ingresoHoy - antes.ingresoHoy) * 100) / 100, 300);

    // El detalle trae los pagos con su movimiento bancario
    const det = await pedir('GET', `/finanzas/transacciones/${venta.id}/pagos`, { token });
    assert.equal(det.status, 200);
    assert.equal(det.data.pagos.length, 2);
    assert.equal(det.data.pagado, 300);
    assert.equal(det.data.pagos[1].movimientosBancarios[0].codigo, mov.codigo);
});

test('reglas de edición y anulación con pagos en partes', async () => {
    const venta = await nuevaVenta(500);
    const p1 = (await pagar(venta.id, { monto: 200, metodoPago: 'Transferencia', banco: { cuentaId: cuenta.id, numeroOperacion: '55501' } })).data;
    assert.equal(p1.movimientoBancario.categoria, 'Adelanto de cliente');
    await pagar(venta.id, { monto: 100, metodoPago: 'Efectivo' });

    // La venta no cambia de estado a mano ni baja de lo cobrado
    assert.equal((await pedir('PUT', `/finanzas/transacciones/${venta.id}`, { token, body: { estado: 'COMPLETADO' } })).status, 409);
    assert.equal((await pedir('PUT', `/finanzas/transacciones/${venta.id}`, { token, body: { monto: 250 } })).status, 409);
    // Subir el total sí (sigue parcial)
    const sube = await pedir('PUT', `/finanzas/transacciones/${venta.id}`, { token, body: { monto: 600 } });
    assert.equal(sube.status, 200, JSON.stringify(sube.data));
    assert.equal(sube.data.estado, 'PARCIAL');
    // Bajar el total a lo cobrado la deja saldada
    const baja = await pedir('PUT', `/finanzas/transacciones/${venta.id}`, { token, body: { monto: 300 } });
    assert.equal(baja.data.estado, 'COMPLETADO');
    await pedir('PUT', `/finanzas/transacciones/${venta.id}`, { token, body: { monto: 500 } });

    // Un pago no se edita, solo su nota
    assert.equal((await pedir('PUT', `/finanzas/transacciones/${p1.pago.id}`, { token, body: { monto: 150 } })).status, 409);
    assert.equal((await pedir('PUT', `/finanzas/transacciones/${p1.pago.id}`, { token, body: { nota: 'Voucher en WhatsApp' } })).status, 200);
    // No se puede poner PARCIAL a mano
    const otra = await nuevaVenta(80);
    assert.equal((await pedir('PUT', `/finanzas/transacciones/${otra.id}`, { token, body: { estado: 'PARCIAL' } })).status, 400);

    // La venta con pagos activos no se anula
    assert.equal((await pedir('PUT', `/finanzas/transacciones/${venta.id}/anular`, { token })).status, 409);

    // Anular el adelanto: avisa que sigue en el banco y la venta recalcula su saldo
    const an = await pedir('PUT', `/finanzas/transacciones/${p1.pago.id}/anular`, { token, body: { motivo: 'Transferencia rebotada' } });
    assert.equal(an.status, 200, JSON.stringify(an.data));
    assert.match(an.data.avisos[0], /Control Bancario/);
    const det = (await pedir('GET', `/finanzas/transacciones/${venta.id}/pagos`, { token })).data;
    assert.equal(det.estado, 'PARCIAL');
    assert.equal(det.pagado, 100);
    assert.equal(det.saldo, 400);
});

test('venta pagada de una vez: no crea pagos sueltos', async () => {
    const venta = await nuevaVenta(150);
    const r = await pagar(venta.id, { monto: 150, metodoPago: 'Tarjeta' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.pago.id, venta.id);
    assert.equal(r.data.venta.estado, 'COMPLETADO');
    assert.equal(r.data.venta.metodoPago, 'Tarjeta');
    assert.equal(r.data.venta.pagoEnPartes, false);
    assert.equal(await prisma.transaccion.count({ where: { ventaId: venta.id } }), 0);
});

test('pedido web: precio del servidor, stock reservado y POR_VERIFICAR (no es ingreso)', async () => {
    const antes = await dashboard();
    const r = await pedidoWeb(2, { operacionCliente: ' 1234 5678 ' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.estado, 'POR_VERIFICAR');
    assert.equal(r.data.monto, 100, 'precio de la base (2 × 50), no el que envió el navegador');
    assert.ok(r.data.boletaToken);
    assert.equal(await stock(), 3);
    const guardado = await prisma.transaccion.findUnique({ where: { id: r.data.id } });
    assert.equal(guardado.operacionCliente, '12345678');

    // Sin stock suficiente
    const sin = await pedidoWeb(10);
    assert.equal(sin.status, 409);
    assert.match(sin.data.error, /stock/i);
    assert.equal(await stock(), 3, 'un pedido rechazado por stock no descuenta nada');
    // Producto no visible en la web
    const oculto = await prisma.producto.create({ data: { sku: 'OCULTO', nombre: 'Interno', precio: 10, stockActual: 9, visibleEnWeb: false } });
    assert.equal((await pedir('POST', '/web/ventas', { body: { clienteNombre: 'X', metodoPago: 'Efectivo', productos: [{ id: oculto.id, cantidad: 1 }] } })).status, 400);

    // No es ingreso hasta verificarlo
    const d = await dashboard();
    assert.equal(d.ingresoHoy, antes.ingresoHoy);

    // No se cobra ni se cambia de estado por las vías normales
    assert.equal((await pagar(r.data.id, { monto: 100, metodoPago: 'Yape/Plin' })).status, 409);
    assert.equal((await pedir('PUT', `/finanzas/transacciones/${r.data.id}`, { token, body: { estado: 'COMPLETADO' } })).status, 409);

    // Confirmar un Yape exige el banco
    const sinBanco = await pedir('POST', `/finanzas/transacciones/${r.data.id}/verificar`, { token, body: { accion: 'confirmar' } });
    assert.equal(sinBanco.status, 400);
    const ok = await pedir('POST', `/finanzas/transacciones/${r.data.id}/verificar`, {
        token, body: { accion: 'confirmar', banco: { cuentaId: cuenta.id, numeroOperacion: '12345678' } },
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal(ok.data.pedido.estado, 'COMPLETADO');
    assert.ok(ok.data.pedido.verificadoPor);
    assert.equal(ok.data.movimientoBancario.transaccionId, r.data.id);
    assert.equal(ok.data.movimientoBancario.metodo, 'YAPE');
    const d2 = await dashboard();
    assert.equal(Math.round((d2.ingresoHoy - antes.ingresoHoy) * 100) / 100, 100);
    // No se verifica dos veces
    assert.equal((await pedir('POST', `/finanzas/transacciones/${r.data.id}/verificar`, { token, body: { accion: 'confirmar' } })).status, 409);
});

test('pedido web rechazado: anulado con motivo y stock devuelto', async () => {
    const inicial = await stock();
    const r = await pedidoWeb(1, { metodoPago: 'Transferencia' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(await stock(), inicial - 1);
    assert.equal((await pedir('POST', `/finanzas/transacciones/${r.data.id}/verificar`, { token, body: { accion: 'rechazar', motivo: 'no' } })).status, 400);
    const rech = await pedir('POST', `/finanzas/transacciones/${r.data.id}/verificar`, { token, body: { accion: 'rechazar', motivo: 'El pago nunca llegó' } });
    assert.equal(rech.status, 200, JSON.stringify(rech.data));
    assert.equal(rech.data.pedido.estado, 'ANULADO');
    assert.equal(rech.data.pedido.motivoAnulacion, 'El pago nunca llegó');
    assert.equal(rech.data.productosDevueltos, 1);
    assert.equal(await stock(), inicial);
});

test('pedido web confirmado enlazando un movimiento que ya estaba en el banco', async () => {
    const r = await pedidoWeb(1, { metodoPago: 'Transferencia' }); // S/ 50
    const mov = (await pedir('POST', '/bancos/movimientos', {
        token, body: { tipo: 'INGRESO', cuentaId: cuenta.id, metodo: 'TRANSFERENCIA', monto: '50.00', numeroOperacion: '909090', concepto: 'Transferencia Ana Torres', contraparteNombre: 'Ana Torres' },
    })).data;
    const distinto = (await pedir('POST', '/bancos/movimientos', {
        token, body: { tipo: 'INGRESO', cuentaId: cuenta.id, metodo: 'TRANSFERENCIA', monto: '49.00', numeroOperacion: '909091', concepto: 'Otro', contraparteNombre: 'Otro' },
    })).data;
    assert.equal((await pedir('POST', `/finanzas/transacciones/${r.data.id}/verificar`, { token, body: { accion: 'confirmar', movimientoId: distinto.id } })).status, 409, 'monto distinto');
    const ok = await pedir('POST', `/finanzas/transacciones/${r.data.id}/verificar`, { token, body: { accion: 'confirmar', movimientoId: mov.id } });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    const enlazado = await prisma.movimientoBancario.findUnique({ where: { id: mov.id } });
    assert.equal(enlazado.transaccionId, r.data.id);
    // Ese movimiento ya no sirve para otro pedido
    const r2 = await pedidoWeb(1, { metodoPago: 'Transferencia' });
    assert.equal((await pedir('POST', `/finanzas/transacciones/${r2.data.id}/verificar`, { token, body: { accion: 'confirmar', movimientoId: mov.id } })).status, 409);
});

test('venta o egreso cobrado por transferencia: se registra en el banco en la misma operación', async () => {
    const r = await pedir('POST', '/finanzas/transacciones', {
        token, body: { tipo: 'INGRESO', monto: 80, metodoPago: 'Transferencia', concepto: 'Cambio de pastillas', categoria: 'Servicio', clienteNombre: 'Luis Paz', banco: { cuentaId: cuenta.id, numeroOperacion: '700100' } },
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.movimientoBancario.transaccionId, r.data.id);

    // N.º de operación repetido en la cuenta: no se crea nada (ni la venta)
    const antes = await prisma.transaccion.count();
    const rep = await pedir('POST', '/finanzas/transacciones', {
        token, body: { tipo: 'INGRESO', monto: 80, metodoPago: 'Transferencia', concepto: 'Duplicado', clienteNombre: 'Luis Paz', banco: { cuentaId: cuenta.id, numeroOperacion: '700100' } },
    });
    assert.equal(rep.status, 409);
    assert.equal(await prisma.transaccion.count(), antes, 'la venta no queda a medias');

    // Egreso a proveedor por transferencia
    const eg = await pedir('POST', '/finanzas/transacciones', {
        token, body: { tipo: 'EGRESO', monto: 120, metodoPago: 'Transferencia', concepto: 'Compra de discos', categoria: 'Compra de repuestos', banco: { cuentaId: cuenta.id, numeroOperacion: '700200' } },
    });
    assert.equal(eg.status, 201, JSON.stringify(eg.data));
    assert.equal(eg.data.movimientoBancario.tipo, 'EGRESO');
    assert.equal(eg.data.movimientoBancario.categoria, 'Compra de repuestos');

    // Una venta pendiente no se registra en el banco
    assert.equal((await pedir('POST', '/finanzas/transacciones', {
        token, body: { tipo: 'INGRESO', monto: 10, metodoPago: 'Transferencia', concepto: 'X', estado: 'PENDIENTE', banco: { cuentaId: cuenta.id } },
    })).status, 400);
});
