import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
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
        // Configuración del transporter (por defecto Gmail, pero puede adaptarse)
        const transporter = nodemailer.createTransport({
            service: 'gmail', // O el host SMTP de tu preferencia
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
            },
        });

        const mailOptions = {
            from: `"Frenos y Embragues Juan Pablo" <${process.env.EMAIL_USER}>`,
            to,
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
