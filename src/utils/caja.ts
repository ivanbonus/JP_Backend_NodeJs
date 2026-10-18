// Reglas de negocio de caja compartidas por Finanzas y Dashboard.

export type MetodoNormalizado = 'EFECTIVO' | 'TRANSFERENCIA' | 'YAPE_PLIN' | 'TARJETA' | 'OTRO';

/** Etiqueta que usa el frontend para cada método */
export const ETIQUETA_METODO: Record<MetodoNormalizado, string> = {
  EFECTIVO: 'Efectivo',
  TRANSFERENCIA: 'Transferencia',
  YAPE_PLIN: 'Yape/Plin',
  TARJETA: 'Tarjeta',
  OTRO: 'Otro',
};

const simplificar = (texto: string) =>
  texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Normaliza el método de pago guardado (insensible a mayúsculas y acentos).
 * "Yape/Plin", "YAPE", "plin" → YAPE_PLIN; "Transferencia", "TRANSFERENCIA" → TRANSFERENCIA; etc.
 * Un valor desconocido NO se asume efectivo: se devuelve OTRO.
 */
export const normalizarMetodoPago = (valor: string | null | undefined): MetodoNormalizado => {
  const v = simplificar(valor || '');
  if (!v) return 'OTRO';
  if (v.includes('yape') || v.includes('plin')) return 'YAPE_PLIN';
  if (v.includes('transf') || v.includes('deposito')) return 'TRANSFERENCIA';
  if (v.includes('tarjeta') || v.includes('credito') || v.includes('debito') || v === 'pos' || v.includes('visa')) return 'TARJETA';
  if (v.includes('efectivo') || v === 'cash' || v === 'contado') return 'EFECTIVO';
  return 'OTRO';
};

/** El saldo/fondo inicial de caja NO es un ingreso: se identifica por su número SALDO-DDMMYYYY o su categoría */
export const esSaldoInicial = (t: { numero?: string | null; categoria?: string | null }): boolean =>
  /^saldo-/i.test(t.numero || '') || simplificar(t.categoria || '') === 'saldo inicial';

/** Prefijo de un número de transacción ("TXN-005" → "TXN") */
export const prefijoNumero = (numero: string | null | undefined, tipo?: string | null): string => {
  const m = /^([A-Za-z]+)-/.exec((numero || '').trim());
  if (m) return m[1].toUpperCase();
  return tipo === 'EGRESO' ? 'EGR' : 'TXN';
};

/** Siguiente correlativo a partir de los números existentes con ese prefijo */
export const siguienteCorrelativo = (prefijo: string, existentes: string[]): string => {
  let max = 0;
  const re = new RegExp(`^${prefijo}-(\\d+)$`, 'i');
  for (const n of existentes) {
    const m = re.exec(n);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefijo}-${String(max + 1).padStart(3, '0')}`;
};
