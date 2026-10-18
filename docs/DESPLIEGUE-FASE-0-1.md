# Despliegue de las Fases 0 y 1 (seguridad, verificación en dos pasos, auditoría, Caja y estabilidad)

Entorno real: **Render Free** (backend, sin pestaña *Shell*) + **Neon Free** (PostgreSQL).
Por eso las migraciones y los comandos de administración se ejecutan **desde tu PC**, conectándote a Neon.

> Backend y frontend deben desplegarse **juntos**. Hazlo en un horario sin atención al público.

---

## 0. Variables en Render (antes de subir a `main`)

Render → servicio **JP_Backend_NodeJs** → *Environment*:

| Variable | Valor |
|---|---|
| `DATABASE_URL` | (ya existe) |
| `JWT_SECRET` | 96 caracteres aleatorios |
| `DATA_ENCRYPTION_KEY` | 64 caracteres hexadecimales |
| `GOOGLE_CLIENT_ID` | el mismo valor que `VITE_GOOGLE_CLIENT_ID` del frontend |
| `CORS_ORIGINS` (opcional) | dominios del frontend separados por coma |

⚠️ **No pierdas `DATA_ENCRYPTION_KEY`**: si cambia, la verificación en dos pasos deja de funcionar
(se restablece con `admin:2fa:reset`). **No** definas `ADMIN_INITIAL_PASSWORD` ni `RATE_LIMIT_MULTIPLICADOR`.

---

## 1. Ensayo en una COPIA de la base (Neon branch) — recomendado

1. Neon → tu proyecto → **Branches** → **Create branch** (desde `main`, con los datos actuales). Llámala `ensayo-fase1`.
2. Copia su **connection string directa** (Neon → *Connect* → desactiva *Connection pooling*; la dirección **no** debe decir `-pooler`).
3. En PowerShell, dentro de `D:\JP\JP_Backend_NodeJS`:

```powershell
$env:DATABASE_URL = "postgresql://...(la de la COPIA)..."
npx prisma migrate status
npx prisma migrate diff --from-url "$env:DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
npx prisma migrate resolve --applied 20260315215020_init_produccion
npx prisma migrate resolve --applied 20260316022630_add_foto_producto
npx prisma migrate resolve --applied 20261017184812_baseline_sincronizar_db_push
npx prisma migrate deploy
npx prisma migrate diff --from-url "$env:DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
```

- El primer `diff` debe mostrar **solo** lo de la migración fase1: columnas `debeCambiarPassword` y `sesionVersion`,
  `password` sin valor por defecto, tablas `SegundoFactor`, `DispositivoVerificacion` y `Auditoria`.
  Si aparece cualquier `DROP` de columnas o tablas existentes, **detente y avisa**.
- El último `diff` debe estar vacío.
- Verificado en el ensayo del 18/10/2026: producción nunca usó migraciones (solo `db push`), por eso se marcan
  como aplicadas **las tres** primeras (marzo 2026 + baseline) y solo se ejecuta la de la Fase 1.

Si el ensayo sale bien, borra la branch `ensayo-fase1` en Neon.

---

## 2. Base real (los mismos comandos, con la base principal)

1. Neon → *Backup & Restore* / o crea una branch `respaldo-antes-fase1` (sirve de respaldo instantáneo).
2. En PowerShell, con la connection string **directa** de la base principal:

```powershell
$env:DATABASE_URL = "postgresql://...(la PRINCIPAL, sin -pooler)..."
npx prisma migrate status
npx prisma migrate diff --from-url "$env:DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
npx prisma migrate resolve --applied 20260315215020_init_produccion
npx prisma migrate resolve --applied 20260316022630_add_foto_producto
npx prisma migrate resolve --applied 20261017184812_baseline_sincronizar_db_push
npx prisma migrate deploy
```

3. Subir el código a `main` (backend y frontend). Render despliega solo.

---

## 3. Contraseña y verificación del administrador (desde tu PC)

Con la misma ventana de PowerShell (con `$env:DATABASE_URL` de la base principal):

```powershell
npm run admin:password:dev
```

1. Aparece una **contraseña temporal** (solo esta vez).
2. Entra al panel con `administrador` y esa contraseña.
3. El sistema pide **elegir una contraseña nueva** (mínimo 12 caracteres; recomendado una frase).
4. Luego pide **activar la verificación en dos pasos**: nombre del celular → QR → código.
5. **Guarda los 10 códigos de recuperación** fuera del celular.
6. En Configuración → Seguridad → **Agregar celular** registra los demás celulares (hasta 5).

Cierra la ventana de PowerShell al terminar (así `DATABASE_URL` no queda en memoria).

---

## 4. Mantener despierto el servidor gratis (opcional)

Render Free “duerme” el backend tras 15 min sin uso (la primera visita tarda ~50 s).
Gratis: crea una cuenta en **cron-job.org** (o UptimeRobot) y programa una visita cada **10 minutos** a
`https://jp-backend-nodejs.onrender.com/`. Render Free da 750 h/mes, suficiente para un servicio encendido todo el mes.

---

## 5. Emergencias (desde tu PC, con `$env:DATABASE_URL` de la base principal)

| Situación | Comando |
|---|---|
| Olvidé la contraseña | `npm run admin:password:dev` → contraseña temporal; al entrar se elige una nueva |
| Perdí un celular | Entra con otro celular o un **código de recuperación** y quita el celular perdido en Configuración |
| Perdí todos los celulares **y** los códigos | `npm run admin:2fa:reset:dev` → al entrar se configura de nuevo |

---

## 6. Comprobaciones después del despliegue

- [ ] Sin iniciar sesión, `https://jp-backend-nodejs.onrender.com/api/clientes` responde "Sesión no válida".
- [ ] El inicio de sesión pide el código de 6 dígitos.
- [ ] Configuración → *Actividad reciente* muestra el inicio de sesión con el nombre del celular.
- [ ] La web pública funciona: cotizar, tienda (fotos), novedades (fotos y videos), reservar cita.
- [ ] Caja Diaria y Dashboard muestran los montos por método de pago correctamente.
