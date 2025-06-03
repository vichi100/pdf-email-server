const express = require('express');
const router = express.Router();
const emailController = require('../controllers/emailController');

// Route to send an email
router.post('/send', emailController.sendEmail);

// Route to check email status
router.get('/status/:emailId', emailController.checkEmailStatus);

module.exports = router;
