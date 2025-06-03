const express = require('express');
const router = express.Router();
const { generatePdf } = require('../controllers/pdfController');

router.post('/generate', async (req, res) => {
    try {
        const agent_id = "17434188543883987866347";//req.params.propertyId;
        const pdfPath = await generatePdf(agent_id);
        res.status(200).send({ message: 'PDF generated successfully', pdfPath });
    } catch (error) {
        res.status(500).send({ error: error.message });
    }
});

module.exports = router;
