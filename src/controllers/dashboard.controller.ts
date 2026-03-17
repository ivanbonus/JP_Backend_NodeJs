import { Request, Response } from 'express';
import { prisma } from '../index';

export const getDashboardData = async (req: Request, res: Response) => {
  try {
    const hoyDate = new Date();
    const hoyStr = hoyDate.toLocaleDateString('en-GB'); // DD/MM/YYYY
    const mesActual = hoyDate.getMonth(); // 0-11
    const anioActual = hoyDate.getFullYear();

    const transacciones = await prisma.transaccion.findMany({
      include: {
        cliente: true
      },
      orderBy: {
        id: 'desc'
      }
    });

    const guias = await prisma.numeroGuia.findMany({
      include: {
        cliente: true,
        vehiculo: true
      },
      orderBy: {
        id: 'desc'
      }
    });

    const trabajadores = await prisma.trabajador.findMany({
        where: { estado: true }
    });

    const cotizacionesPendientes = await prisma.cotizacion.findMany({
        where: { estado: 'PENDIENTE' },
        orderBy: { fecha: 'desc' }
    });

    let ingresoHoy = 0;
    let egresoHoy = 0;
    let ingresoMes = 0;
    let egresoMes = 0;
    let porCobrar = 0;

    const ingresosPorMetodo: Record<string, number> = {};
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
             tipo: 'cotizacion', // En el frontend se puede mapear a un icono de la campanita diferente
             color: 'blue',
             titulo: 'Nueva Cotización',
             desc: `${ctz.nombre} solicitó cotizar su ${ctz.vehiculo} (${ctz.servicio}). Teléf: ${ctz.telefono}`,
             leida: false
        });
    }

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
        contadorPagosPorCobrar++;
        montoPagosPorCobrar += txn.monto;
      }

      // Cálculos mensuales (año actual)
      if (anioTxn === anioActual && txn.estado === 'COMPLETADO') {
        if (isIngreso) ingresosData[mesTxn] += txn.monto;
        if (isEgreso) egresosData[mesTxn] += txn.monto;

        // Mes actual
        if (mesTxn === mesActual) {
          if (isIngreso) ingresoMes += txn.monto;
          if (isEgreso) egresoMes += txn.monto;
        }
      }

      // Cálculos de HOY (coincide formato fecha DD/MM/YYYY)
      if (txn.fecha === hoyStr || (diaTxn === hoyDate.getDate() && mesTxn === mesActual && anioTxn === anioActual)) {
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

                // Distribución métodos de pago (hoy)
                const metodo = txn.metodoPago === 'TRANSFERENCIA' ? 'Transferencia' : 
                                (txn.metodoPago === 'TARJETA' ? 'Tarjeta' : 
                                (txn.metodoPago === 'YAPE' || txn.metodoPago === 'PLIN' ? 'Yape/Plin' : 'Efectivo'));
                
                ingresosPorMetodo[metodo] = (ingresosPorMetodo[metodo] || 0) + txn.monto;
            }
            if (isEgreso) {
                egresoHoy += txn.monto;

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
      ultimasTxns,
      alertas: alertasBackend
    });

  } catch (error) {
    console.error('Error al obtener datos del dashboard:', error);
    res.status(500).json({ error: 'Error del servidor al obtener datos' });
  }
};
