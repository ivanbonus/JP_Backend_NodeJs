// Debe importarse antes que cualquier otro módulo: carga las variables de entorno.
// ENV_FILE permite usar otro archivo (p. ej. .env.test para las pruebas locales).
import dotenv from 'dotenv';

dotenv.config({ path: process.env.ENV_FILE || '.env' });
