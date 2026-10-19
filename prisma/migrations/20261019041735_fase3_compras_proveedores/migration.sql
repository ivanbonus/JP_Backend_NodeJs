-- CreateTable
CREATE TABLE "Proveedor" (
    "id" SERIAL NOT NULL,
    "tipoDocumento" TEXT NOT NULL DEFAULT 'RUC',
    "ruc" TEXT NOT NULL,
    "razonSocial" TEXT NOT NULL,
    "nombreComercial" TEXT,
    "direccion" TEXT,
    "telefono" TEXT,
    "email" TEXT,
    "contacto" TEXT,
    "diasCredito" INTEGER NOT NULL DEFAULT 0,
    "cuentaBancaria" TEXT,
    "observaciones" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Proveedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentoCompra" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "serie" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "proveedorId" INTEGER NOT NULL,
    "rucEmisor" TEXT NOT NULL,
    "razonSocialEmisor" TEXT NOT NULL,
    "fechaEmision" TIMESTAMP(3) NOT NULL,
    "fechaVencimiento" TIMESTAMP(3),
    "moneda" TEXT NOT NULL DEFAULT 'PEN',
    "tipoCambio" DECIMAL(10,4),
    "baseImponible" DECIMAL(14,2) NOT NULL,
    "igv" DECIMAL(14,2) NOT NULL,
    "otrosTributos" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "descuentos" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "totalPen" DECIMAL(14,2) NOT NULL,
    "condicionPago" TEXT NOT NULL DEFAULT 'CONTADO',
    "estadoRevision" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "notaRevision" TEXT,
    "revisadoPor" TEXT,
    "revisadoEn" TIMESTAMP(3),
    "estadoPago" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "estadoRecepcion" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "entregadoContabilidad" BOOLEAN NOT NULL DEFAULT false,
    "entregadoContabilidadEn" TIMESTAMP(3),
    "entregadoContabilidadPor" TEXT,
    "origen" TEXT NOT NULL DEFAULT 'MANUAL',
    "observaciones" TEXT,
    "intentosDuplicado" INTEGER NOT NULL DEFAULT 0,
    "estado" TEXT NOT NULL DEFAULT 'ACTIVO',
    "anuladoPor" TEXT,
    "anuladoEn" TIMESTAMP(3),
    "motivoAnulacion" TEXT,
    "registradoPor" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentoCompra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DetalleCompra" (
    "id" SERIAL NOT NULL,
    "documentoId" INTEGER NOT NULL,
    "orden" INTEGER NOT NULL,
    "codigoProveedor" TEXT,
    "descripcion" TEXT NOT NULL,
    "unidad" TEXT NOT NULL DEFAULT 'UND',
    "cantidad" DECIMAL(14,4) NOT NULL,
    "valorUnitario" DECIMAL(14,6) NOT NULL,
    "descuento" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "afectoIgv" BOOLEAN NOT NULL DEFAULT true,
    "igv" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "productoId" INTEGER,
    "cantidadRecibida" DECIMAL(14,4) NOT NULL DEFAULT 0,

    CONSTRAINT "DetalleCompra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AsignacionPago" (
    "id" SERIAL NOT NULL,
    "documentoId" INTEGER NOT NULL,
    "transaccionId" INTEGER NOT NULL,
    "monto" DECIMAL(14,2) NOT NULL,
    "montoPen" DECIMAL(14,2) NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responsable" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'ACTIVA',
    "anuladaPor" TEXT,
    "anuladaEn" TIMESTAMP(3),
    "motivoAnulacion" TEXT,

    CONSTRAINT "AsignacionPago_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Proveedor_ruc_key" ON "Proveedor"("ruc");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentoCompra_codigo_key" ON "DocumentoCompra"("codigo");

-- CreateIndex
CREATE INDEX "DocumentoCompra_proveedorId_idx" ON "DocumentoCompra"("proveedorId");

-- CreateIndex
CREATE INDEX "DocumentoCompra_fechaEmision_idx" ON "DocumentoCompra"("fechaEmision");

-- CreateIndex
CREATE INDEX "DocumentoCompra_estadoPago_idx" ON "DocumentoCompra"("estadoPago");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentoCompra_tipo_rucEmisor_serie_numero_key" ON "DocumentoCompra"("tipo", "rucEmisor", "serie", "numero");

-- CreateIndex
CREATE INDEX "DetalleCompra_documentoId_idx" ON "DetalleCompra"("documentoId");

-- CreateIndex
CREATE INDEX "DetalleCompra_productoId_idx" ON "DetalleCompra"("productoId");

-- CreateIndex
CREATE INDEX "AsignacionPago_documentoId_estado_idx" ON "AsignacionPago"("documentoId", "estado");

-- CreateIndex
CREATE INDEX "AsignacionPago_transaccionId_estado_idx" ON "AsignacionPago"("transaccionId", "estado");

-- AddForeignKey
ALTER TABLE "DocumentoCompra" ADD CONSTRAINT "DocumentoCompra_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "Proveedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetalleCompra" ADD CONSTRAINT "DetalleCompra_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "DocumentoCompra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetalleCompra" ADD CONSTRAINT "DetalleCompra_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AsignacionPago" ADD CONSTRAINT "AsignacionPago_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "DocumentoCompra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AsignacionPago" ADD CONSTRAINT "AsignacionPago_transaccionId_fkey" FOREIGN KEY ("transaccionId") REFERENCES "Transaccion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

