-- AlterTable
ALTER TABLE "Configuracion" ADD COLUMN     "umbralRevision" DECIMAL(14,2) NOT NULL DEFAULT 2000;

-- CreateTable
CREATE TABLE "CuentaBancaria" (
    "id" SERIAL NOT NULL,
    "banco" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'CORRIENTE',
    "numero" TEXT,
    "cci" TEXT,
    "moneda" TEXT NOT NULL DEFAULT 'PEN',
    "saldoInicial" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "fechaSaldoInicial" TIMESTAMP(3),
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CuentaBancaria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovimientoBancario" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "tipo" TEXT NOT NULL,
    "cuentaId" INTEGER NOT NULL,
    "metodo" TEXT NOT NULL,
    "contraparteNombre" TEXT,
    "contraparteDoc" TEXT,
    "clienteId" INTEGER,
    "monto" DECIMAL(14,2) NOT NULL,
    "moneda" TEXT NOT NULL,
    "tipoCambio" DECIMAL(10,4),
    "montoPen" DECIMAL(14,2) NOT NULL,
    "numeroOperacion" TEXT,
    "concepto" TEXT NOT NULL,
    "categoria" TEXT NOT NULL DEFAULT 'Otros',
    "transaccionId" INTEGER,
    "numeroGuiaId" INTEGER,
    "referenciaTexto" TEXT,
    "responsable" TEXT NOT NULL,
    "observaciones" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "fechaConciliacion" TIMESTAMP(3),
    "requiereRevision" BOOLEAN NOT NULL DEFAULT false,
    "revisionEstado" TEXT,
    "revisadoPor" TEXT,
    "revisadoEn" TIMESTAMP(3),
    "notaRevision" TEXT,
    "anuladoPor" TEXT,
    "anuladoEn" TIMESTAMP(3),
    "motivoAnulacion" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MovimientoBancario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Archivo" (
    "id" SERIAL NOT NULL,
    "clave" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "tamano" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "almacenamiento" TEXT NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidadId" INTEGER NOT NULL,
    "subidoPor" TEXT NOT NULL,
    "subidoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eliminado" BOOLEAN NOT NULL DEFAULT false,
    "eliminadoPor" TEXT,
    "eliminadoEn" TIMESTAMP(3),

    CONSTRAINT "Archivo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CuentaBancaria_banco_numero_key" ON "CuentaBancaria"("banco", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "MovimientoBancario_codigo_key" ON "MovimientoBancario"("codigo");

-- CreateIndex
CREATE INDEX "MovimientoBancario_fecha_idx" ON "MovimientoBancario"("fecha");

-- CreateIndex
CREATE INDEX "MovimientoBancario_estado_idx" ON "MovimientoBancario"("estado");

-- CreateIndex
CREATE INDEX "MovimientoBancario_requiereRevision_revisionEstado_idx" ON "MovimientoBancario"("requiereRevision", "revisionEstado");

-- CreateIndex
CREATE INDEX "MovimientoBancario_transaccionId_idx" ON "MovimientoBancario"("transaccionId");

-- CreateIndex
CREATE UNIQUE INDEX "MovimientoBancario_cuentaId_numeroOperacion_key" ON "MovimientoBancario"("cuentaId", "numeroOperacion");

-- CreateIndex
CREATE UNIQUE INDEX "Archivo_clave_key" ON "Archivo"("clave");

-- CreateIndex
CREATE INDEX "Archivo_entidad_entidadId_idx" ON "Archivo"("entidad", "entidadId");

-- CreateIndex
CREATE INDEX "Archivo_sha256_idx" ON "Archivo"("sha256");

-- AddForeignKey
ALTER TABLE "MovimientoBancario" ADD CONSTRAINT "MovimientoBancario_cuentaId_fkey" FOREIGN KEY ("cuentaId") REFERENCES "CuentaBancaria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoBancario" ADD CONSTRAINT "MovimientoBancario_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoBancario" ADD CONSTRAINT "MovimientoBancario_transaccionId_fkey" FOREIGN KEY ("transaccionId") REFERENCES "Transaccion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoBancario" ADD CONSTRAINT "MovimientoBancario_numeroGuiaId_fkey" FOREIGN KEY ("numeroGuiaId") REFERENCES "NumeroGuia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

