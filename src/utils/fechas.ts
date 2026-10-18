// Utilidades de fecha en la zona horaria del negocio (Lima, Perú).
// El servidor (Render) corre en UTC: nunca usar getDate()/toLocaleDateString() sin zona.
// Las fechas de Transaccion se guardan como texto "DD/MM/YYYY".

export const ZONA_NEGOCIO = 'America/Lima';

export interface PartesFecha {
  dia: number;
  mes: number;   // 1-12
  anio: number;
}

const formateador = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONA_NEGOCIO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Partes de fecha/hora de un instante, vistas desde Lima */
export const partesLima = (instante: Date = new Date()) => {
  const p: Record<string, string> = {};
  for (const parte of formateador.formatToParts(instante)) p[parte.type] = parte.value;
  return {
    dia: Number(p.day),
    mes: Number(p.month),
    anio: Number(p.year),
    hora: Number(p.hour) % 24,
    minuto: Number(p.minute),
  };
};

const dos = (n: number) => String(n).padStart(2, '0');

/** Fecha "DD/MM/YYYY" en Lima */
export const hoyLima = (instante: Date = new Date()): string => {
  const p = partesLima(instante);
  return `${dos(p.dia)}/${dos(p.mes)}/${p.anio}`;
};

/** Hora "HH:mm" (24 h) en Lima */
export const horaLima = (instante: Date = new Date()): string => {
  const p = partesLima(instante);
  return `${dos(p.hora)}:${dos(p.minuto)}`;
};

/** Interpreta "DD/MM/YYYY" (también "D/M/YYYY"). Devuelve null si no es válida. */
export const parsearFecha = (texto: string | null | undefined): PartesFecha | null => {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(texto || '');
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  const anio = Number(m[3]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  return { dia, mes, anio };
};

/** Normaliza a "DD/MM/YYYY" con ceros. Devuelve null si no es válida. */
export const normalizarFecha = (texto: string | null | undefined): string | null => {
  const p = parsearFecha(texto);
  return p ? `${dos(p.dia)}/${dos(p.mes)}/${p.anio}` : null;
};

/** ¿Dos fechas de texto representan el mismo día? (tolera "1/3/2026" vs "01/03/2026") */
export const mismoDia = (a: string | null | undefined, b: string | null | undefined): boolean => {
  const pa = parsearFecha(a);
  const pb = parsearFecha(b);
  return !!pa && !!pb && pa.dia === pb.dia && pa.mes === pb.mes && pa.anio === pb.anio;
};

/** Variantes de escritura de una fecha (con y sin ceros) para buscar en la BD registros antiguos */
export const variantesFecha = (texto: string): string[] => {
  const p = parsearFecha(texto);
  if (!p) return [texto];
  const dias = [String(p.dia), dos(p.dia)];
  const meses = [String(p.mes), dos(p.mes)];
  const variantes = new Set<string>();
  for (const d of dias) for (const m of meses) variantes.add(`${d}/${m}/${p.anio}`);
  return [...variantes];
};
