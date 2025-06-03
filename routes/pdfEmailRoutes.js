const express = require('express');
const router = express.Router();
const { generatePdf } = require('../controllers/pdfController');

router.post('/generate', async (req, res) => {
    try {
        const { req_user_id } = req.body; // Extract agent_id from the request body
        if (!req_user_id) {
            return res.status(400).send({ error: 'agent_id is required in the request body' });
        }
        const agent_id =req_user_id;// //req.params.propertyId;
        const pdfPath = await generatePdf(agent_id);
        res.status(200).send({ message: 'PDF generated successfully', pdfPath });
    } catch (error) {
        res.status(500).send({ error: error.message });
    }
});

module.exports = router;
