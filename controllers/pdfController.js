const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid'); // Import UUID for unique IDs

const { numDifferentiation, formatIsoDateToCustomString } = require('../utils/utilityFunctions');
const { connectToDB, closeDBConnection } = require('../db'); // Assuming db.js manages mongoose connection

// --- Shared Puppeteer Browser Instance ---
// This browser will be launched once when the application starts
// and reused for all subsequent PDF generation requests.
let sharedPuppeteerBrowser = null;

async function getSharedBrowser() {
    if (!sharedPuppeteerBrowser) {
        console.log("[Puppeteer] Launching shared browser instance...");
        sharedPuppeteerBrowser = await puppeteer.launch({
            headless: true, // Use 'new' for new headless mode in recent Puppeteer versions
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-gpu', // Recommended for headless on some systems
                '--no-zygote',   // Recommended for Docker/Linux environments
                '--single-process' // Recommended to reduce memory footprint, but limits true parallelism within browser
            ]
        });
        console.log("[Puppeteer] Shared browser launched.");

        // Optional: Handle browser disconnect/crash to re-initialize
        sharedPuppeteerBrowser.on('disconnected', () => {
            console.error("[Puppeteer] Shared browser disconnected. Re-initializing...");
            sharedPuppeteerBrowser = null; // Clear the instance so a new one is launched on next request
            // In a real app, you might want to gracefully shut down or restart the server here
        });
    }
    return sharedPuppeteerBrowser;
}

// Ensure the shared browser is launched when the module is first loaded or app starts
// You might want to call getSharedBrowser() explicitly in your main app entry file
// or when your server starts up.
getSharedBrowser().catch(err => {
    console.error("Failed to launch shared Puppeteer browser on startup:", err);
    // Depending on your app, you might want to exit or log a critical error
});

// --- Function to close the shared browser gracefully on app shutdown ---
// Call this when your Node.js application is shutting down (e.g., on SIGINT/SIGTERM)
async function closeSharedBrowser() {
    if (sharedPuppeteerBrowser) {
        console.log("[Puppeteer] Closing shared browser instance...");
        await sharedPuppeteerBrowser.close();
        sharedPuppeteerBrowser = null;
        console.log("[Puppeteer] Shared browser closed.");
    }
}

// Register a cleanup handler for when your process exits (e.g., Ctrl+C)
process.on('SIGINT', async () => {
    await closeSharedBrowser();
    process.exit(0); // Exit cleanly
});
process.on('SIGTERM', async () => {
    await closeSharedBrowser();
    process.exit(0);
});

// --- Helper function for rendering templates ---
function renderTemplate(templateString, data) {
    const renderedContent = templateString.replace(/\${(.*?)}/g, (match, key) => {
        const keys = key.split('.');
        let value = data;

        for (const k of keys) {
            if (value && typeof value === 'object' && k in value) {
                value = value[k];
            } else {
                // console.log(`[renderTemplate Debug] Key path '${key}' not found. Returning empty string.`);
                return ''; // Return empty string if key path is not found
            }
        }

        let transformedValue = value;

        // Apply specific transformations based on the 'key'
        if (key === 'instagram_post.content') {
            if (typeof value === 'string') {
                transformedValue = value.split('\n').map(line => `<span>${line}</span><br/>`).join('');
            } else {
                console.warn(`[Templating Warning] instagram_post.content for key '${key}' is not a string. Value: ${value}.`);
                transformedValue = '';
            }
        } else if (key.includes('expected_rent') || key.includes('expected_sell_price') || key.includes('expected_deposit')) {
            if (value !== undefined && value !== null && (typeof value === 'number' || typeof value === 'string')) {
                transformedValue = numDifferentiation(Number(value));
            } else {
                console.warn(`[Templating Warning] Value for currency key '${key}' is not a valid number. Value: ${value}.`);
                transformedValue = '';
            }
        } else if (key.includes('available_from') || key.includes('possession_date')) {
            if (value !== undefined && value !== null) {
                transformedValue = formatIsoDateToCustomString(value);
            } else {
                console.warn(`[Templating Warning] Value for date key '${key}' is undefined or null. Value: ${value}.`);
                transformedValue = '';
            }
        } else if (key === 'customer_locality.location_area') {
            if (Array.isArray(value)) {
                transformedValue = value.map(item => {
                    if (typeof item === 'object' && item !== null && 'main_text' in item) {
                        return item.main_text;
                    }
                    return String(item);
                }).filter(Boolean).join(', ');
            } else if (typeof value === 'string') {
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

        // Uncomment for detailed debugging per key
        // console.log(`[renderTemplate Debug] Processing Key: '${key}'`);
        // console.log(`  -> Original Value (extracted from data):`, value);
        // console.log(`  -> Transformed Value:`, transformedValue);

        return transformedValue !== undefined ? transformedValue : '';
    });

    return renderedContent;
}

// --- Utility to determine document type category ---
function getDocType(collectionName) {
    if (collectionName.includes('property')) {
        return 'property';
    } else if (collectionName.includes('customer')) {
        return 'customer';
    }
    return 'unknown';
}

// --- Fetch Data from DB ---
async function fetchPropertyDataFromDB(agent_id, tempFilePrefix) {
    let allFetchedData = [];
    let jsonBackupPath = path.join(__dirname, `${tempFilePrefix}.json`); // Unique path for this request

    try {
        console.log(`[DB] Fetching data for agent_id: ${agent_id}`);

        if (mongoose.connection.readyState !== 1) {
            console.log("[DB] Mongoose not connected, attempting to connect...");
            await connectToDB(); // Ensure connection is established
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
        const dataToExport = {}; // To store all data for JSON backup

        for (const collectionName of docCollections) {
            console.log(`[DB] Searching in collection: ${collectionName} for agent_id: ${agent_id}`);
            const collection = db.collection(collectionName);
            const documents = await collection.find({ agent_id: agent_id }).toArray();
            dataToExport[collectionName] = documents; // Add to backup object

            if (documents && documents.length > 0) {
                console.log(`[DB] Found ${documents.length} documents in ${collectionName}.`);
                const docTypeCategory = getDocType(collectionName);
                const typedDocuments = documents.map(doc => ({ ...doc, _docTypeCategory: docTypeCategory, _collectionName: collectionName }));
                allFetchedData = allFetchedData.concat(typedDocuments);
            } else {
                console.log(`[DB] No documents found in ${collectionName} for agent_id: ${agent_id}.`);
            }
        }

        // Save the fetched data to a unique JSON file for this request
        fs.writeFileSync(jsonBackupPath, JSON.stringify(dataToExport, null, 2), 'utf8');
        console.log(`[DB] Backup data exported to ${jsonBackupPath}`);

        if (allFetchedData.length === 0) {
            console.warn("[DB] No property or customer data found for this agent_id across all specified collections.");
        }
        console.log(`[DB] Total documents fetched: ${allFetchedData.length}.`);
        return { allFetchedData, jsonBackupPath }; // Return both data and unique path
    } catch (error) {
        console.error("[DB Error] Error fetching data:", error);
        throw error;
    }
}

// --- Main PDF Generation Function ---
async function generatePdf(agent_id) {
    let browserPage = null; // Renamed from 'browser' to 'browserPage' for clarity
    let pdfPath = '';
    let screenshotPath = ''; // Only enabled if screenshot debugging is needed
    let jsonBackupPath = '';

    // Generate a unique identifier for this request
    const requestId = uuidv4();
    const tempFilePrefix = `${agent_id}_${requestId}`;

    try {
        console.log(`[PDF Generation] Starting process for agent_id: ${agent_id}, Request ID: ${requestId}`);

        // Fetch data and get the unique JSON backup file path for this request
        const { allFetchedData, jsonBackupPath: fetchedJsonBackupPath } = await fetchPropertyDataFromDB(agent_id, tempFilePrefix);
        jsonBackupPath = fetchedJsonBackupPath; // Assign to the outer scope variable for cleanup

        if (allFetchedData.length === 0) {
            console.warn("[PDF Generation] No data to generate PDF for. Returning null.");
            return null;
        }

        console.log("[PDF Generation] Reading HTML templates and CSS files...");

        // --- Load Property Template and CSS ---
        const residentialPropertyRentTemplatePath = path.join(__dirname, '../assets/property/residential-property-rent-template.html');
        const residentialPropertySellTemplatePath = path.join(__dirname, '../assets/property/residential-property-sell-template.html');
        const commercialPropertyRentTemplatePath = path.join(__dirname, '../assets/property/commercial-property-rent-template.html');
        const commercialPropertySellTemplatePath = path.join(__dirname, '../assets/property/commercial-property-sell-template.html');
        const propertyCssPath = path.join(__dirname, '../assets/property/styles.css');

        const propertyCssContent = fs.readFileSync(propertyCssPath, 'utf-8');

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

        let combinedBodyContent = ''; // This will hold the concatenated HTML for all items

        // Loop through each fetched data item and render it into the appropriate template
        for (let i = 0; i < allFetchedData.length; i++) {
            const dataItem = allFetchedData[i];
            const docTypeCategory = dataItem._docTypeCategory;
            const collectionName = dataItem._collectionName;
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
                renderedSection = renderTemplate(currentTemplateBody, dataItem);
            } else {
                console.warn(`[PDF Generation] Unknown document type category: ${docTypeCategory}. Skipping item.`);
                continue;
            }

            if (!currentTemplateBody) {
                console.error(`[PDF Generation] Failed to extract body from template for collection: ${collectionName}.`);
                continue;
            }

            combinedBodyContent += renderedSection;

            // Add a page break after each item, except the last one
            if (i < allFetchedData.length - 1) {
                combinedBodyContent += '<div style="page-break-after: always;"></div>';
            }
        }

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

        // --- Use shared browser and open a new page for this request ---
        const browserInstance = await getSharedBrowser();
        browserPage = await browserInstance.newPage(); // Use the browserPage variable

        await browserPage.emulateMediaType('screen');
        await browserPage.setViewport({ width: 375, height: 812, deviceScaleFactor: 2 });

        console.log("[PDF Generation] Setting page content for all items...");
        try {
            await browserPage.setContent(finalHtml, {
                waitUntil: 'networkidle0',
                timeout: 120000
            });
            console.log("[PDF Generation] Page content set successfully.");

            await new Promise(resolve => setTimeout(resolve, 500));
            await browserPage.waitForSelector('.container');
            console.log("[PDF Generation] Page content rendered and selectors available.");

        } catch (setContentError) {
            console.error("[PDF Generation Error] Failed to set page content:", setContentError);
            throw new Error(`Failed to set page content or wait for rendering: ${setContentError.message}`);
        }

        // Optional: Capture screenshot for debugging
        // screenshotPath = path.join(__dirname, `../debug_screenshot_${tempFilePrefix}.png`);
        // await browserPage.screenshot({ path: screenshotPath, fullPage: true });
        // console.log(`[PDF Generation] Debug screenshot saved at: ${screenshotPath}`);

        console.log("[PDF Generation] Generating PDF...");
        // Add agent_id and request ID to the PDF filename
        const outputFileName = `full_details_report_${tempFilePrefix}.pdf`;
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

        const pdfBuffer = await browserPage.pdf(pdfOptions);
        console.log('PDF generated successfully at:', pdfOptions.path);

        console.log("[Email] Setting up nodemailer transporter...");
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: 'vichi100@gmail.com',
                pass: 'rczn dpuj jygw lazc', // Consider using environment variables
            },
        });
        console.log("[Email] Transporter set up. Sending email...");

        const mailOptions = {
            from: 'vichi100@gmail.com',
            to: 'vichi100@gmail.com', // Consider dynamic recipient
            subject: `Generated Full Details Report for Agent ${agent_id}`, // Dynamic subject
            text: 'Please find attached the comprehensive details report.',
            attachments: [
                {
                    filename: path.basename(pdfPath),
                    content: pdfBuffer,
                    contentType: 'application/pdf',
                },
                {
                    filename: `data_backup_${tempFilePrefix}.json`, // Unique filename for JSON in email
                    path: jsonBackupPath, // Use the full unique path here
                    contentType: 'application/json',
                },
                // If screenshot is enabled, uncomment this attachment
                // {
                //     filename: path.basename(screenshotPath),
                //     path: screenshotPath,
                //     contentType: 'image/png',
                // }
            ],
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent: %s', info.messageId);

        return pdfPath;
    } catch (error) {
        console.error('[Error in generatePdf]:', error);
        throw error;
    } finally {
        // --- IMPORTANT: Close only the PAGE, not the entire browser ---
        if (browserPage) {
            console.log("[PDF Generation] Closing browser page...");
            await browserPage.close();
            console.log("[PDF Generation] Browser page closed.");
        }

        // --- Clean up temporary files ---
        const filesToClean = [pdfPath, screenshotPath, jsonBackupPath].filter(Boolean); // Filter out empty paths
        for (const filePath of filesToClean) {
            if (fs.existsSync(filePath)) {
                try {
                    fs.unlinkSync(filePath); // Use sync for robustness in finally, or wrap in async and await
                    console.log(`Temporary file deleted: ${filePath}`);
                } catch (err) {
                    console.error(`Error deleting temporary file ${filePath}:`, err);
                }
            }
        }
    }
}

module.exports = { generatePdf, closeSharedBrowser }; // Export closeSharedBrowser for app shutdown