import crypto from 'crypto';

/**
 * Cifrado simétrico AES-256-GCM para datos sensibles guardados en la base
 * (p. ej. el secreto de la verificación en dos pasos).
 *
 * Clave: DATA_ENCRYPTION_KEY (64 caracteres hexadecimales = 32 bytes).
 * En producción es obligatoria. En desarrollo/pruebas se deriva de JWT_SECRET.
 */
const enProduccion = process.env.NODE_ENV === 'production' || !!process.env.RENDER;

const resolverClave = (): Buffer => {
    const hex = process.env.DATA_ENCRYPTION_KEY;
    if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, 'hex');
    if (enProduccion) {
        throw new Error('[SEGURIDAD] Falta DATA_ENCRYPTION_KEY (64 caracteres hexadecimales) en las variables de entorno.');
    }
    const base = process.env.JWT_SECRET || 'solo-desarrollo';
    return Buffer.from(crypto.hkdfSync('sha256', base, 'jp-taller', 'cifrado-datos', 32));
};

let clave: Buffer | null = null;
const obtenerClave = () => (clave ??= resolverClave());

/** Devuelve "v1:<iv>:<tag>:<datos>" en base64url */
export const cifrar = (texto: string): string => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', obtenerClave(), iv);
    const datos = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv.toString('base64url'), tag.toString('base64url'), datos.toString('base64url')].join(':');
};

export const descifrar = (paquete: string): string => {
    const [version, iv, tag, datos] = paquete.split(':');
    if (version !== 'v1' || !iv || !tag || !datos) throw new Error('Formato de dato cifrado no válido');
    const decipher = crypto.createDecipheriv('aes-256-gcm', obtenerClave(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(datos, 'base64url')), decipher.final()]).toString('utf8');
};
