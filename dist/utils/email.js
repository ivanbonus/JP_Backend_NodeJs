"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.enviarCotizacionEmail = void 0;
const nodemailer_1 = __importDefault(require("nodemailer"));
const dotenv_1 = __importDefault(require("dotenv"));
const prisma_1 = require("../prisma");
dotenv_1.default.config();
/**
 * Función para enviar un correo electrónico usando Nodemailer.
 * Asegúrate de haber configurado EMAIL_USER y EMAIL_PASS en el .env
 */
const enviarCotizacionEmail = async (to, subject, html, pdfBuffer, pdfFilename) => {
    try {
        const config = await prisma_1.prisma.configuracion.findFirst();
        const fromName = config?.nombreTaller || "Frenos y Embragues Juan Pablo";
        const replyToEmail = config?.email || process.env.EMAIL_USER;
        // Configuración del transporter
        const transporter = nodemailer_1.default.createTransport({
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
    }
    catch (error) {
        console.error('Error al enviar correo:', error);
        throw error;
    }
};
exports.enviarCotizacionEmail = enviarCotizacionEmail;
