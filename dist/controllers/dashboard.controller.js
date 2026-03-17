"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDashboardData = void 0;
const index_1 = require("../index");
const getDashboardData = async (req, res) => {
    try {
        const hoyDate = new Date();
        const hoyStr = hoyDate.toLocaleDateString('en-GB'); // DD/MM/YYYY
        const mesActual = hoyDate.getMonth(); // 0-11
        const anioActual = hoyDate.getFullYear();
        // 1. Obtener todas las transacciones para calcular flujos y distribuciones
        const transacciones = await index_1.prisma.transaccion.findMany({
            include: {
                cliente: true
            },
            orderBy: {
                id: 'desc'
            }
        });
        let ingresoHoy = 0;
        let egresoHoy = 0;
        let ingresoMes = 0;
        let egresoMes = 0;
        let porCobrar = 0;
        const ingresosPorMetodo = {};
        const egresosPorCategoria = {};
        // Array para gráfica (12 meses)
        const ingresosData = Array(12).fill(0);
        const egresosData = Array(12).fill(0);
        const ultimasTxns = [];
        for (const txn of transacciones) {
            const isIngreso = txn.tipo === 'INGRESO';
            const isEgreso = txn.tipo === 'EGRESO';
            // Aseguramos parsear las fechas de las transacciones (ej: "17/3/2026")
            // a veces vienen como "17/03/2026", "1/3/2026", etc.
            const partesFecha = txn.fecha.split('/');
            let diaTxn = 0;
            let mesTxn = 0;
            let anioTxn = 0;
            if (partesFecha.length === 3) {
                diaTxn = parseInt(partesFecha[0], 10);
                mesTxn = parseInt(partesFecha[1], 10) - 1; // 0-indexed para coincidir con getMonth()
                anioTxn = parseInt(partesFecha[2], 10);
            }
            // Últimas transacciones (top 6 global)
            if (ultimasTxns.length < 6) {
                ultimasTxns.push({
                    id: txn.numero,
                    cliente: txn.cliente?.nombre || txn.clienteNombre || 'Cliente no registrado',
                    concepto: txn.concepto,
                    metodo: txn.metodoPago,
                    monto: txn.monto,
                    tipo: txn.tipo.toLowerCase(),
                    estado: txn.estado === 'COMPLETADO' ? (isIngreso ? 'Cobrado' : 'Pagado') : (txn.estado.charAt(0) + txn.estado.slice(1).toLowerCase())
                });
            }
            if (txn.estado === 'PENDIENTE' && isIngreso) {
                porCobrar++;
            }
            // Cálculos mensuales (año actual)
            if (anioTxn === anioActual && txn.estado === 'COMPLETADO') {
                if (isIngreso)
                    ingresosData[mesTxn] += txn.monto;
                if (isEgreso)
                    egresosData[mesTxn] += txn.monto;
                // Mes actual
                if (mesTxn === mesActual) {
                    if (isIngreso)
                        ingresoMes += txn.monto;
                    if (isEgreso)
                        egresoMes += txn.monto;
                }
            }
            // Cálculos de HOY (coincide formato fecha DD/MM/YYYY)
            if (txn.fecha === hoyStr || (diaTxn === hoyDate.getDate() && mesTxn === mesActual && anioTxn === anioActual)) {
                if (txn.estado === 'COMPLETADO') {
                    if (isIngreso) {
                        ingresoHoy += txn.monto;
                        // Distribución métodos de pago (hoy)
                        const metodo = txn.metodoPago === 'TRANSFERENCIA' ? 'Transferencia' :
                            (txn.metodoPago === 'TARJETA' ? 'Tarjeta' :
                                (txn.metodoPago === 'YAPE' || txn.metodoPago === 'PLIN' ? 'Yape/Plin' : 'Efectivo'));
                        ingresosPorMetodo[metodo] = (ingresosPorMetodo[metodo] || 0) + txn.monto;
                    }
                    if (isEgreso) {
                        egresoHoy += txn.monto;
                        // Distribución categorías de egreso (hoy)
                        const cat = txn.categoria || 'Otros';
                        egresosPorCategoria[cat] = (egresosPorCategoria[cat] || 0) + txn.monto;
                    }
                }
            }
        }
        // Formatear distribuciones para el frontend
        const distribPago = [];
        const colorMetodos = { "Efectivo": "#22c55e", "Tarjeta": "#3b82f6", "Transferencia": "#8b5cf6", "Yape/Plin": "#ec4899" };
        for (const [label, monto] of Object.entries(ingresosPorMetodo)) {
            const pct = ingresoHoy > 0 ? Math.round((monto / ingresoHoy) * 100) : 0;
            distribPago.push({ label, pct, color: colorMetodos[label] || "#94a3b8" });
        }
        // Llenar faltantes en caso de venir vacíos
        ["Efectivo", "Tarjeta", "Transferencia", "Yape/Plin"].forEach(m => {
            if (!distribPago.find(d => d.label === m))
                distribPago.push({ label: m, pct: 0, color: colorMetodos[m] });
        });
        distribPago.sort((a, b) => b.pct - a.pct); // Orden descendente
        const distribEgresos = [];
        const colorCats = { "Repuestos": "#ef4444", "Servicios": "#f97316", "Personal": "#eab308", "Otros": "#94a3b8" };
        for (const [label, monto] of Object.entries(egresosPorCategoria)) {
            const pct = egresoHoy > 0 ? Math.round((monto / egresoHoy) * 100) : 0;
            // Normalizar nombres de categorías si difieren a los del diseño original ("Compra repuestos", "Servicios", "Personal", "Otros")
            let catFront = label;
            if (label.toLowerCase().includes('repuesto'))
                catFront = 'Compra repuestos';
            if (label.toLowerCase().includes('servicio'))
                catFront = 'Servicios';
            if (label.toLowerCase().includes('personal') || label.toLowerCase().includes('planilla'))
                catFront = 'Personal';
            distribEgresos.push({ label: catFront, pct, color: colorCats[label] || "#94a3b8" });
        }
        if (distribEgresos.length === 0) {
            distribEgresos.push({ label: "Compra repuestos", pct: 0, color: "#ef4444" }, { label: "Servicios", pct: 0, color: "#f97316" }, { label: "Personal", pct: 0, color: "#eab308" }, { label: "Otros", pct: 0, color: "#94a3b8" });
        }
        const vehiculosEnTallerCount = await index_1.prisma.numeroGuia.count({
            where: {
                estado: 'EN_PROCESO'
            }
        });
        res.json({
            kpis: {
                ingresoHoy,
                egresoHoy,
                balanceHoy: ingresoHoy - egresoHoy,
                margenHoy: ingresoHoy > 0 ? Math.round(((ingresoHoy - egresoHoy) / ingresoHoy) * 100) : 0,
                ingresoMes,
                egresoMes,
                porCobrar,
                vehiculosTaller: vehiculosEnTallerCount,
            },
            chartData: {
                ingresosData,
                egresosData
            },
            distribuciones: {
                distribPago,
                distribEgresos
            },
            ultimasTxns
        });
    }
    catch (error) {
        console.error('Error al obtener datos del dashboard:', error);
        res.status(500).json({ error: 'Error del servidor al obtener datos' });
    }
};
exports.getDashboardData = getDashboardData;
