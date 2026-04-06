import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { prisma } from '../prisma';

dotenv.config();

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

interface MailOptions {
    to: string;
    subject: string;
    text: string;
    html?: string;
}

export const sendEmail = async ({ to, subject, text, html }: MailOptions) => {
    try {
        if (!to) {
            console.warn('[MAILER] No recipient email provided. Skipping email.');
            return;
        }

        // Obtener configuración del taller para nombre y reply-to
        let config = await prisma.configuracion.findFirst();
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
    } catch (error) {
        console.error('[MAILER] Error sending email:', error);
        throw error;
    }
};
