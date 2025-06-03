const nodemailer = require('nodemailer');
const { generatePdfFromTemplate } = require('../utils/generatepdf'); // Import generatePdfFromTemplate method

exports.sendEmail = (req, res) => {
    const { recipient, subject, message, pdfTemplateData } = req.body;

    // Generate PDF using generatePdfFromTemplate method
    const pdfPath = `./temp/${Date.now()}_document.pdf`;
    generatePdfFromTemplate(pdfTemplateData, pdfPath)
        .then(() => {
            // Logic to send email with the generated PDF
            res.status(200).json({ message: 'Email sent successfully', pdfPath });
        })
        .catch((err) => {
            res.status(500).json({ error: 'Failed to generate PDF', details: err });
        });
};

exports.checkEmailStatus = (req, res) => {
    const emailId = req.params.emailId;
    // Logic to check email status
    // Example response
    res.status(200).json({ emailId, status: 'Delivered' });
};
