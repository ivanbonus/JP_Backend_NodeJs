-- AlterTable
ALTER TABLE "CuentaBancaria" ADD COLUMN     "mapeoExtracto" JSONB;

-- CreateTable
CREATE TABLE "ExtractoBancario" (
    "id" SERIAL NOT NULL,
    "cuentaId" INTEGER NOT NULL,
    "nombreArchivo" TEXT NOT NULL,
    "archivoId" INTEGER,
    "sha256" TEXT NOT NULL,
    "desde" TIMESTAMP(3),
    "hasta" TIMESTAMP(3),
    "lineasTotales" INTEGER NOT NULL DEFAULT 0,
    "lineasNuevas" INTEGER NOT NULL DEFAULT 0,
    "lineasRepetidas" INTEGER NOT NULL DEFAULT 0,
    "importadoPor" TEXT NOT NULL,
    "importadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtractoBancario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineaExtracto" (
    "id" SERIAL NOT NULL,
    "extractoId" INTEGER NOT NULL,
    "cuentaId" INTEGER NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "descripcion" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "monto" DECIMAL(14,2) NOT NULL,
    "numeroOperacion" TEXT,
    "saldo" DECIMAL(14,2),
    "huella" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "movimientoId" INTEGER,
    "conciliadoPor" TEXT,
    "conciliadoEn" TIMESTAMP(3),
    "formaConciliacion" TEXT,
    "notaConciliacion" TEXT,

    CONSTRAINT "LineaExtracto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExtractoBancario_cuentaId_sha256_key" ON "ExtractoBancario"("cuentaId", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "LineaExtracto_movimientoId_key" ON "LineaExtracto"("movimientoId");

-- CreateIndex
CREATE INDEX "LineaExtracto_cuentaId_estado_idx" ON "LineaExtracto"("cuentaId", "estado");

-- CreateIndex
CREATE INDEX "LineaExtracto_cuentaId_fecha_idx" ON "LineaExtracto"("cuentaId", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "LineaExtracto_cuentaId_huella_key" ON "LineaExtracto"("cuentaId", "huella");

-- AddForeignKey
ALTER TABLE "ExtractoBancario" ADD CONSTRAINT "ExtractoBancario_cuentaId_fkey" FOREIGN KEY ("cuentaId") REFERENCES "CuentaBancaria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineaExtracto" ADD CONSTRAINT "LineaExtracto_extractoId_fkey" FOREIGN KEY ("extractoId") REFERENCES "ExtractoBancario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineaExtracto" ADD CONSTRAINT "LineaExtracto_movimientoId_fkey" FOREIGN KEY ("movimientoId") REFERENCES "MovimientoBancario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

