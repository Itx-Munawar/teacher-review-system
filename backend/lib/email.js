// Outgoing email (Gmail SMTP via nodemailer).

const nodemailer = require('nodemailer');

// Email transporter
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

const sendEmail = async (to, subject, html) => {
    try {
        await transporter.sendMail({
            from: `"Teacher Reviews" <${process.env.EMAIL_USER}>`,
            to,
            subject,
            html
        });
        console.log(`✅ Email sent to ${to}`);
        return true;
    } catch (error) {
        console.error('❌ Email error:', error);
        return false;
    }
};

module.exports = {
    transporter,
    sendEmail
};
