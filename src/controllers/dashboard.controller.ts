import { Request, Response } from 'express';
import { prisma } from '../prisma';
import { partesLima, parsearFecha } from '../utils/fechas';
import { normalizarMetodoPago, ETIQUETA_METODO, esSaldoInicial } from '../utils/caja';

export const getDashboardData = async (req: Request, res: Response) => {
  try {
    const hoyDate = new Date();
    // "Hoy" y "este mes" según la hora de Lima (el servidor corre en UTC)
    const lima = partesLima(hoyDate);
    const diaActual = lima.dia;
    const mesActual = lima.mes - 1; // 0-11
    const anioActual = lima.anio;

    // Solo los campos necesarios y solo lo que se usa: transacciones del año actual
    // (las fechas se guardan como texto "DD/MM/YYYY") y las pendientes de cobro de cualquier fecha.
    // Antes se cargaba toda la historia con sus clientes en memoria en cada visita.
    const camposTxn = {
      id: true, numero: true, tipo: true, monto: true, metodoPago: true, concepto: true,
      categoria: true, estado: true, fecha: true, clienteNombre: true, pagoEnPartes: true,
      cliente: { select: { nombre: true } },
      // Lo ya cobrado de las ventas pagadas en partes (para el saldo por cobrar)
      pagos: { where: { estado: 'COMPLETADO' }, select: { monto: true } },
    } as const;

    const [transacciones, recientes] = await Promise.all([
      prisma.transaccion.findMany({
        where: { OR: [{ fecha: { endsWith: `/${anioActual}` } }, { estado: { in: ['PENDIENTE', 'PARCIAL', 'POR_VERIFICAR'] }, tipo: 'INGRESO' }] },
        select: camposTxn,
        orderBy: { id: 'desc' },
      }),
      // Últimos movimientos (sin importar el año), para la tarjeta de "últimas transacciones"
      prisma.transaccion.findMany({ select: camposTxn, orderBy: { id: 'desc' }, take: 12 }),
    ]);

    // Solo las órdenes terminadas generan alerta de "vehículo listo"
    const guias = await prisma.numeroGuia.findMany({
      where: { estado: 'FINALIZADO' },
      select: {
        id: true,
        estado: true,
        cliente: { select: { nombre: true } },
        vehiculo: { select: { marca: true, modelo: true, placa: true } },
      },
      orderBy: { id: 'desc' },
    });

    const trabajadores = await prisma.trabajador.findMany({
        where: { estado: true }
    });

    const cotizacionesPendientes = await prisma.cotizacion.findMany({
        where: { estado: 'PENDIENTE' },
        orderBy: { fecha: 'desc' }
    });

    const reclamacionesPendientes = await prisma.reclamacion.findMany({
        where: { estado: 'PENDIENTE' },
        orderBy: { fecha: 'desc' }
    });

    const postulacionesRevision = await prisma.postulacion.findMany({
        where: { estado: 'REVISION' },
        orderBy: { fecha: 'desc' }
    });

    let ingresoHoy = 0;
    let egresoHoy = 0;
    let ingresoMes = 0;
    let egresoMes = 0;
    let porCobrar = 0;

    const ingresosPorMetodo: Record<string, number> = {};
    const egresosPorMetodo: Record<string, number> = {};
    const egresosPorCategoria: Record<string, number> = {};

    // Array para gráfica (12 meses)
    const ingresosData = Array(12).fill(0);
    const egresosData = Array(12).fill(0);

    const ultimasTxns = [];
    const alertasBackend = [];
    let contadorPagosPorCobrar = 0;
    let montoPagosPorCobrar = 0;

    // Generar alertas por Vehículo Listo (Ordenes en estado FINALIZADO)
    for (const guia of guias) {
        if (guia.estado === 'FINALIZADO') {
            alertasBackend.push({
                key: `vehiculo-listo-${guia.id}`,
                tipo: 'taller',
                color: 'navy',
                titulo: 'Vehículo listo',
                desc: `${guia.vehiculo.marca} ${guia.vehiculo.modelo} — ${guia.vehiculo.placa} completada, avise al cliente ${guia.cliente.nombre}`,
                leida: false
            });
        }
    }

    // Generar alertas por pago de personal a <= 3 días
    for (const trabajador of trabajadores) {
       if(trabajador.proximoPago) {
           const fechaPago = new Date(trabajador.proximoPago); // YYYY-MM-DD
           const diffTime = Math.abs(fechaPago.getTime() - hoyDate.getTime());
           const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
           
           if(fechaPago >= hoyDate && diffDays <= 3) {
               alertasBackend.push({
                   key: `pago-personal-${trabajador.id}`,
                   tipo: 'pago',
                   color: 'orange',
                   titulo: 'Pago de personal cercano',
                   desc: `El pago de ${trabajador.nombre} ${trabajador.apellidos} está programado para el ${trabajador.proximoPago}.`,
                   leida: false
               });
           }
       }
    }

    // Generar alertas por cotizaciones web pendientes
    for (const ctz of cotizacionesPendientes) {
        alertasBackend.push({
             key: `cotizacion-${ctz.id}`,
             tipo: 'cotizacion',
             color: 'blue',
             titulo: 'Nueva Cotización',
             desc: `${ctz.nombre} solicitó cotizar su ${ctz.vehiculo} (${ctz.servicio}). Teléf: ${ctz.telefono}`,
             leida: false
        });
    }

    // Generar alertas por reclamaciones pendientes
    for (const rec of reclamacionesPendientes) {
        alertasBackend.push({
             key: `reclamacion-${rec.id}`,
             tipo: 'reclamacion',
             color: 'orange',
             titulo: `Nuevo ${rec.tipoReclamacion}`,
             desc: `${rec.nombres} ${rec.apellidos} registró un ${rec.tipoReclamacion.toLowerCase()} por ${rec.descripcionBien}.`,
             leida: false
        });
    }

    // Generar alertas por postulaciones en revisión
    for (const pos of postulacionesRevision) {
        alertasBackend.push({
             key: `postulacion-${pos.id}`,
             tipo: 'postulacion',
             color: 'blue',
             titulo: 'Nueva Postulación',
             desc: `${pos.nombres} ${pos.apellidoPaterno} postula para el área de ${pos.areaPostula}.`,
             leida: false
        });
    }

    let pedidosPorVerificar = 0;
    for (const txn of transacciones) {
      // El saldo/fondo inicial de caja NO es un ingreso: no entra en KPIs, gráficas ni distribuciones
      if (esSaldoInicial(txn)) continue;

      const isIngreso = txn.tipo === 'INGRESO';
      const isEgreso = txn.tipo === 'EGRESO';
      
      // Fechas guardadas como "DD/MM/YYYY" (registros antiguos pueden venir como "1/3/2026")
      const partesFecha = parsearFecha(txn.fecha);
      const diaTxn = partesFecha?.dia ?? 0;
      const mesTxn = partesFecha ? partesFecha.mes - 1 : -1; // 0-indexed para coincidir con los meses del gráfico
      const anioTxn = partesFecha?.anio ?? 0;
      const metodo = ETIQUETA_METODO[normalizarMetodoPago(txn.metodoPago)];

      if (txn.estado === 'PENDIENTE' && isIngreso) {
        porCobrar++;
        contadorPagosPorCobrar++;
        montoPagosPorCobrar += txn.monto;
      }
      // Venta pagada en partes: queda por cobrar solo el saldo
      if (txn.estado === 'PARCIAL' && isIngreso) {
        const cobrado = txn.pagos.reduce((s, p) => s + p.monto, 0);
        porCobrar++;
        contadorPagosPorCobrar++;
        montoPagosPorCobrar += Math.max(0, txn.monto - cobrado);
      }
      if (txn.estado === 'POR_VERIFICAR' && isIngreso) pedidosPorVerificar++;

      // Una venta pagada en partes NO es ingreso: lo son sus pagos (cada uno en su fecha)
      if (txn.pagoEnPartes) continue;

      // Cálculos mensuales (año actual)
      if (partesFecha && anioTxn === anioActual && txn.estado === 'COMPLETADO') {
        if (isIngreso) ingresosData[mesTxn] += txn.monto;
        if (isEgreso) egresosData[mesTxn] += txn.monto;

        // Mes actual
        if (mesTxn === mesActual) {
          if (isIngreso) ingresoMes += txn.monto;
          if (isEgreso) egresoMes += txn.monto;
        }
      }

      // Cálculos de HOY (coincide formato fecha DD/MM/YYYY)
      if (diaTxn === diaActual && mesTxn === mesActual && anioTxn === anioActual) {
        if (txn.estado === 'COMPLETADO') {
            if (isIngreso) {
                ingresoHoy += txn.monto;

                // Alerta Venta Registrada (solo las más recientes del día)
                if (alertasBackend.filter(a => a.tipo === 'venta').length < 5) {
                    alertasBackend.push({
                        key: `venta-${txn.id}`,
                        tipo: "venta",
                        color: "green",
                        titulo: "Venta registrada",
                        desc: `${txn.concepto} — ${txn.numero} · S/ ${txn.monto} cobrado`,
                        leida: false
                    });
                }

                // Distribución métodos de pago (hoy), con el método normalizado (no se asume efectivo)
                ingresosPorMetodo[metodo] = (ingresosPorMetodo[metodo] || 0) + txn.monto;
            }
            if (isEgreso) {
                egresoHoy += txn.monto;
                egresosPorMetodo[metodo] = (egresosPorMetodo[metodo] || 0) + txn.monto;

                // Alerta Egreso / Pago de personal (solo los más recientes del día)
                if (alertasBackend.filter(a => a.tipo === 'pago').length < 3) {
                     alertasBackend.push({
                        key: `pago-${txn.id}`,
                        tipo: "pago",
                        color: "orange",
                        titulo: txn.categoria?.toLowerCase().includes('personal') ? "Pago de personal" : "Nuevo egreso",
                        desc: `${txn.concepto} realizado por S/ ${txn.monto}`,
                        leida: false
                    });
                }

                // Distribución categorías de egreso (hoy)
                const cat = txn.categoria || 'Otros';
                egresosPorCategoria[cat] = (egresosPorCategoria[cat] || 0) + txn.monto;
            }
        }
      }
    }

    // Últimas transacciones (top 6 global, sin el saldo inicial)
    for (const txn of recientes) {
      if (ultimasTxns.length >= 6) break;
      if (esSaldoInicial(txn)) continue;
      const isIngreso = txn.tipo === 'INGRESO';
      ultimasTxns.push({
        id: txn.numero,
        cliente: txn.cliente?.nombre || txn.clienteNombre || 'Cliente no registrado',
        concepto: txn.concepto,
        metodo: txn.metodoPago,
        monto: txn.monto,
        tipo: txn.tipo.toLowerCase(),
        estado: txn.estado === 'COMPLETADO' ? (isIngreso ? 'Cobrado' : 'Pagado')
          : txn.estado === 'POR_VERIFICAR' ? 'Por verificar'
          : (txn.estado.charAt(0) + txn.estado.slice(1).toLowerCase())
      });
    }

    // Pedidos de la tienda web cuyo pago aún no se confirmó
    if (pedidosPorVerificar > 0) {
      alertasBackend.unshift({
        key: 'pedidos-web-por-verificar',
        tipo: 'venta',
        color: 'orange',
        titulo: 'Pedidos web por verificar',
        desc: `${pedidosPorVerificar} pedido(s) de la tienda esperan que confirmes el pago.`,
        leida: false
      });
    }

    // Agregar alerta global de por cobrar (agrupada)
    if (contadorPagosPorCobrar > 0) {
        alertasBackend.unshift({
            key: "pendientes-global",
            tipo: "pendiente",
            color: "red",
            titulo: "Pagos por cobrar",
            desc: `${contadorPagosPorCobrar} pagos pendientes · S/ ${montoPagosPorCobrar} por cobrar`,
            leida: false
        });
    }

    // Formatear distribuciones para el frontend
    const distribPago: {label: string, pct: number, color: string}[] = [];
    const colorMetodos: Record<string, string> = { "Efectivo": "#22c55e", "Tarjeta": "#3b82f6", "Transferencia": "#8b5cf6", "Yape/Plin": "#ec4899" };
    for (const [label, monto] of Object.entries(ingresosPorMetodo)) {
      const pct = ingresoHoy > 0 ? Math.round((monto / ingresoHoy) * 100) : 0;
      distribPago.push({ label, pct, color: colorMetodos[label] || "#94a3b8" });
    }
    // Llenar faltantes en caso de venir vacíos
    ["Efectivo", "Tarjeta", "Transferencia", "Yape/Plin"].forEach(m => {
        if(!distribPago.find(d => d.label === m)) distribPago.push({ label: m, pct: 0, color: colorMetodos[m] });
    });
    distribPago.sort((a,b) => b.pct - a.pct); // Orden descendente

    const distribEgresos: {label: string, pct: number, color: string}[] = [];
    const colorCats: Record<string, string> = { "Repuestos": "#ef4444", "Servicios": "#f97316", "Personal": "#eab308", "Otros": "#94a3b8" };
    for (const [label, monto] of Object.entries(egresosPorCategoria)) {
      const pct = egresoHoy > 0 ? Math.round((monto / egresoHoy) * 100) : 0;
      // Normalizar nombres de categorías si difieren a los del diseño original ("Compra repuestos", "Servicios", "Personal", "Otros")
      let catFront = label;
      if (label.toLowerCase().includes('repuesto')) catFront = 'Compra repuestos';
      if (label.toLowerCase().includes('servicio')) catFront = 'Servicios';
      if (label.toLowerCase().includes('personal') || label.toLowerCase().includes('planilla')) catFront = 'Personal';

      distribEgresos.push({ label: catFront, pct, color: colorCats[label] || "#94a3b8" });
    }
    if(distribEgresos.length === 0){
        distribEgresos.push(
            { label: "Compra repuestos", pct: 0, color: "#ef4444" },
            { label: "Servicios", pct: 0, color: "#f97316" },
            { label: "Personal", pct: 0, color: "#eab308" },
            { label: "Otros", pct: 0, color: "#94a3b8" }
        );
    }

    const vehiculosEnTallerCount = await prisma.numeroGuia.count({
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
        porCobrar: montoPagosPorCobrar,
        // Montos de hoy por método (Efectivo = dinero físico; el resto son medios electrónicos)
        ingresosHoyPorMetodo: ingresosPorMetodo,
        egresosHoyPorMetodo: egresosPorMetodo,
        efectivoHoy: (ingresosPorMetodo['Efectivo'] || 0) - (egresosPorMetodo['Efectivo'] || 0),
        conteoPorCobrar: contadorPagosPorCobrar,
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
      ultimasTxns,
      alertas: alertasBackend
    });

  } catch (error) {
    console.error('Error al obtener datos del dashboard:', error);
    res.status(500).json({ error: 'Error del servidor al obtener datos' });
  }
};
