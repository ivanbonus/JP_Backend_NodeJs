"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmail = void 0;
const nodemailer_1 = __importDefault(require("nodemailer"));
const dotenv_1 = __importDefault(require("dotenv"));
const prisma_1 = require("../prisma");
dotenv_1.default.config();
const transporter = nodemailer_1.default.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});
const sendEmail = async ({ to, subject, text, html }) => {
    try {
        if (!to) {
            console.warn('[MAILER] No recipient email provided. Skipping email.');
            return;
        }
        // Obtener configuración del taller para nombre y reply-to
        let config = await prisma_1.prisma.configuracion.findFirst();
        const fromName = config?.nombreTaller || "Frenos y Embragues Juan Pablo";
        const replyToEmail = config?.email || process.env.EMAIL_USER;
        const info = await transporter.sendMail({
            from: `"${fromName}" <${process.env.EMAIL_USER}>`,
            to,
            replyTo: replyToEmail,
            subject,
            text,
            html
        });
        console.log('[MAILER] Email sent: ', info.messageId);
        return info;
    }
    catch (error) {
        console.error('[MAILER] Error sending email:', error);
        throw error;
    }
};
exports.sendEmail = sendEmail;
