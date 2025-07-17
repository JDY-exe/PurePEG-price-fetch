/**
 * @fileoverview Express backend for scraping product pricing from competitor vendor sites.
 * This refactored version focuses on modularity, scalability, and a robust, consistent API response.
 */

// Core Modules
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Middleware & APIs
const getCID = require("./middleware/getCID");
const getStoreLinks = require("./middleware/getStoreLinks");
const { chromium } = require('playwright');
const WooCommerceRestApi = require('@woocommerce/woocommerce-rest-api');
const dotenv = require("dotenv");

dotenv.config();

// =================================================================
// INITIALIZATION & CONFIGURATION
// =================================================================

const app = express();
const PORT = process.env.PORT || 3001;

// WooCommerce API Client Setup
const wc_API = new WooCommerceRestApi.default({
  url: process.env.WC_API_URL,
  consumerKey: process.env.WC_KEY,
  consumerSecret: process.env.WC_SECRET,
  version: 'wc/v3'
});

// Load local product cache on startup
let purePEGCache = [];
try {
    if (fs.existsSync('./meta/cache-array.json')) {
        purePEGCache = JSON.parse(fs.readFileSync("./meta/cache-array.json"));
        console.log("Successfully loaded PurePEG product cache.");
    } else {
        console.warn("Warning: Could not find PurePEG cache file at './meta/cache-array.json'.");
    }
} catch (error) {
    console.error("Error loading or parsing PurePEG cache file:", error);
}


// =================================================================
// VENDOR SCRAPING CONFIGURATION
// =================================================================
/**
 * Central configuration for all vendors to be scraped.
 * This array-driven approach allows for easy addition, removal, or modification of vendors
 * without changing the primary application logic.
 *
 * Each object defines:
 * - vendorName: The user-facing name of the vendor.
 * - sourceName: The identifier used in the 'getStoreLinks' middleware.
 * - type: The method of data retrieval ('api', 'crawl', 'link').
 * - handler: The async function responsible for fetching the data for this vendor.
 * - crawlFn (optional): The specific Playwright crawl function if type is 'crawl'.
 */
const VENDOR_CONFIG = [
    {
        vendorName: "PurePEG",
        sourceName: "PurePEG", // This is a placeholder, as it's handled specially
        type: 'api',
        handler: handlePurePegApi
    },
    {
        vendorName: "Accela",
        sourceName: "Accela ChemBio Inc.",
        type: 'crawl',
        handler: handleCrawlableVendor,
        crawlFn: crawlAccela,
    },
    {
        vendorName: "BLD",
        sourceName: "BLD Pharm",
        type: 'crawl',
        handler: handleCrawlableVendor,
        crawlFn: crawlBLD,
    },
    {
        vendorName: "BroadPharm",
        sourceName: "BroadPharm",
        type: 'crawl',
        handler: handleCrawlableVendor,
        crawlFn: crawlBroadPharm,
    },
    {
        vendorName: "AA Blocks",
        sourceName: "AA BLOCKS",
        type: 'link',
        handler: handleLinkOnlyVendor,
        searchUrl: "https://www.aablocks.com/prod/",
    },
    {
        vendorName: "AbaChemScene",
        sourceName: "AbaChemScene",
        type: 'link',
        handler: handleLinkOnlyVendor
    },
    {
        vendorName: "Combi-Blocks",
        sourceName: "Combi-Blocks",
        type: 'link',
        handler: handleLinkOnlyVendor
    },
];


// =================================================================
// EXPRESS MIDDLEWARE
// =================================================================

app.use(cors()); // Allow requests from any origin
app.use((req, res, next) => { // Custom logger
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
    next();
});
app.use(express.static(path.join(__dirname, '../frontend/dist')));


// =================================================================
// API ROUTES
// =================================================================

/**
 * @api {get} /prices/:id Request competitor pricing for a given product ID
 * @apiName GetPrices
 * @apiGroup Prices
 *
 * @apiParam {String} id Product identifier (CAS, SMILES, or item name).
 *
 * @apiSuccess {Object[]} response An array of vendor price information objects.
 */
app.get('/prices/:id', getCID, getStoreLinks, async (req, res) => {
    const searchTerm = req.params.id;
    // The `req.vendors` is populated by the `getStoreLinks` middleware
    const availableVendors = req.vendors || [];

    // Process all vendors in parallel for maximum efficiency
    const promises = VENDOR_CONFIG.map(config => {
        const vendorData = availableVendors.find(v => v.SourceName === config.sourceName);
        return config.handler({ config, vendorData, searchTerm });
    });

    const results = await Promise.allSettled(promises);

    const responseData = results.map(result => {
        if (result.status === 'fulfilled') {
            return result.value;
        } else {
            // This catches unexpected errors in the handler logic itself
            console.error("A handler promise rejected:", result.reason);
            return {
                vendorName: result.reason.vendorName || "Unknown Vendor",
                status: 'error',
                data: {
                    prices: [],
                    url: null,
                    message: result.reason.message || "An internal error occurred."
                }
            };
        }
    });

    console.log("Sending response to client.");
    res.status(200).json(responseData);
});

// Catch-all route to serve the frontend application
// app.get('/*', (req, res) => {
//     res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
// });


// =================================================================
// VENDOR-SPECIFIC DATA HANDLERS
// =================================================================

/**
 * Creates a standardized response object.
 * @param {string} vendorName - The name of the vendor.
 * @param {'success' | 'error' | 'not_found' | 'link_only'} status - The status of the request.
 * @param {object} data - The payload.
 * @param {Array} [data.prices=[]] - Array of {quantity, price}.
 * @param {string|null} [data.url=null] - The direct URL to the product.
 * @param {string|null} [data.message=null] - Any additional info or error message.
 * @returns {object} Standardized response object.
 */
function formatResponse(vendorName, status, { prices = [], url = null, message = null }) {
    return { vendorName, status, data: { prices, url, message } };
}

/**
 * Handles data retrieval for PurePEG via WooCommerce API.
 */
async function handlePurePegApi({ searchTerm }) {
    const product = purePEGCache.find(p =>
        p.itemName === searchTerm || p.cas === searchTerm || p.smiles === searchTerm
    );

    if (!product) {
        return formatResponse("PurePEG", 'not_found', { message: "Item not found in PurePEG database." });
    }

    try {
        const response = await wc_API.get(`products/${product.productId}/variations`);
        const prices = response.data.map(variation => ({
            quantity: variation.weight,
            price: variation.regular_price
        }));
        return formatResponse("PurePEG", 'success', { prices });
    } catch (error) {
        console.error("Error fetching PurePEG variations:", error.response?.data?.message || error);
        return formatResponse("PurePEG", 'error', { message: "Failed to fetch prices from WooCommerce API." });
    }
}

/**
 * Handles vendors that are not scraped, providing only a link.
 */
async function handleLinkOnlyVendor({ config, vendorData, searchTerm }) {
    const { vendorName, searchUrl } = config;
    if (vendorData) {
        return formatResponse(vendorName, 'link_only', { url: vendorData.SourceRecordURL, message: "Direct link to product page." });
    } else {
        // If the middleware didn't find it, construct a search URL if possible
        if (searchUrl) {
             return formatResponse(vendorName, 'link_only', { url: searchUrl + encodeURIComponent(searchTerm), message: "Direct link to product search page." });
        }
        return formatResponse(vendorName, 'not_found', { message: "This vendor does not offer the product." });
    }
}

/**
 * Handles vendors that require web scraping.
 */
async function handleCrawlableVendor({ config, vendorData }) {
    const { vendorName, crawlFn } = config;
    if (!vendorData) {
        return formatResponse(vendorName, 'not_found', { message: "This vendor does not offer the product." });
    }

    try {
        const prices = await executeCrawl(crawlFn, vendorData.SourceRecordURL);
        if (prices.length === 0) {
            return formatResponse(vendorName, 'success', { prices, url: vendorData.SourceRecordURL, message: "Scraped successfully, but no pricing info found on page." });
        }
        return formatResponse(vendorName, 'success', { prices, url: vendorData.SourceRecordURL });
    } catch (error) {
        console.error(`Error during crawl for ${vendorName}:`, error);
        return formatResponse(vendorName, 'error', { url: vendorData.SourceRecordURL, message: `Scraping failed: ${error.message}` });
    }
}


// =================================================================
// WEB CRAWLER & UTILITIES
// =================================================================

/**
 * Generic Playwright crawler executor.
 * @param {Function} crawlFunction - The specific page evaluation logic for a vendor.
 * @param {string} url - The URL to crawl.
 * @returns {Promise<Array>} A promise that resolves to an array of price objects.
 */
async function executeCrawl(crawlFunction, url) {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    });
    const page = await context.newPage();

    try {
        console.log(`Navigating to ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const priceArray = await crawlFunction(page);
        return priceArray;
    } catch (err) {
        console.error(`Error crawling ${url}:`, err);
        const screenshotPath = `error_screenshot_${new Date().toISOString().replace(/:/g, '-')}.png`;
        await page.screenshot({ path: screenshotPath });
        console.log(`Screenshot saved to ${screenshotPath}`);
        // Re-throw the error to be caught by the handler
        throw err;
    } finally {
        await browser.close();
        console.log(`Browser closed for ${url}`);
    }
}

// --- Individual Crawler Functions ---

async function crawlAccela(page) {
    await page.waitForSelector('tr.tr', { timeout: 10000 });
    return page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('tr.tr'));
        return rows.map(row => {
            const cells = row.querySelectorAll('td');
            return {
                quantity: cells[2]?.innerText.trim(),
                price: cells[3]?.innerText.trim()
            };
        }).filter(p => p.quantity && p.price);
    });
}

async function crawlBLD(page) {
    // Attempt to handle the currency/location popup
    try {
        const popupSelector = '.location_selt';
        await page.waitForSelector(popupSelector, { timeout: 5000 });
        const usUSDLink = page.locator('span[key="United States"] ~ a', { hasText: 'USD' });
        await usUSDLink.first().click();
        await page.waitForLoadState('domcontentloaded');
        console.log("Clicked US/USD currency option.");
    } catch (err) {
        console.log('Currency popup not found or already handled.');
    }

    await page.waitForSelector('table.pro_table tbody tr', { timeout: 10000 });
    return page.evaluate(() => {
        const rows = document.querySelectorAll('table.pro_table tbody tr');
        const data = [];
        rows.forEach(row => {
            if (!row.getAttribute('size')) return; // Skip rows without a 'size' attribute
            const cells = row.querySelectorAll('td');
            data.push({
                quantity: cells[0]?.innerText.trim(),
                price: cells[1]?.innerText.trim(),
            });
        });
        return data.filter(p => p.quantity && p.price);
    });
}

async function crawlBroadPharm(page) {
    await page.waitForSelector('form.single-product ul ul', { timeout: 10000 });
    return page.evaluate(() => {
        const productBlocks = document.querySelectorAll('form.single-product > ul > ul');
        const data = [];
        productBlocks.forEach(block => {
            const quantity = block.querySelector('li.name')?.textContent.trim();
            const price = block.querySelector('li.price')?.textContent.trim();
            if (quantity && price) {
                data.push({ quantity, price });
            }
        });
        return data;
    });
}


// =================================================================
// SERVER START
// =================================================================

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
