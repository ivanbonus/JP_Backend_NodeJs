/**
 * Desactiva la verificación en dos pasos de una cuenta (por ejemplo, si se perdió el celular
 * y también los códigos de recuperación). Cierra todas sus sesiones.
 * Al volver a entrar, el administrador deberá configurarla de nuevo (es obligatoria).
 *
 * Uso:
 *   Producción (Render → Shell):  npm run admin:2fa:reset
 *   Para un usuario del personal: npm run admin:2fa:reset -- --email correo@dominio.com
 */
import '../env';
import { prisma } from '../prisma';
import { invalidarSesiones, refUsuario, RefCuenta } from '../auth/cuentas';
import { registrarAuditoria } from '../auth/auditoria';

const i = process.argv.indexOf('--email');
const email = i >= 0 ? process.argv[i + 1]?.trim().toLowerCase() : undefined;

const main = async () => {
    let ref: RefCuenta = 'config';
    let nombre = 'administrador';
    if (email) {
        const u = await prisma.usuario.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
        if (!u) throw new Error(`No existe un usuario con el correo ${email}.`);
        ref = refUsuario(u.id);
        nombre = u.email;
    }
    const [, borrado] = await prisma.$transaction([
        prisma.dispositivoVerificacion.deleteMany({ where: { cuenta: ref } }),
        prisma.segundoFactor.deleteMany({ where: { cuenta: ref } }),
    ]);
    await invalidarSesiones(ref);
    await registrarAuditoria({ cuenta: nombre, accion: '2FA_RESTABLECIDO_CONSOLA', entidad: 'auth' });
    console.log(borrado.count
        ? `\nVerificación en dos pasos restablecida para "${nombre}". Al iniciar sesión deberá configurarla de nuevo.\n`
        : `\n"${nombre}" no tenía verificación en dos pasos configurada. Se cerraron sus sesiones.\n`);
};

main()
    .catch((error) => {
        console.error('[admin:2fa:reset] Error:', error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
