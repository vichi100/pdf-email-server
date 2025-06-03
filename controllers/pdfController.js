const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');

const { numDifferentiation, formatIsoDateToCustomString } = require('../utils/utilityFunctions');
const { connectToDB, closeDBConnection } = require('../db');

/**
 * Safely renders an HTML template by replacing placeholders with data.
 * Placeholders should be in the format ${key} or ${nested.key}.
 * @param {string} templateString The HTML template as a string.
 * @param {object} data The data object to populate the template.
 * @returns {string} The rendered HTML string.
 */
function renderTemplate(templateString, data) {
    const renderedContent = templateString.replace(/\${(.*?)}/g, (match, key) => {
        const keys = key.split('.');
        let value = data;

        for (const k of keys) {
            if (value && typeof value === 'object' && k in value) {
                value = value[k];
            } else {
                console.log(`[renderTemplate Debug] Key path '${key}' not found. Returning empty string.`);
                return '';
            }
        }

        let transformedValue = value;

        // Specific transformations based on the 'key' (the placeholder name)
        if (key === 'instagram_post.content') {
            if (typeof value === 'string') {
                transformedValue = value.split('\n').map(line => `<span>${line}</span><br/>`).join('');
            } else {
                console.warn(`[Templating Warning] instagram_post.content for key '${key}' is not a string. Value: ${value}.`);
                transformedValue = '';
            }
        }
        // --- Apply numDifferentiation ---
        else if (key.includes('expected_rent') || key.includes('expected_sell_price') || key.includes('expected_deposit')) {
            if (value !== undefined && value !== null && (typeof value === 'number' || typeof value === 'string')) {
                transformedValue = numDifferentiation(Number(value)); // Ensure it's a number
            } else {
                console.warn(`[Templating Warning] Value for currency key '${key}' is not a valid number. Value: ${value}.`);
                transformedValue = '';
            }
        }
        // --- Apply formatIsoDateToCustomString ---
        else if (key.includes('available_from') || key.includes('possession_date')) {
            if (value !== undefined && value !== null) {
                transformedValue = formatIsoDateToCustomString(value);
            } else {
                console.warn(`[Templating Warning] Value for date key '${key}' is undefined or null. Value: ${value}.`);
                transformedValue = '';
            }
        }
        // --- CORRECTED HANDLING FOR customer_locality.location_area ---
        else if (key === 'customer_locality.location_area') {
            if (Array.isArray(value)) {
                transformedValue = value.map(item => {
                    // Check if item is an object and has 'main_text' property
                    if (typeof item === 'object' && item !== null && 'main_text' in item) {
                        return item.main_text; // Extract 'main_text'
                    }
                    // If it's a primitive string or something else, convert to string directly
                    return String(item);
                }).filter(Boolean).join(', '); // Filter out any empty strings before joining
            } else if (typeof value === 'string') {
                // This block handles cases where the array might be stringified in the DB
                try {
                    const parsedArray = JSON.parse(value);
                    if (Array.isArray(parsedArray)) {
                        transformedValue = parsedArray.map(item => {
                            if (typeof item === 'object' && item !== null && 'main_text' in item) {
                                return item.main_text;
                            }
                            return String(item);
                        }).filter(Boolean).join(', ');
                    } else {
                        console.warn(`[Templating Warning] Parsed value for '${key}' was not an array after JSON.parse. Value: ${value}.`);
                        transformedValue = value;
                    }
                } catch (e) {
                    console.warn(`[Templating Warning] Could not parse string as JSON array for '${key}'. Using raw string. Value: ${value}. Error: ${e.message}`);
                    transformedValue = value;
                }
            } else {
                console.warn(`[Templating Warning] customer_locality.location_area for key '${key}' is not a string or array. Value: ${value}.`);
                transformedValue = '';
            }
        }

        console.log(`[renderTemplate Debug] Processing Key: '${key}'`);
        console.log(`  -> Original Value (extracted from data):`, value);
        console.log(`  -> Transformed Value:`, transformedValue);

        return transformedValue !== undefined ? transformedValue : '';
    });

    return renderedContent;
}

/**
 * Utility to determine document type category (property or customer) based on collection name.
 * @param {string} collectionName The name of the MongoDB collection.
 * @returns {string} 'property', 'customer', or 'unknown'.
 */
function getDocType(collectionName) {
    if (collectionName.includes('property')) {
        return 'property';
    } else if (collectionName.includes('customer')) {
        return 'customer';
    }
    return 'unknown';
}


/**
 * Fetch property and customer data from the database.
 * Each document will be augmented with a '_docTypeCategory' and '_collectionName' field.
 * @param {string} agent_id The agent ID to query.
 * @returns {Promise<Array>} An array of fetched documents, each with a '_docTypeCategory' and '_collectionName' field.
 */
async function fetchPropertyDataFromDB(agent_id) {
    let allFetchedData = [];
    try {
        console.log(`[DB] Fetching data for agent_id: ${agent_id}`);

        if (mongoose.connection.readyState !== 1) {
            await connectToDB();
        }

        const docCollections = [
            "residential_property_rents",
            "residential_property_sells",
            "commercial_property_rents",
            "commercial_property_sells",
            "commercial_customer_rents",
            "commercial_customer_buys",
            "residential_customer_rents",
            "residential_customer_buys",
        ];

        const db = mongoose.connection.db;

        for (const collectionName of docCollections) {
            console.log(`[DB] Searching in collection: ${collectionName} for agent_id: ${agent_id}`);
            const collection = db.collection(collectionName);
            const documents = await collection.find({ agent_id: agent_id }).toArray();

            if (documents && documents.length > 0) {
                console.log(`[DB] Found ${documents.length} documents in ${collectionName}.`);
                const docTypeCategory = getDocType(collectionName);
                // Add both for robust identification during rendering
                const typedDocuments = documents.map(doc => ({ ...doc, _docTypeCategory: docTypeCategory, _collectionName: collectionName }));
                allFetchedData = allFetchedData.concat(typedDocuments);
            } else {
                console.log(`[DB] No documents found in ${collectionName} for agent_id: ${agent_id}.`);
            }
        }

        if (allFetchedData.length === 0) {
            console.warn("[DB] No property or customer data found for this agent_id across all specified collections.");
        }
        console.log(`[DB] Total documents fetched: ${allFetchedData.length}.`);
        return allFetchedData;
    } catch (error) {
        console.error("[DB Error] Error fetching data:", error);
        throw error;
    }
}

async function generatePdf(agent_id) {
    let browser;
    let pdfPath = '';
    let screenshotPath = '';

    try {
        console.log("[PDF Generation] Fetching all data from DB...");
        const allFetchedData = await fetchPropertyDataFromDB(agent_id);

        if (allFetchedData.length === 0) {
            console.warn("[PDF Generation] No data to generate PDF for. Returning early.");
            return null;
        }

        console.log("[PDF Generation] Reading HTML templates and CSS files...");

        // --- Load Property Template and CSS ---
        // const propertyHtmlTemplatePath = path.join(__dirname, '../assets/property/template.html'); // This is commented out, assume specific templates are used
        const residentialPropertyRentTemplatePath = path.join(__dirname, '../assets/property/residential-property-rent-template.html');
        const residentialPropertySellTemplatePath = path.join(__dirname, '../assets/property/residential-property-sell-template.html');
        const commercialPropertyRentTemplatePath = path.join(__dirname, '../assets/property/commercial-property-rent-template.html');
        const commercialPropertySellTemplatePath = path.join(__dirname, '../assets/property/commercial-property-sell-template.html');

        const propertyCssPath = path.join(__dirname, '../assets/property/styles.css');

        // Read CSS contents once
        const propertyCssContent = fs.readFileSync(propertyCssPath, 'utf-8');

        // Read all property templates
        const propertyRentHtmlTemplate = fs.readFileSync(residentialPropertyRentTemplatePath, 'utf-8');
        const propertySellHtmlTemplate = fs.readFileSync(residentialPropertySellTemplatePath, 'utf-8');
        const commercialRentHtmlTemplate = fs.readFileSync(commercialPropertyRentTemplatePath, 'utf-8');
        const commercialSellHtmlTemplate = fs.readFileSync(commercialPropertySellTemplatePath, 'utf-8');


        // --- Load Customer Template and CSS ---
        const residentialCustomerRentTemplatePath = path.join(__dirname, '../assets/customer/residential-customer-rent-template.html');
        const residentialCustomerBuyTemplatePath = path.join(__dirname, '../assets/customer/residential-customer-buy-template.html');
        const commercialCustomerRentTemplatePath = path.join(__dirname, '../assets/customer/commercial-customer-rent-template.html');
        const commercialCustomerBuyTemplatePath = path.join(__dirname, '../assets/customer/commercial-customer-buy-template.html');
        const customerCssPath = path.join(__dirname, '../assets/customer/customer-styles.css');


        const residentialCustomerRentTemplate = fs.readFileSync(residentialCustomerRentTemplatePath, 'utf-8');
        const residentialCustomerBuyTemplate = fs.readFileSync(residentialCustomerBuyTemplatePath, 'utf-8');
        const commercialCustomerRentTemplate = fs.readFileSync(commercialCustomerRentTemplatePath, 'utf-8');
        const commercialCustomerBuyTemplate = fs.readFileSync(commercialCustomerBuyTemplatePath, 'utf-8');
        const customerCssContent = fs.readFileSync(customerCssPath, 'utf-8');

        // Combine all CSS for embedding in the final HTML head
        const combinedCssContent = `${propertyCssContent}\n${customerCssContent}`;

        let combinedBodyContent = ''; // This will hold the concatenated HTML for all properties/customers

        // Loop through each fetched data item and render it into the appropriate template
        for (let i = 0; i < allFetchedData.length; i++) {
            const dataItem = allFetchedData[i];
            const docTypeCategory = dataItem._docTypeCategory;
            const collectionName = dataItem._collectionName; // Use _collectionName for specific templates
            let renderedSection = '';
            let currentTemplateBody = '';

            console.log(`[PDF Generation] Rendering item ${i + 1}/${allFetchedData.length} (Category: ${docTypeCategory}, Collection: ${collectionName})...`);

            if (docTypeCategory === 'property') {
                if (collectionName === 'residential_property_rents') {
                    currentTemplateBody = propertyRentHtmlTemplate.match(/<body>([\s\S]*?)<\/body>/i)[1];
                } else if (collectionName === 'residential_property_sells') {
                    currentTemplateBody = propertySellHtmlTemplate.match(/<body>([\s\S]*?)<\/body>/i)[1];
                } else if (collectionName === 'commercial_property_rents') {
                    currentTemplateBody = commercialRentHtmlTemplate.match(/<body>([\s\S]*?)<\/body>/i)[1];
                } else if (collectionName === 'commercial_property_sells') {
                    currentTemplateBody = commercialSellHtmlTemplate.match(/<body>([\s\S]*?)<\/body>/i)[1];
                }
                renderedSection = renderTemplate(currentTemplateBody, dataItem);

            } else if (docTypeCategory === 'customer') {
                if (collectionName === 'residential_customer_rents') {
                    currentTemplateBody = residentialCustomerRentTemplate.match(/<body>([\s\S]*?)<\/body>/i)[1];
                } else if (collectionName === 'residential_customer_buys') {
                    currentTemplateBody = residentialCustomerBuyTemplate.match(/<body>([\s\S]*?)<\/body>/i)[1];
                } else if (collectionName === 'commercial_customer_rents') {
                    currentTemplateBody = commercialCustomerRentTemplate.match(/<body>([\s\S]*?)<\/body>/i)[1];
                } else if (collectionName === 'commercial_customer_buys') {
                    currentTemplateBody = commercialCustomerBuyTemplate.match(/<body>([\s\S]*?)<\/body>/i)[1];
                }
                // For customer templates, pass the dataItem directly as the template expects keys like ${customer_locality.city}
                // and it seems 'customer_details' etc. are top-level keys in the dataItem.
                renderedSection = renderTemplate(currentTemplateBody, dataItem);
            } else {
                console.warn(`[PDF Generation] Unknown document type category: ${docTypeCategory}. Skipping item.`);
                continue;
            }

            if (!currentTemplateBody) {
                console.error(`[PDF Generation] Failed to extract body from template for collection: ${collectionName}.`);
                continue; // Skip this item if template body extraction failed
            }

            combinedBodyContent += renderedSection;

            // Add a page break after each item, except the last one
            if (i < allFetchedData.length - 1) {
                combinedBodyContent += '<div style="page-break-after: always;"></div>';
            }
        }

        // Now, construct the final HTML with the combined body content and all CSS
        const finalHtml = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>All Details Report</title>
                <style>${combinedCssContent}</style>
            </head>
            <body>
                ${combinedBodyContent}
            </body>
            </html>
        `;

        console.log("[PDF Generation] Launching Puppeteer browser...");
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        console.log("[PDF Generation] Browser launched. Creating new page...");
        const page = await browser.newPage();

        // Optional: Ensure a specific media type for consistent rendering
        await page.emulateMediaType('screen');

        await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2 });

        console.log("[PDF Generation] Setting page content for all items...");
        try {
            await page.setContent(finalHtml, {
                waitUntil: 'networkidle0', // Wait until network is idle
                timeout: 120000 // Increased timeout for potentially larger content
            });
            console.log("[PDF Generation] Page content set successfully.");

            // Added a short delay and a wait for selector to ensure rendering is complete
            await new Promise(resolve => setTimeout(resolve, 500)); // Wait for 0.5 seconds
            await page.waitForSelector('.container'); // Wait for a key container element to be present
            console.log("[PDF Generation] Page content rendered and selectors available.");

        } catch (setContentError) {
            console.error("[PDF Generation Error] Failed to set page content:", setContentError);
            throw new Error(`Failed to set page content or wait for rendering: ${setContentError.message}`);
        }

        screenshotPath = path.join(__dirname, `../debug_screenshot_${Date.now()}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`[PDF Generation] Debug screenshot saved at: ${screenshotPath}`);

        console.log("[PDF Generation] Generating PDF...");
        const outputFileName = `full_details_report_${Date.now()}.pdf`;
        pdfPath = path.join(__dirname, `../${outputFileName}`);
        const pdfOptions = {
            path: pdfPath,
            format: 'A4',
            printBackground: true,
            margin: {
                top: '0px',
                right: '0px',
                bottom: '0px',
                left: '0px',
            }
        };

        const pdfBuffer = await page.pdf(pdfOptions);
        console.log('PDF generated successfully at:', pdfOptions.path); // Log path from options for clarity

        console.log("[Email] Setting up nodemailer transporter...");
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: 'vichi100@gmail.com',
                pass: 'rczn dpuj jygw lazc',
            },
        });
        console.log("[Email] Transporter set up. Sending email...");

        const mailOptions = {
            from: 'vichi100@gmail.com',
            to: 'vichi100@gmail.com',
            subject: 'Generated Full Details Report',
            text: 'Please find attached the comprehensive details report.',
            attachments: [
                {
                    filename: path.basename(pdfPath),
                    content: pdfBuffer,
                    contentType: 'application/pdf',
                },
                {
                    filename: path.basename(screenshotPath),
                    path: screenshotPath,
                    contentType: 'image/png',
                }
            ],
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent: %s', info.messageId);

        return pdfPath;
    } catch (error) {
        console.error('[Error in generatePdf]:', error);
        throw error;
    } finally {
        if (browser) {
            console.log("[PDF Generation] Closing browser...");
            await browser.close();
            console.log("[PDF Generation] Browser closed.");
        }
        if (pdfPath && fs.existsSync(pdfPath)) {
            fs.unlink(pdfPath, (err) => {
                if (err) console.error('Error deleting temporary PDF file:', err);
                else console.log('Temporary PDF file deleted.');
            });
        }
        if (screenshotPath && fs.existsSync(screenshotPath)) {
            fs.unlink(screenshotPath, (err) => {
                if (err) console.error('Error deleting temporary screenshot file:', err);
                else console.log('Temporary screenshot file deleted.');
            });
        }
    }
}

module.exports = { generatePdf };