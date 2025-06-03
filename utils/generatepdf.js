const fs = require('fs');
const pdf = require('pdfkit');

exports.generatePDF = (content, outputPath) => {
    return new Promise((resolve, reject) => {
        const doc = new pdf();
        const writeStream = fs.createWriteStream(outputPath);
        doc.pipe(writeStream);
        doc.text(content);
        doc.end();

        writeStream.on('finish', () => resolve());
        writeStream.on('error', (err) => reject(err));
    });
};

exports.generatePdfFromTemplate = (templateData, outputPath) => {
    return new Promise((resolve, reject) => {
        const doc = new pdf();
        const writeStream = fs.createWriteStream(outputPath);
        doc.pipe(writeStream);

        // Example logic to use template data
        doc.text(`Template Title: ${templateData.title || 'Default Title'}`);
        doc.text(`Template Body: ${templateData.body || 'Default Body'}`);
        doc.end();

        writeStream.on('finish', () => resolve());
        writeStream.on('error', (err) => reject(err));
    });
};
