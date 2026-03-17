/*
  Warnings:

  - The primary key for the `_GuiaTrabajadores` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - A unique constraint covering the columns `[A,B]` on the table `_GuiaTrabajadores` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Producto" ADD COLUMN     "foto" TEXT;

-- AlterTable
ALTER TABLE "_GuiaTrabajadores" DROP CONSTRAINT "_GuiaTrabajadores_AB_pkey";

-- CreateIndex
CREATE UNIQUE INDEX "_GuiaTrabajadores_AB_unique" ON "_GuiaTrabajadores"("A", "B");
