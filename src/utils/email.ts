import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { prisma } from '../prisma';

dotenv.config();

/**
 * Función para enviar un correo electrónico usando Nodemailer.
 * Asegúrate de haber configurado EMAIL_USER y EMAIL_PASS en el .env
 */
export const enviarCotizacionEmail = async (
    to: string,
    subject: string,
    html: string,
    pdfBuffer: Buffer,
    pdfFilename: string
) => {
    try {
        const config = await prisma.configuracion.findFirst();
        const fromName = config?.nombreTaller || "Frenos y Embragues Juan Pablo";
        const replyToEmail = config?.email || process.env.EMAIL_USER;

        // Configuración del transporter
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
            },
        });

        const mailOptions = {
            from: `"${fromName}" <${process.env.EMAIL_USER}>`,
            to,
            replyTo: replyToEmail,
            subject,
            html,
            attachments: [
                {
                    filename: pdfFilename,
                    content: pdfBuffer,
                    contentType: 'application/pdf',
                },
            ],
        };

        const result = await transporter.sendMail(mailOptions);
        console.log('Correo enviado con éxito:', result.messageId);
        return result;
    } catch (error) {
        console.error('Error al enviar correo:', error);
        throw error;
    }
};
