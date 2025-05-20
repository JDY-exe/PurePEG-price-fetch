const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
const PORT = 3001;
const getCID = require("./middleware/getCID");
const { chromium } = require('playwright');
const getStoreLinks = require("./middleware/getStoreLinks");
const vendorsToScrape = [
  "BLD Pharm",
  "AA BLOCKS",
  "AbaChemScene",
  "Accela ChemBio Inc.",
  "Combi-Blocks",
  "BroadPharm"
]

const responseFormat = {
  "vendorName": "",
  "prices": [
    {
      "quantity": "",
      "price": ""
    }
  ],
  "notes": ""
}

app.use(cors()); // allow requests from your React frontend
app.use(logger);
app.use(express.static(path.join(__dirname, '../frontend/dist')));


// Sample price-scraping endpoint
app.get('/prices/:id', getCID, getStoreLinks, filterVendorsByName, async (req, res) => {
  const vendors = req.vendors;

  let responseArray = [];

  const AA_BLOCKS = vendors.find(vendor => vendor.SourceName === "AA BLOCKS");
  responseArray.push(
    {
      "vendorName": "AA Blocks",
      "prices": AA_BLOCKS ? AA_BLOCKS.SourceRecordURL : ("https://www.aablocks.com/prod/" + encodeURIComponent(req.params.id)), 
      "notes": "link"
    }
  );
  

  const CHEM_SCENE = vendors.find(vendor => vendor.SourceName === "AbaChemScene");
  responseArray.push(
    {
      "vendorName": "AbaChemScene",
      "prices": CHEM_SCENE ? CHEM_SCENE.SourceRecordURL : "Company does not offer this product",
      "notes": CHEM_SCENE ? "link" : "error"
    }
  );
  

  const COMBI_BLOCKS = vendors.find(vendor => vendor.SourceName === "Combi-Blocks");
  responseArray.push(
    {
      "vendorName": "Combi-Blocks",
      "prices": COMBI_BLOCKS? COMBI_BLOCKS.SourceRecordURL : "Company does not offer this product",
      "notes": COMBI_BLOCKS ? "link" : "error"
    }
  );
  

  const ACCELA = vendors.find(vendor => vendor.SourceName === "Accela ChemBio Inc.");
  if (ACCELA) {
    let vendorEntry = {
        "vendorName": "Accela",
        "prices": "",
        "notes": "array"
      }
    try {
      let priceArray = await crawlVendor(crawlAccela, ACCELA);
      vendorEntry.prices = priceArray;
    }
    catch (err) {
      console.error(err);
      vendorEntry.prices = err.toString();
      vendorEntry.notes = "error";
    }
    responseArray.push(vendorEntry);
  }
  else {
    responseArray.push(
      {
        "vendorName": "Accela",
        "prices": "Company does not offer this product",
        "notes": "error"
      }
    )
  }

  const BLD = vendors.find(vendor => vendor.SourceName === "BLD Pharm");
  if (BLD) {
    let vendorEntry = {
        "vendorName": "BLD",
        "prices": "",
        "notes": "array"
      }
    try {
      let priceArray = await crawlVendor(crawlBLD, BLD);
      vendorEntry.prices = priceArray;
    }
    catch (err) {
      console.error(err);
      vendorEntry.prices = err.toString();
      vendorEntry.notes = "error";
    }
    responseArray.push(vendorEntry);
  }
  else {
    responseArray.push(
      {
        "vendorName": "BLD",
        "prices": "Company does not offer this product",
        "notes": "error"
      }
    )
  }
  
  const BroadPharm = vendors.find(vendor => vendor.SourceName === "BroadPharm");
  if (BroadPharm) {
    let vendorEntry = {
        "vendorName": "BroadPharm",
        "prices": "",
        "notes": "array"
      }
    try {
      let priceArray = await crawlVendor(crawlBroadPharm, BroadPharm);
      vendorEntry.prices = priceArray;
    }
    catch (err) {
      console.error(err);
      vendorEntry.prices = err.toString();
      vendorEntry.notes = "error";
    }
    responseArray.push(vendorEntry);
  }
  else {
    responseArray.push(
      {
        "vendorName": "BroadPharm",
        "prices": "Company does not offer this product",
        "notes": "error"
      }
    )
  }

  console.log(responseArray);
  res.status(200).json(responseArray);
});

app.get('/{*any}', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

const crawlVendor = async (crawlFunction, vendor) => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(vendor.SourceRecordURL, { waitUntil: 'domcontentloaded' });
    let arr = await crawlFunction(page);
    await browser.close();
    return arr;
  }
  catch (err) {
    console.error(`Error crawling ${vendor.SourceRecordURL}:`, err);
    await page.screenshot({ path: 'screenshot.png' });  // Take a screenshot to inspect
    throw (err);
  }
  finally {
    await browser.close();
  }

}

const crawlAABlocks = async (page) => {
  // Wait for at least one product row

  await page.waitForSelector('.layui-row.pack', { timeout: 10000 });


  // Evaluate inside the page context
  const products = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.layui-row.pack'));
    return rows.map(row => {
      const cols = row.querySelectorAll('div');

      const amount = cols[0]?.innerText.trim();
      const priceDiv = cols[3];

      // Find all span elements in the price column
      const priceSpans = priceDiv?.querySelectorAll('span');
      const discountedPrice = priceSpans?.[priceSpans.length - 1]?.innerText.trim();

      return { amount, price: discountedPrice };
    }).filter(item => item.amount && item.price);
  });

  console.log(products);
}

const crawlChemScene = async (page) => {
  await page.waitForSelector('.product-standard-table');

  // Extract product details
  const products = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.product-standard-table tbody tr[data-bind="visible: $data.isVaid"]'));
    return rows.map(row => {
      // Extract size
      const size = row.querySelector('td span[data-bind="html: specification"]')?.innerText.trim();

      // Extract stock status
      const stock = row.querySelector('td.text-primary')?.innerText.trim();

      // Extract price
      const price = row.querySelector('td.text-E93F19 span[data-bind="html: $root.countTransactionPrice(price, customPrice)"]')?.innerText.trim();

      // Extract estimated delivery time (if available)
      const edt = row.querySelector('td span[data-bind="html: $root.calculateEDT(0, specification, webProductStocks, packageType)"]')?.innerText.trim();

      // Extract quantity input (optional for scraping user-entered quantity)
      const quantity = row.querySelector('input.product-qty')?.value.trim();

      return { size, stock, price, edt, quantity };
    });
  });

  console.log(products);
}

const crawlAccela = async (page) => {
  await page.waitForSelector('tr.tr', { timeout: 5000 });

  // Scrape data
  const products = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('tr.tr'));

    return rows.map(row => {
      const cells = row.querySelectorAll('td');

      const unit = cells[2]?.innerText.trim();
      const price = cells[3]?.innerText.trim();

      return {
        "quantity": unit,
        "price": price
      };
    });
  });

  return products;
}

const crawlBLD = async (page) => {
  try {
    await page.waitForSelector('.location_selt', { timeout: 5000 });

    const popupVisible = await page.locator('.location_selt').isVisible();
    if (popupVisible) {
      const usUSDLink = page.locator('span[key="United States"] ~ a', { hasText: 'USD' });
      await usUSDLink.first().click();
      await page.waitForLoadState('domcontentloaded');
    }
  } catch (err) {
    console.log('Currency popup not found or already dismissed.');
  }
  await page.waitForSelector('table.pro_table tbody tr', { timeout : 5000 });


  const products = await page.evaluate(() => {
  const rows = document.querySelectorAll('table.pro_table tbody tr');
  const data = [];

  for (const row of rows) {
    const size = row.getAttribute('size');
    if (!size) continue;

    const cells = row.querySelectorAll('td');
    const getText = (cell) => cell?.innerText.trim() || '';
    const unit = getText(cells[0]);
    const price = getText(cells[1]);

    data.push({
      quantity: unit,
      price: price,
    });
  }

  return data;
  });
  return products;
}

const crawlBroadPharm = async (page) => {
  try {
    await page.waitForSelector('form.single-product ul');
  }
  catch (err) {
    page.screenshot({path: "screenshot.png"});
    throw err;
  }
  

  const products = await page.evaluate(() => {
    const productBlocks = document.querySelectorAll('form.single-product > ul > ul'); // each <ul> under the main one
    const data = [];

    productBlocks.forEach(block => {
      const nameElem = block.querySelector('li.name');
      const priceElem = block.querySelector('li.price');

      if (nameElem && priceElem) {
        const quantity = nameElem.textContent.trim();
        const price = priceElem.textContent.trim();

        data.push({ quantity, price });
      }
    });

    return data;
  });

  return products;
}

function logger(req, res, next) {
  console.log(req.originalUrl);
  next();
}

function filterVendorsByName(req, res, next) {
  const filteredVendors = req.vendors.filter(vendor => vendorsToScrape.includes(vendor.SourceName));
  req.vendors = filteredVendors;
  next();
}


app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
