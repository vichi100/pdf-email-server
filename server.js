const express = require('express');
const bodyParser = require('body-parser');
const pdfEmailRoutes = require('./routes/pdfEmailRoutes');
const emailRoutes = require('./routes/emailRoutes');

const app = express();
// const PORT = 3000;

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Export PORT and HOST for use in other parts of the application
module.exports = { PORT, HOST };

app.use((req, res, next) => {
    console.log(`Incoming request: ${req.method} ${req.url}`);
    next();
});

// Middleware
app.use(bodyParser.json());
app.use('/emailpdf', pdfEmailRoutes);
app.use('/email', emailRoutes);

// Start the server
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running on http://${HOST}:${PORT}`);
  });
