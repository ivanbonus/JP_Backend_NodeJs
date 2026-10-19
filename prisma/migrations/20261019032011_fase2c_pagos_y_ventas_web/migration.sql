-- AlterTable
ALTER TABLE "Transaccion" ADD COLUMN     "motivoAnulacion" TEXT,
ADD COLUMN     "operacionCliente" TEXT,
ADD COLUMN     "pagoEnPartes" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ventaId" INTEGER,
ADD COLUMN     "verificadoEn" TIMESTAMP(3),
ADD COLUMN     "verificadoPor" TEXT;

-- CreateIndex
CREATE INDEX "Transaccion_ventaId_idx" ON "Transaccion"("ventaId");

-- CreateIndex
CREATE INDEX "Transaccion_estado_idx" ON "Transaccion"("estado");

-- AddForeignKey
ALTER TABLE "Transaccion" ADD CONSTRAINT "Transaccion_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Transaccion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

