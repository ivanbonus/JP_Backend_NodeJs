-- AlterTable
ALTER TABLE "Configuracion" ADD COLUMN     "debeCambiarPassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sesionVersion" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "password" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Usuario" ADD COLUMN     "debeCambiarPassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sesionVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "SegundoFactor" (
    "id" SERIAL NOT NULL,
    "cuenta" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT false,
    "codigosRecuperacion" TEXT[],
    "activadoEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SegundoFactor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispositivoVerificacion" (
    "id" SERIAL NOT NULL,
    "cuenta" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "secretoCifrado" TEXT NOT NULL,
    "confirmado" BOOLEAN NOT NULL DEFAULT false,
    "ultimoPaso" INTEGER,
    "ultimoUso" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DispositivoVerificacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Auditoria" (
    "id" SERIAL NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cuenta" TEXT NOT NULL,
    "rol" TEXT,
    "accion" TEXT NOT NULL,
    "entidad" TEXT,
    "entidadId" TEXT,
    "metodo" TEXT,
    "ruta" TEXT,
    "estadoHttp" INTEGER,
    "ip" TEXT,
    "detalle" JSONB,

    CONSTRAINT "Auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SegundoFactor_cuenta_key" ON "SegundoFactor"("cuenta");

-- CreateIndex
CREATE INDEX "DispositivoVerificacion_cuenta_idx" ON "DispositivoVerificacion"("cuenta");

-- CreateIndex
CREATE INDEX "Auditoria_fecha_idx" ON "Auditoria"("fecha");

-- CreateIndex
CREATE INDEX "Auditoria_entidad_entidadId_idx" ON "Auditoria"("entidad", "entidadId");

-- CreateIndex
CREATE INDEX "Auditoria_accion_idx" ON "Auditoria"("accion");

