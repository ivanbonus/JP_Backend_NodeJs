-- AlterTable
ALTER TABLE "Configuracion" ADD COLUMN     "umbralAlzaCosto" DECIMAL(5,2) NOT NULL DEFAULT 10;

-- AlterTable
ALTER TABLE "DetalleCompra" ADD COLUMN     "noInventariable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "unidadesPorCantidad" DECIMAL(14,4) NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "MovimientoInventario" ADD COLUMN     "costoUnitario" DECIMAL(14,4),
ADD COLUMN     "detalleCompraId" INTEGER,
ADD COLUMN     "observacion" TEXT,
ADD COLUMN     "responsable" TEXT,
ADD COLUMN     "revierteId" INTEGER,
ADD COLUMN     "stockResultante" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "MovimientoInventario_revierteId_key" ON "MovimientoInventario"("revierteId");

-- CreateIndex
CREATE INDEX "MovimientoInventario_productoId_fecha_idx" ON "MovimientoInventario"("productoId", "fecha");

-- CreateIndex
CREATE INDEX "MovimientoInventario_detalleCompraId_idx" ON "MovimientoInventario"("detalleCompraId");

-- AddForeignKey
ALTER TABLE "MovimientoInventario" ADD CONSTRAINT "MovimientoInventario_detalleCompraId_fkey" FOREIGN KEY ("detalleCompraId") REFERENCES "DetalleCompra"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoInventario" ADD CONSTRAINT "MovimientoInventario_revierteId_fkey" FOREIGN KEY ("revierteId") REFERENCES "MovimientoInventario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

