// Fase 5 — Costos de compra por producto.
//
// Todos los costos se comparan en la misma base: soles, sin IGV, por UNIDAD DE INVENTARIO
// (si la factura vende cajas de 10, se divide entre las unidades por caja). Así una compra en
// cajas y otra por unidades son comparables. Nada se sobrescribe: el historial sale de las
// líneas de las facturas de compra vigentes.
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

const redondear2 = (d: Dec) => d.toDecimalPlaces(2, D.ROUND_HALF_UP);

/** Datos mínimos de una línea de compra para calcular su costo */
export interface LineaCosto {
    cantidad: Dec; valorUnitario: Dec; descuento: Dec; afectoIgv: boolean; unidadesPorCantidad: Dec;
    documento: { moneda: string; tipoCambio: Dec | null };
}

/** Importe neto de la línea en soles, sin IGV, con su descuento */
export const netoLineaPen = (l: LineaCosto): Dec => {
    const neto = redondear2(l.cantidad.mul(l.valorUnitario)).sub(l.descuento);
    const tc = l.documento.moneda === 'USD' && l.documento.tipoCambio ? l.documento.tipoCambio : new D(1);
    return neto.mul(tc);
};

/** Unidades de inventario que representa la línea completa */
export const unidadesLinea = (l: LineaCosto): Dec => l.cantidad.mul(l.unidadesPorCantidad);

/** Costo por unidad de inventario, en soles y sin IGV */
export const costoUnitarioPen = (l: LineaCosto): Dec => {
    const u = unidadesLinea(l);
    return u.gt(0) ? netoLineaPen(l).div(u) : new D(0);
};

/**
 * Unidades en las que "1 facturada = 1 de inventario" es seguro. Una compra en otra unidad (CAJA, PAQ…)
 * solo entra al historial cuando se recibe, porque ahí se confirma cuántas unidades trae; antes daría
 * comparaciones falsas (una caja de 12 parecería una unidad 12 veces más cara).
 */
const UNIDADES_SIMPLES = ['UND', 'UNID', 'UNIDAD', 'UNIDADES', 'NIU', 'U', 'PZA', 'PIEZA'];
const costoComparable: Prisma.DetalleCompraWhereInput = {
    OR: [{ cantidadRecibida: { gt: 0 } }, { unidad: { in: UNIDADES_SIMPLES } }],
};

/** Umbral de alza de costo configurado (porcentaje, 10 por defecto) */
export const umbralAlzaCosto = async (): Promise<Dec> =>
    (await prisma.configuracion.findFirst({ select: { umbralAlzaCosto: true } }))?.umbralAlzaCosto ?? new D(10);

const lineaSelect = {
    id: true, cantidad: true, valorUnitario: true, descuento: true, afectoIgv: true, unidadesPorCantidad: true,
    unidad: true, descripcion: true, productoId: true, cantidadRecibida: true,
    documento: {
        select: {
            id: true, codigo: true, tipo: true, serie: true, numero: true, fechaEmision: true, moneda: true, tipoCambio: true,
            proveedor: { select: { id: true, razonSocial: true, ruc: true } },
        },
    },
} as const;

/** Compras vigentes de un producto, de la más antigua a la más reciente */
const comprasDe = (productoId: number) =>
    prisma.detalleCompra.findMany({
        where: { productoId, documento: { estado: 'ACTIVO' }, ...costoComparable },
        select: lineaSelect,
        orderBy: [{ documento: { fechaEmision: 'asc' } }, { id: 'asc' }],
    });

const variacion = (actual: Dec, previo: Dec | undefined) =>
    previo && previo.gt(0) ? actual.sub(previo).div(previo).mul(100).toDecimalPlaces(1).toNumber() : null;

/** Historial y estadísticas de costo de un producto */
export const historialCostos = async (productoId: number, umbral?: Dec) => {
    const limite = umbral ?? await umbralAlzaCosto();
    const lineas = await comprasDe(productoId);

    let previo: Dec | undefined;
    const compras = lineas.map(l => {
        const costo = costoUnitarioPen(l);
        const fila = {
            detalleId: l.id,
            fecha: l.documento.fechaEmision,
            documento: { id: l.documento.id, codigo: l.documento.codigo, tipo: l.documento.tipo, serie: l.documento.serie, numero: l.documento.numero },
            proveedor: l.documento.proveedor,
            descripcion: l.descripcion,
            cantidad: l.cantidad.toString(),
            unidad: l.unidad,
            unidadesPorCantidad: l.unidadesPorCantidad.toString(),
            unidadesInventario: unidadesLinea(l).toString(),
            recibidas: l.cantidadRecibida.mul(l.unidadesPorCantidad).toString(),
            moneda: l.documento.moneda,
            costoUnitarioPen: costo.toDecimalPlaces(4).toString(),
            costoUnitarioConIgvPen: (l.afectoIgv ? costo.mul('1.18') : costo).toDecimalPlaces(4).toString(),
            variacionPct: variacion(costo, previo),
        };
        previo = costo;
        return fila;
    }).reverse(); // la más reciente primero

    if (!compras.length) return { compras, estadisticas: null, umbralAlzaPct: limite.toString() };

    const costos = lineas.map(costoUnitarioPen);
    const totalNeto = lineas.reduce((s, l) => s.add(netoLineaPen(l)), new D(0));
    const totalUnidades = lineas.reduce((s, l) => s.add(unidadesLinea(l)), new D(0));
    const minimo = costos.reduce((m, c) => (c.lt(m) ? c : m), costos[0]);
    const maximo = costos.reduce((m, c) => (c.gt(m) ? c : m), costos[0]);
    const iMin = costos.findIndex(c => c.eq(minimo));
    const ultimo = costos[costos.length - 1];
    const anterior = costos.length > 1 ? costos[costos.length - 2] : null;
    const variacionPct = anterior ? variacion(ultimo, anterior) : null;

    // Proveedores: cuántas veces se le compró y su último costo
    const proveedores = new Map<number, { proveedor: { id: number; razonSocial: string; ruc: string }; compras: number; ultimoCostoPen: string; ultimaFecha: Date; minimoPen: Dec }>();
    lineas.forEach((l, i) => {
        const p = l.documento.proveedor;
        const actual = proveedores.get(p.id);
        proveedores.set(p.id, {
            proveedor: p,
            compras: (actual?.compras ?? 0) + 1,
            ultimoCostoPen: costos[i].toDecimalPlaces(4).toString(),
            ultimaFecha: l.documento.fechaEmision,
            minimoPen: actual && actual.minimoPen.lt(costos[i]) ? actual.minimoPen : costos[i],
        });
    });

    return {
        compras,
        umbralAlzaPct: limite.toString(),
        estadisticas: {
            compras: lineas.length,
            ultimoPen: ultimo.toDecimalPlaces(4).toString(),
            anteriorPen: anterior?.toDecimalPlaces(4).toString() ?? null,
            variacionPct,
            alza: variacionPct !== null && new D(variacionPct).gt(limite),
            promedioPen: totalUnidades.gt(0) ? totalNeto.div(totalUnidades).toDecimalPlaces(4).toString() : null, // ponderado por cantidad
            minimoPen: minimo.toDecimalPlaces(4).toString(),
            maximoPen: maximo.toDecimalPlaces(4).toString(),
            proveedorMasEconomico: lineas[iMin].documento.proveedor,
            fechaUltimaCompra: lineas[lineas.length - 1].documento.fechaEmision,
        },
        proveedores: [...proveedores.values()]
            .sort((a, b) => b.ultimaFecha.getTime() - a.ultimaFecha.getTime())
            .map(p => ({ ...p, minimoPen: p.minimoPen.toDecimalPlaces(4).toString() })),
    };
};

/**
 * Productos cuya última compra costó más que la anterior por encima del umbral.
 * Sirve para el Dashboard y para avisar al registrar una factura.
 */
export const alzasDeCosto = async (opciones: { productoIds?: number[]; umbral?: Dec } = {}) => {
    const limite = opciones.umbral ?? await umbralAlzaCosto();
    const lineas = await prisma.detalleCompra.findMany({
        where: {
            documento: { estado: 'ACTIVO' },
            productoId: opciones.productoIds ? { in: opciones.productoIds } : { not: null },
            ...costoComparable,
        },
        select: { ...lineaSelect, producto: { select: { id: true, sku: true, nombre: true } } },
        orderBy: [{ documento: { fechaEmision: 'asc' } }, { id: 'asc' }],
    });
    const porProducto = new Map<number, typeof lineas>();
    for (const l of lineas) porProducto.set(l.productoId!, [...(porProducto.get(l.productoId!) ?? []), l]);

    const alzas = [];
    for (const ls of porProducto.values()) {
        if (ls.length < 2) continue;
        const ultima = ls[ls.length - 1];
        const ultimo = costoUnitarioPen(ultima);
        const anterior = costoUnitarioPen(ls[ls.length - 2]);
        const pct = variacion(ultimo, anterior);
        if (pct === null || !new D(pct).gt(limite)) continue;
        alzas.push({
            producto: ultima.producto!,
            anteriorPen: anterior.toDecimalPlaces(4).toString(),
            ultimoPen: ultimo.toDecimalPlaces(4).toString(),
            variacionPct: pct,
            proveedor: ultima.documento.proveedor,
            documento: { id: ultima.documento.id, codigo: ultima.documento.codigo },
            fecha: ultima.documento.fechaEmision,
        });
    }
    return { umbralAlzaPct: limite.toString(), alzas: alzas.sort((a, b) => b.variacionPct - a.variacionPct) };
};
