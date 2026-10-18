# Despliegue de las Fases 0 y 1 (seguridad, verificación en dos pasos, auditoría y Caja)

> Backend y frontend deben desplegarse **juntos**. Si solo se despliega uno, el panel deja de cargar datos.
> Haz todo en un horario sin atención al público.

## 0. Antes de empezar

1. **Respaldo de la base de datos.** En Render → base de datos → *Backups* → crear un respaldo manual (o `pg_dump`).
2. Ten el celular con **Google Authenticator** o **Microsoft Authenticator** instalado.

## 1. Variables de entorno nuevas (Render → servicio backend → *Environment*)

| Variable | Valor | Cómo generarlo |
|---|---|---|
| `JWT_SECRET` | 96 caracteres aleatorios | `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `DATA_ENCRYPTION_KEY` | 64 caracteres hexadecimales | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `GOOGLE_CLIENT_ID` | El mismo valor que `VITE_GOOGLE_CLIENT_ID` del frontend | — |
| `CORS_ORIGINS` (opcional) | Dominios del frontend separados por coma, p. ej. `https://www.frenosembraguesjp.com,https://frenosembraguesjp.com` | — |

⚠️ **No pierdas `DATA_ENCRYPTION_KEY`**: si cambia, la verificación en dos pasos deja de funcionar y habrá que restablecerla (`npm run admin:2fa:reset`).
**No** definas `ADMIN_INITIAL_PASSWORD` ni `RATE_LIMIT_MULTIPLICADOR` en producción.

## 2. Migraciones (la primera vez, en este orden)

Producción se creó con `prisma db push`, así que la migración *baseline* **no debe ejecutarse**: solo se marca como aplicada.

Desde **Render → Shell** del backend (ya desplegado el código nuevo, pero ANTES de usar el panel):

```bash
# 2.0 Ver qué migraciones figuran como aplicadas. Lo esperado: las dos de marzo 2026 aplicadas
#     y la baseline + fase1 pendientes. Si las de marzo NO figuran, márcalas también con
#     `migrate resolve --applied <nombre>` antes de seguir.
npx prisma migrate status

# 2.1 Comprobar diferencias entre producción y el esquema nuevo.
#     Lo esperado: SOLO lo de la migración fase1 (columnas debeCambiarPassword y sesionVersion,
#     password sin valor por defecto, tablas SegundoFactor y Auditoria).
#     Si aparece cualquier otra cosa (DROP de columnas/tablas existentes), DETENTE y avisa.
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script

# 2.2 Marcar la baseline como aplicada (NO la ejecuta)
npx prisma migrate resolve --applied 20261017184812_baseline_sincronizar_db_push

# 2.3 Aplicar las migraciones nuevas (solo agregan columnas y tablas)
npx prisma migrate deploy

# 2.4 Verificar que no quedan diferencias (debe decir que está vacío)
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
```

En despliegues futuros basta con `npx prisma migrate deploy` (se puede añadir al *Build Command* de Render
después de completar este primer proceso).

## 3. Contraseña y verificación del administrador

```bash
# En Render → Shell: genera una contraseña temporal segura (se muestra una sola vez)
npm run admin:password
```

1. Entra al panel con `administrador` y esa contraseña temporal.
2. El sistema pedirá **elegir una contraseña nueva** (mínimo 12 caracteres; recomendado una frase).
3. Luego pedirá **activar la verificación en dos pasos**: escanea el QR y escribe el código.
4. **Guarda los 10 códigos de recuperación** (descárgalos y guárdalos fuera del celular).

Todas las sesiones abiertas antes del despliegue se cierran: hay que volver a iniciar sesión.

## 4. Emergencias

| Situación | Solución (Render → Shell) |
|---|---|
| Olvidé la contraseña | `npm run admin:password` → contraseña temporal, al entrar se elige una nueva |
| Perdí el celular | Entra con un **código de recuperación** y en Configuración → *Cambiar de celular* |
| Perdí el celular **y** los códigos | `npm run admin:2fa:reset` → al entrar se configura de nuevo |

## 5. Comprobaciones después del despliegue

- [ ] Sin iniciar sesión, `https://<backend>/api/clientes` responde "Sesión no válida".
- [ ] El inicio de sesión pide el código de 6 dígitos.
- [ ] Configuración → *Actividad reciente* muestra el inicio de sesión.
- [ ] La web pública funciona: cotizar, tienda, novedades, reservar cita.
- [ ] Caja Diaria y Dashboard muestran los montos por método de pago correctamente.
