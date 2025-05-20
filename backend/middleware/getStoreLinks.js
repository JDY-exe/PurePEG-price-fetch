const axios = require('axios');

async function getStoreLinks(req, res, next) {
  const cid = req.cid;
  const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/categories/compound/${encodeURIComponent(cid)}/JSON/?heading=Chemical+Vendors`;
  console.log(url);

  try {
    const response = await axios.get(url);
    const vendors = response.data?.SourceCategories.Categories[0].Sources;

    if (vendors && vendors.length > 0) {
      req.vendors = vendors;
      next();
    } else {
      res.status(404).json({ error: 'Vendors not found for given CAS number' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch Vendors', details: err.message });
  }
}

module.exports = getStoreLinks;
