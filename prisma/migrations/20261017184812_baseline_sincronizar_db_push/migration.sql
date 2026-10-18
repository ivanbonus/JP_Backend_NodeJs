-- ============================================================================
-- MIGRACIÓN BASE (baseline) — NO EJECUTAR EN PRODUCCIÓN
-- Producción ya tiene estas tablas y columnas (se crearon con `prisma db push`).
-- En producción se marca como aplicada SIN ejecutarla:
--   npx prisma migrate resolve --applied 20261017184812_baseline_sincronizar_db_push
-- En bases nuevas (pruebas/desarrollo) se ejecuta normalmente con `migrate deploy`.
-- ============================================================================

-- DropForeignKey
ALTER TABLE "Resena" DROP CONSTRAINT "Resena_clienteId_fkey";

-- AlterTable
ALTER TABLE "Cotizacion" DROP COLUMN "descripcion",
DROP COLUMN "nombreSolicitante",
ADD COLUMN     "atencion" TEXT,
ADD COLUMN     "datosCotizacion" JSONB,
ADD COLUMN     "direccion" TEXT,
ADD COLUMN     "documento" TEXT,
ADD COLUMN     "mensaje" TEXT NOT NULL,
ADD COLUMN     "nombre" TEXT NOT NULL,
ADD COLUMN     "placa" TEXT,
ADD COLUMN     "servicio" TEXT NOT NULL,
ADD COLUMN     "vehiculo" TEXT NOT NULL,
ALTER COLUMN "telefono" SET NOT NULL,
ALTER COLUMN "email" SET NOT NULL;

-- AlterTable
ALTER TABLE "Producto" ADD COLUMN     "visibleEnWeb" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Resena" DROP COLUMN "clienteId",
DROP COLUMN "respuestaTaller",
ADD COLUMN     "email" TEXT,
ADD COLUMN     "estado" TEXT NOT NULL DEFAULT 'Pendiente',
ADD COLUMN     "nombre" TEXT NOT NULL,
ADD COLUMN     "respuesta" TEXT,
ADD COLUMN     "servicio" TEXT,
ADD COLUMN     "vehiculo" TEXT,
ALTER COLUMN "calificacion" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "comentario" SET NOT NULL;

-- AlterTable
ALTER TABLE "Trabajador" ADD COLUMN     "direccion" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "fechaIngreso" TEXT,
ADD COLUMN     "observaciones" TEXT,
ADD COLUMN     "porcentajeAfp" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "porcentajeSeguro" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "proximoPago" TEXT,
ADD COLUMN     "sueldoBase" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Transaccion" ADD COLUMN     "categoria" TEXT NOT NULL DEFAULT 'Otros',
ADD COLUMN     "clienteNombre" TEXT,
ADD COLUMN     "hora" TEXT NOT NULL,
ADD COLUMN     "nota" TEXT,
ADD COLUMN     "numero" TEXT NOT NULL,
ALTER COLUMN "fecha" DROP DEFAULT,
ALTER COLUMN "fecha" SET DATA TYPE TEXT;

-- CreateTable
CREATE TABLE "GuiaDetalle" (
    "id" SERIAL NOT NULL,
    "descripcion" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL DEFAULT 1,
    "precioUnit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "numeroGuiaId" INTEGER NOT NULL,

    CONSTRAINT "GuiaDetalle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Usuario" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT,
    "googleId" TEXT,
    "rol" TEXT NOT NULL DEFAULT 'USER',
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Configuracion" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "nombreResponsable" TEXT NOT NULL DEFAULT 'Administrador',
    "email" TEXT NOT NULL DEFAULT 'admin@tallerjp.com',
    "telefono" TEXT NOT NULL DEFAULT '+51 999 888 777',
    "nombreTaller" TEXT NOT NULL DEFAULT 'Frenos y Embragues Juan Pablo',
    "ruc" TEXT NOT NULL DEFAULT '20601234567',
    "direccion" TEXT NOT NULL DEFAULT 'Av. Los Mecánicos 123, Lima',
    "usuario" TEXT NOT NULL DEFAULT 'administrador',
    "password" TEXT NOT NULL DEFAULT 'TallerJuanP2026',
    "notifEmail" BOOLEAN NOT NULL DEFAULT true,
    "notifSMS" BOOLEAN NOT NULL DEFAULT false,
    "notifApp" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Configuracion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reclamacion" (
    "id" SERIAL NOT NULL,
    "nombres" TEXT NOT NULL,
    "apellidos" TEXT NOT NULL,
    "tipoDocumento" TEXT NOT NULL,
    "numeroDocumento" TEXT NOT NULL,
    "direccion" TEXT NOT NULL,
    "departamento" TEXT NOT NULL,
    "provincia" TEXT NOT NULL,
    "distrito" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "telefonoCelular" TEXT NOT NULL,
    "telefonoFijo" TEXT,
    "bienContratado" TEXT NOT NULL,
    "descripcionBien" TEXT NOT NULL,
    "tipoReclamacion" TEXT NOT NULL,
    "descripcionReclamacion" TEXT NOT NULL,
    "aceptaPrivacidad" BOOLEAN NOT NULL DEFAULT true,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reclamacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Postulacion" (
    "id" SERIAL NOT NULL,
    "nombres" TEXT NOT NULL,
    "apellidoPaterno" TEXT NOT NULL,
    "apellidoMaterno" TEXT NOT NULL,
    "tipoDocumento" TEXT NOT NULL,
    "numeroDocumento" TEXT NOT NULL,
    "direccion" TEXT NOT NULL,
    "departamento" TEXT NOT NULL,
    "provincia" TEXT NOT NULL,
    "distrito" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "areaPostula" TEXT NOT NULL,
    "aceptaPrivacidad" BOOLEAN NOT NULL DEFAULT true,
    "estado" TEXT NOT NULL DEFAULT 'REVISION',
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Postulacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CitaWeb" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "vehiculo" TEXT NOT NULL,
    "mensaje" TEXT,
    "fechaCita" TIMESTAMP(3) NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "fechaSolicitud" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CitaWeb_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BloqueoCita" (
    "id" SERIAL NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "todoElDia" BOOLEAN NOT NULL DEFAULT true,
    "horaInicio" TEXT,
    "horaFin" TEXT,
    "motivo" TEXT,
    "fechaRegistro" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BloqueoCita_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Novedad" (
    "id" SERIAL NOT NULL,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "etiqueta" TEXT,
    "imagen" TEXT,
    "videoUrl" TEXT,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "estado" TEXT NOT NULL DEFAULT 'ACTIVO',
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Novedad_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_googleId_key" ON "Usuario"("googleId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaccion_numero_key" ON "Transaccion"("numero");

-- AddForeignKey
ALTER TABLE "GuiaDetalle" ADD CONSTRAINT "GuiaDetalle_numeroGuiaId_fkey" FOREIGN KEY ("numeroGuiaId") REFERENCES "NumeroGuia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

