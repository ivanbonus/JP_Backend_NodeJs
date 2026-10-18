/**
 * Genera una contraseña segura para el administrador, la guarda cifrada (bcrypt)
 * y la muestra UNA sola vez en la terminal. No se guarda en ningún otro lugar.
 *
 * Uso:
 *   Producción (Render → Shell):  npm run admin:password
 *   Local con .env.test:          ENV_FILE=.env.test npm run admin:password:dev
 *   Para un usuario del personal: npm run admin:password -- --email correo@dominio.com
 */
import '../env';
import { prisma } from '../prisma';
import { generarFraseSegura, hashPassword, ROLES_PANEL } from '../auth/security';
import { guardarPassword, refUsuario } from '../auth/cuentas';
import { registrarAuditoria } from '../auth/auditoria';

const leerArgumento = (nombre: string) => {
    const i = process.argv.indexOf(nombre);
    return i >= 0 ? process.argv[i + 1] : undefined;
};

const main = async () => {
    const email = leerArgumento('--email')?.trim().toLowerCase();
    const frase = generarFraseSegura();
    const hash = await hashPassword(frase);
    let usuarioLogin: string;

    if (email) {
        const usuario = await prisma.usuario.findUnique({ where: { email } });
        if (!usuario) throw new Error(`No existe un usuario con el correo ${email}.`);
        if (!(ROLES_PANEL as string[]).includes(usuario.rol)) throw new Error('Ese usuario no pertenece al personal del panel.');
        await guardarPassword(refUsuario(usuario.id), hash, { debeCambiar: true });
        usuarioLogin = usuario.email;
    } else {
        let config = await prisma.configuracion.findFirst();
        if (!config) {
            config = await prisma.configuracion.create({ data: { id: 1, usuario: 'administrador', password: hash, debeCambiarPassword: true } });
        } else {
            await guardarPassword('config', hash, { debeCambiar: true });
        }
        usuarioLogin = config.usuario;
    }
    await registrarAuditoria({ cuenta: usuarioLogin, accion: 'PASSWORD_REGENERADA_CONSOLA', entidad: 'auth' });

    const linea = '═'.repeat(58);
    console.log(`\n╔${linea}╗`);
    console.log('  NUEVA CONTRASEÑA GENERADA (se muestra solo esta vez)');
    console.log(`╠${linea}╣`);
    console.log(`  Usuario:     ${usuarioLogin}`);
    console.log(`  Contraseña:  ${frase}`);
    console.log(`╚${linea}╝`);
    console.log('  • Guárdala en un gestor de contraseñas o anótala en un lugar seguro.');
    console.log('  • No la envíes por WhatsApp ni por correo.');
    console.log('  • La contraseña anterior dejó de funcionar y se cerraron todas las sesiones.');
    console.log('  • Es temporal: al iniciar sesión el sistema te pedirá elegir una nueva.\n');
};

main()
    .catch((error) => {
        console.error('[admin:password] No se pudo cambiar la contraseña:', error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
