import crypto from 'crypto';

/**
 * Códigos de un solo uso basados en tiempo (TOTP, RFC 6238), compatibles con
 * Google Authenticator, Microsoft Authenticator, Authy, etc.
 * Parámetros estándar: SHA-1, 6 dígitos, intervalos de 30 segundos.
 */
const PERIODO = 30;
const DIGITOS = 6;
const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const base32Codificar = (buf: Buffer): string => {
    let bits = 0;
    let valor = 0;
    let salida = '';
    for (const byte of buf) {
        valor = (valor << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            salida += ALFABETO[(valor >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) salida += ALFABETO[(valor << (5 - bits)) & 31];
    return salida;
};

export const base32Decodificar = (texto: string): Buffer => {
    const limpio = texto.toUpperCase().replace(/[^A-Z2-7]/g, '');
    let bits = 0;
    let valor = 0;
    const bytes: number[] = [];
    for (const c of limpio) {
        valor = (valor << 5) | ALFABETO.indexOf(c);
        bits += 5;
        if (bits >= 8) {
            bytes.push((valor >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(bytes);
};

/** Secreto nuevo de 160 bits en base32 */
export const generarSecretoTotp = (): string => base32Codificar(crypto.randomBytes(20));

export const pasoActual = (ahora = Date.now()) => Math.floor(ahora / 1000 / PERIODO);

const hotp = (secreto: Buffer, contador: number): string => {
    const mensaje = Buffer.alloc(8);
    mensaje.writeBigUInt64BE(BigInt(contador));
    const hmac = crypto.createHmac('sha1', secreto).update(mensaje).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const numero = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITOS;
    return numero.toString().padStart(DIGITOS, '0');
};

export const generarCodigoTotp = (secretoBase32: string, ahora = Date.now()) =>
    hotp(base32Decodificar(secretoBase32), pasoActual(ahora));

/**
 * Verifica un código aceptando un intervalo de tolerancia (±30 s) por desfase de reloj.
 * Devuelve el paso usado (para impedir que el mismo código se use dos veces) o null.
 */
export const verificarCodigoTotp = (
    secretoBase32: string,
    codigo: string,
    ultimoPasoUsado?: number | null,
    ahora = Date.now()
): number | null => {
    const limpio = String(codigo || '').replace(/\s/g, '');
    if (!/^\d{6}$/.test(limpio)) return null;
    const secreto = base32Decodificar(secretoBase32);
    const actual = pasoActual(ahora);
    for (const paso of [actual - 1, actual, actual + 1]) {
        if (ultimoPasoUsado != null && paso <= ultimoPasoUsado) continue;
        const esperado = Buffer.from(hotp(secreto, paso));
        if (crypto.timingSafeEqual(esperado, Buffer.from(limpio))) return paso;
    }
    return null;
};

/** URI estándar para el código QR */
export const uriOtpauth = (secretoBase32: string, cuenta: string, emisor = 'Taller Juan Pablo') =>
    `otpauth://totp/${encodeURIComponent(`${emisor}:${cuenta}`)}?secret=${secretoBase32}&issuer=${encodeURIComponent(emisor)}&algorithm=SHA1&digits=${DIGITOS}&period=${PERIODO}`;

/** Códigos de recuperación legibles: XXXX-XXXX (sin caracteres ambiguos) */
export const generarCodigosRecuperacion = (cantidad = 10): string[] => {
    const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: cantidad }, () => {
        const c = Array.from({ length: 8 }, () => alfabeto[crypto.randomInt(0, alfabeto.length)]).join('');
        return `${c.slice(0, 4)}-${c.slice(4)}`;
    });
};

export const normalizarCodigoRecuperacion = (codigo: string) =>
    String(codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(.{4})(.{4})$/, '$1-$2');
