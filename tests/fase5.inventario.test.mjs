// Fase 5A — Inventario: recepción de mercadería, historial de costos, alzas de costo y movimientos auditables.
// Ejecutar: npm run test:inventario   (usa .env.test y una base LOCAL que se reinicia)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { env, encenderBase, apagarBase, resetearBase, iniciarServidor, pedir, iniciarSesion } from './helpers.mjs';

process.env.DATABASE_URL = env.DATABASE_URL;
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();

let servidor, token, tokenOperador, provA, provB;
const prod = {};

const ruc = (base10) => {
    const f = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    const r = 11 - (f.reduce((s, x, i) => s + x * Number(base10[i]), 0) % 11);
    return base10 + (r === 10 ? 0 : r === 11 ? 1 : r);
};
const diaIso = (n = 0) => new Date(Date.now() - 5 * 3600000 - n * 86400000).toISOString().slice(0, 10);

/** Factura con líneas; el total se calcula como lo haría el comprobante (base + 18 %) */
let correlativo = 100;
const factura = async (lineas, extra = {}) => {
    const base = lineas.reduce((s, l) => s + Math.round(Number(l.cantidad) * Number(l.valorUnitario) * 100) / 100, 0);
    const igv = Math.round(base * 18) / 100;
    const r = await pedir('POST', '/compras/documentos', {
        token, body: {
            tipo: 'FACTURA', serie: 'F001', numero: String(++correlativo), proveedorId: provA.id, fechaEmision: diaIso(), condicionPago: 'CONTADO',
            moneda: 'PEN', baseImponible: base.toFixed(2), igv: igv.toFixed(2), total: (base + igv).toFixed(2), detalles: lineas, ...extra,
        },
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    return r.data;
};
const recibir = (doc, lineas, t = token) => pedir('POST', `/compras/documentos/${doc.id}/recepcion`, { token: t, body: { lineas } });
const stock = async (id) => (await prisma.producto.findUnique({ where: { id } })).stockActual;
const ficha = async (id) => {
    const r = await pedir('GET', `/inventario/${id}/ficha`, { token });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data;
};

before(async () => {
    await encenderBase();
    resetearBase();
    servidor = await iniciarServidor();
    token = await iniciarSesion('administrador', env.ADMIN_INITIAL_PASSWORD);
    const u = await pedir('POST', '/usuarios', { token, body: { nombre: 'Operador', email: 'oper@prueba.local', password: 'ClaveSegura2026', rol: 'OPERADOR' } });
    assert.equal(u.status, 201, JSON.stringify(u.data));
    tokenOperador = await iniciarSesion('oper@prueba.local', 'ClaveSegura2026');
    provA = (await pedir('POST', '/compras/proveedores', { token, body: { ruc: ruc('2060012345'), razonSocial: 'Repuestos del Norte SAC' } })).data;
    provB = (await pedir('POST', '/compras/proveedores', { token, body: { ruc: ruc('2050098765'), razonSocial: 'Frenos Lima EIRL' } })).data;
    for (const [clave, sku, nombre] of [['pastilla', 'PF-01', 'Pastilla de freno'], ['disco', 'DF-01', 'Disco de freno'], ['liquido', 'LF-01', 'Líquido de frenos'],
        ['embrague', 'KE-01', 'Kit de embrague'], ['rodaje', 'RD-01', 'Rodaje'], ['aceite', 'AC-01', 'Aceite 20W50']]) {
        const r = await pedir('POST', '/inventario', { token, body: { sku, nombre, precio: 100, stockActual: 0 } });
        assert.equal(r.status, 201, JSON.stringify(r.data));
        prod[clave] = r.data;
    }
});

after(async () => {
    await prisma.$disconnect();
    servidor?.detener();
    await apagarBase();
});

test('CASO 8: factura con cinco productos — registrarla no mueve el stock; recibirla sí, una sola vez', async () => {
    const doc = await factura([
        { descripcion: 'Pastilla delantera', cantidad: '4', valorUnitario: '50', productoId: prod.pastilla.id },
        { descripcion: 'Disco ventilado', cantidad: '2', valorUnitario: '120', productoId: prod.disco.id },
        { descripcion: 'Liquido DOT4', cantidad: '6', valorUnitario: '25', productoId: prod.liquido.id },
        { descripcion: 'Kit embrague', cantidad: '1', valorUnitario: '450', productoId: prod.embrague.id },
        { descripcion: 'Rodaje 6204', cantidad: '10', valorUnitario: '15', productoId: prod.rodaje.id },
    ]);
    assert.equal(doc.detalles.length, 5);
    assert.equal(await stock(prod.pastilla.id), 0, 'registrar la factura no suma stock');

    const r = await recibir(doc, doc.detalles.map(d => ({ detalleId: d.id, cantidad: d.cantidad })));
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.documento.estadoRecepcion, 'RECIBIDO');
    assert.deepEqual(
        [await stock(prod.pastilla.id), await stock(prod.disco.id), await stock(prod.liquido.id), await stock(prod.embrague.id), await stock(prod.rodaje.id)],
        [4, 2, 6, 1, 10],
    );
    // Cada ingreso queda con su factura de origen, costo y responsable
    const movs = await prisma.movimientoInventario.findMany({ where: { motivo: 'RECEPCION_COMPRA' } });
    assert.equal(movs.length, 5);
    assert.ok(movs.every(m => m.detalleCompraId && m.responsable && m.costoUnitario));

    // Recibir otra vez la misma factura: no hay nada pendiente
    const otra = await recibir(doc, [{ detalleId: doc.detalles[0].id, cantidad: '1' }]);
    assert.equal(otra.status, 400);
    assert.equal(await stock(prod.pastilla.id), 4);
});

test('recepción parcial, exceso rechazado y dos recepciones simultáneas no superan lo facturado', async () => {
    const doc = await factura([{ descripcion: 'Rodaje 6204', cantidad: '10', valorUnitario: '15', productoId: prod.rodaje.id }]);
    const linea = doc.detalles[0];
    const antes = await stock(prod.rodaje.id);

    const parcial = await recibir(doc, [{ detalleId: linea.id, cantidad: '4' }]);
    assert.equal(parcial.status, 201, JSON.stringify(parcial.data));
    assert.equal(parcial.data.documento.estadoRecepcion, 'PARCIAL');
    assert.equal((await recibir(doc, [{ detalleId: linea.id, cantidad: '7' }])).status, 400, 'solo faltan 6');

    // Dos personas reciben los 6 restantes a la vez: solo una lo logra
    const [a, b] = await Promise.all([recibir(doc, [{ detalleId: linea.id, cantidad: '6' }]), recibir(doc, [{ detalleId: linea.id, cantidad: '6' }])]);
    // La otra se rechaza: 409 si chocaron en la base, 400 si ya no quedaba nada por recibir
    const estados = [a.status, b.status].sort();
    assert.equal(estados[0], 201, JSON.stringify([a.data, b.data]));
    assert.ok([400, 409].includes(estados[1]), JSON.stringify([a.data, b.data]));
    assert.equal(await stock(prod.rodaje.id), antes + 10);
    const det = await prisma.detalleCompra.findUnique({ where: { id: linea.id } });
    assert.equal(det.cantidadRecibida.toString(), '10');
});

test('unidades equivalentes: una caja de 12 suma 12 unidades y el costo se compara por unidad', async () => {
    const porUnidad = await factura([{ descripcion: 'Aceite 20W50 1L', cantidad: '6', valorUnitario: '30', productoId: prod.aceite.id }]);
    assert.equal((await recibir(porUnidad, [{ detalleId: porUnidad.detalles[0].id, cantidad: '6' }])).status, 201);

    // Caja de 12 a S/ 348 (S/ 29 por unidad): no es un alza aunque el precio facturado sea mucho mayor
    const porCaja = await factura([{ descripcion: 'Aceite 20W50 caja x12', unidad: 'CAJA', cantidad: '1', valorUnitario: '348', productoId: prod.aceite.id }]);
    const r = await recibir(porCaja, [{ detalleId: porCaja.detalles[0].id, cantidad: '1', unidadesPorCantidad: '12' }]);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.deepEqual(r.data.avisos, []);
    assert.equal(await stock(prod.aceite.id), 18);

    const f = await ficha(prod.aceite.id);
    assert.equal(f.costos.estadisticas.ultimoPen, '29');
    assert.equal(f.costos.estadisticas.anteriorPen, '30');
    assert.equal(f.costos.estadisticas.alza, false);
    // Una caja aún sin recibir no entra al historial (todavía no se sabe cuántas unidades trae)
    const media = await factura([{ descripcion: 'Aceite caja x12', unidad: 'CAJA', cantidad: '1', valorUnitario: '348', productoId: prod.aceite.id }]);
    assert.equal((await ficha(prod.aceite.id)).costos.compras.length, 2);
    // Un cuarto de caja de 10 son 2.5 unidades: no son unidades enteras
    assert.equal((await recibir(media, [{ detalleId: media.detalles[0].id, cantidad: '0.25', unidadesPorCantidad: '10' }])).status, 400);
});

test('CASOS 9 y 10: historial de precios del repuesto y alerta cuando el costo sube más del 10 %', async () => {
    // Pastilla: primera compra a S/ 50 (caso 8); ahora S/ 58 con otro proveedor (+16 %)
    const cara = await factura([{ descripcion: 'Pastilla delantera', cantidad: '2', valorUnitario: '58', productoId: prod.pastilla.id }], { proveedorId: provB.id });
    const r = await recibir(cara, [{ detalleId: cara.detalles[0].id, cantidad: '2' }]);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.avisos.length, 1);
    assert.match(r.data.avisos[0], /subió 16%/);

    const f = await ficha(prod.pastilla.id);
    const e = f.costos.estadisticas;
    assert.equal(f.costos.compras.length, 2);
    assert.equal(e.ultimoPen, '58');
    assert.equal(e.anteriorPen, '50');
    assert.equal(e.variacionPct, 16);
    assert.equal(e.alza, true);
    assert.equal(e.minimoPen, '50');
    assert.equal(e.maximoPen, '58');
    assert.equal(e.promedioPen, '52.6667'); // ponderado: (4×50 + 2×58) / 6
    assert.equal(e.proveedorMasEconomico.id, provA.id);
    assert.equal(f.costos.proveedores.length, 2);
    // Margen bruto estimado: precio 100 con IGV → 84.75 sin IGV, menos el último costo 58
    assert.equal(f.margen.precioVentaSinIgv, '84.75');
    assert.equal(f.margen.gananciaPorUnidad, '26.75');

    // El Dashboard la lista
    const ind = (await pedir('GET', '/dashboard/indicadores', { token })).data;
    assert.equal(ind.inventario.alzasCosto.cantidad, 1);
    assert.equal(ind.inventario.alzasCosto.principales[0].producto.id, prod.pastilla.id);

    // El porcentaje se configura solo como administrador
    assert.equal((await pedir('PUT', '/inventario/configuracion/umbral-alza-costo', { token: tokenOperador, body: { umbralAlzaCosto: '20' } })).status, 403);
    assert.equal((await pedir('PUT', '/inventario/configuracion/umbral-alza-costo', { token, body: { umbralAlzaCosto: '20' } })).status, 200);
    assert.equal((await pedir('GET', '/dashboard/indicadores', { token })).data.inventario.alzasCosto.cantidad, 0, 'con 20 % ya no es alza');
    await pedir('PUT', '/inventario/configuracion/umbral-alza-costo', { token, body: { umbralAlzaCosto: '10' } });
});

test('ingreso manual: avisa si hay mercadería facturada sin recibir (para no sumar dos veces)', async () => {
    const doc = await factura([{ descripcion: 'Disco ventilado', cantidad: '3', valorUnitario: '120', productoId: prod.disco.id }]);
    const antes = await stock(prod.disco.id);
    const manual = await pedir('POST', '/inventario/movimientos', { token, body: { productoId: prod.disco.id, tipo: 'ENTRADA', cantidad: 3, motivo: 'Proveedor: Repuestos del Norte' } });
    assert.equal(manual.status, 409);
    assert.equal(manual.data.requiereConfirmacion, true);
    assert.equal(manual.data.pendientes.unidades, '3');
    assert.equal(await stock(prod.disco.id), antes, 'no se sumó');

    // Si es otra mercadería, se confirma explícitamente
    const ok = await pedir('POST', '/inventario/movimientos', { token, body: { productoId: prod.disco.id, tipo: 'ENTRADA', cantidad: 1, motivo: 'Devolución de cliente', confirmarSinFactura: true } });
    assert.equal(ok.status, 201, JSON.stringify(ok.data));
    assert.equal(ok.data.stockResultante, antes + 1);
    assert.ok(ok.data.responsable);
    assert.equal(doc.estadoRecepcion, 'PENDIENTE');
});

test('salidas: no dejan el stock en negativo; cantidades inválidas se rechazan', async () => {
    const actual = await stock(prod.embrague.id);
    assert.equal((await pedir('POST', '/inventario/movimientos', { token, body: { productoId: prod.embrague.id, tipo: 'SALIDA', cantidad: actual + 1, motivo: 'Taller' } })).status, 409);
    assert.equal((await pedir('POST', '/inventario/movimientos', { token, body: { productoId: prod.embrague.id, tipo: 'SALIDA', cantidad: 0 } })).status, 400);
    assert.equal((await pedir('POST', '/inventario/movimientos', { token, body: { productoId: prod.embrague.id, tipo: 'SALIDA', cantidad: 1.5 } })).status, 400);
    assert.equal((await pedir('POST', '/inventario/movimientos', { token, body: { productoId: prod.embrague.id, tipo: 'OTRO', cantidad: 1 } })).status, 400);
    assert.equal(await stock(prod.embrague.id), actual);
});

test('corregir el stock al editar deja un ajuste auditado en el historial', async () => {
    const actual = await stock(prod.liquido.id);
    const r = await pedir('PUT', `/inventario/${prod.liquido.id}`, { token, body: { sku: 'LF-01', nombre: 'Líquido de frenos', precio: 30, stockActual: actual - 2 } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const ajuste = (await ficha(prod.liquido.id)).movimientos[0];
    assert.equal(ajuste.motivo, 'AJUSTE');
    assert.equal(ajuste.tipo, 'SALIDA');
    assert.equal(ajuste.cantidad, 2);
    assert.equal(ajuste.stockResultante, actual - 2);
    assert.ok(ajuste.responsable);
});

test('revertir una recepción: solo administrador, una vez, y luego se puede anular la factura', async () => {
    const doc = await factura([{ descripcion: 'Kit embrague', cantidad: '2', valorUnitario: '450', productoId: prod.embrague.id }]);
    const antes = await stock(prod.embrague.id);
    const r = await recibir(doc, [{ detalleId: doc.detalles[0].id, cantidad: '2' }]);
    const movId = r.data.documento.detalles[0].recepciones[0].id;

    assert.equal((await pedir('POST', `/compras/documentos/${doc.id}/anular`, { token, body: { motivo: 'Factura equivocada' } })).status, 409, 'con mercadería recibida no se anula');
    assert.equal((await pedir('POST', `/compras/recepciones/${movId}/revertir`, { token: tokenOperador, body: { motivo: 'Error de digitación' } })).status, 403);
    const rev = await pedir('POST', `/compras/recepciones/${movId}/revertir`, { token, body: { motivo: 'Error de digitación' } });
    assert.equal(rev.status, 200, JSON.stringify(rev.data));
    assert.equal(rev.data.documento.estadoRecepcion, 'PENDIENTE');
    assert.equal(await stock(prod.embrague.id), antes);
    assert.equal((await pedir('POST', `/compras/recepciones/${movId}/revertir`, { token, body: { motivo: 'Otra vez' } })).status, 409);
    assert.equal((await pedir('POST', `/compras/documentos/${doc.id}/anular`, { token, body: { motivo: 'Factura equivocada' } })).status, 200);
});

test('no se recibe: comprobante de servicio, líneas sin producto ni facturas por recibir del Dashboard', async () => {
    const servicio = await factura([{ descripcion: 'Rectificado de discos', cantidad: '1', valorUnitario: '80' }], { estadoRecepcion: 'NO_APLICA' });
    assert.equal((await recibir(servicio, [{ detalleId: servicio.detalles[0].id, cantidad: '1' }])).status, 400);

    const sinEnlace = await factura([{ descripcion: 'Repuesto nuevo sin código', cantidad: '1', valorUnitario: '40' }]);
    const r = await recibir(sinEnlace, [{ detalleId: sinEnlace.detalles[0].id, cantidad: '1' }]);
    assert.equal(r.status, 400);
    assert.match(r.data.error, /elige el producto/);
    // Se puede enlazar al recibir
    const ok = await recibir(sinEnlace, [{ detalleId: sinEnlace.detalles[0].id, cantidad: '1', productoId: prod.rodaje.id }]);
    assert.equal(ok.status, 201, JSON.stringify(ok.data));
    assert.equal(ok.data.documento.detalles[0].producto.id, prod.rodaje.id);

    const ind = (await pedir('GET', '/dashboard/indicadores', { token })).data;
    const lista = (await pedir('GET', '/compras/documentos?porRecibir=1', { token })).data;
    assert.equal(ind.compras.porRecibir, lista.length);
    assert.ok(lista.every(d => ['PENDIENTE', 'PARCIAL'].includes(d.estadoRecepcion)));
});

test('una línea sin producto no se da por recibida; el flete se marca como "no es mercadería"', async () => {
    const doc = await factura([
        { descripcion: 'Pastilla delantera', cantidad: '2', valorUnitario: '50', productoId: prod.pastilla.id },
        { descripcion: 'Disco trasero (aún sin código)', cantidad: '2', valorUnitario: '95' },
        { descripcion: 'Flete Lima', cantidad: '1', valorUnitario: '20' },
    ]);
    const [pastilla, disco, flete] = doc.detalles;
    let r = await recibir(doc, [{ detalleId: pastilla.id, cantidad: '2' }]);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.documento.estadoRecepcion, 'PARCIAL', 'el disco y el flete siguen pendientes');

    r = await recibir(doc, [{ detalleId: flete.id, noInventariable: true }]);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.documento.estadoRecepcion, 'PARCIAL', 'el disco sigue pendiente');
    assert.equal((await recibir(doc, [{ detalleId: flete.id, cantidad: '1', productoId: prod.rodaje.id }])).status, 400, 'el flete ya no se recibe');
    // Una línea con ingresos no se marca como "no es mercadería"
    assert.equal((await recibir(doc, [{ detalleId: pastilla.id, noInventariable: true }])).status, 400);

    r = await recibir(doc, [{ detalleId: disco.id, cantidad: '2', productoId: prod.disco.id }]);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.documento.estadoRecepcion, 'RECIBIDO');
    const lista = (await pedir('GET', '/compras/documentos?porRecibir=1', { token })).data;
    assert.ok(!lista.some(d => d.id === doc.id));
});
