const express = require('express');
const router = express.Router();
const { generatePdf } = require('../controllers/pdfController');

router.get('/generate/:agent_id', async (req, res) => {
    try {
        const agent_id = "17434190437467368827447";//req.params.agent_id;
        const pdfPath = await generatePdf(agent_id);
        res.status(200).send({ message: 'PDF generated successfully', pdfPath });
    } catch (error) {
        res.status(500).send({ error: error.message });
    }
});

module.exports = router;
