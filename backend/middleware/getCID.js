const axios = require('axios');

async function getCID(req, res, next) {
  const id = req.params.id;
  const name_url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(id)}/cids/JSON`;
  const smiles_url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(id)}/cids/JSON`

  try {

    const name_response = await axios.get(name_url);
    const cids_from_name = name_response.data.IdentifierList?.CID;

    if (cids_from_name && cids_from_name.length > 0) {
      req.cid = cids_from_name[0]; // Attach CID to the request object
      next(); // Continue to next middleware or route handler
      return;
    } else {
      console.log("No compound found for CAS/Name: ", id);
    }
  } catch (err) {
    const apiError = err.response?.data?.Fault?.Code;
    if (apiError !== 'PUGREST.NotFound') {
      // Only fail if it’s a real error, not just "not found"
      return res.status(500).json({
        error: 'Failed to get CID by name',
        details: err.message,
      });
    }
    console.log("Name not found, falling back to SMILES...");
  }

  try {
    const smiles_response = await axios.get(smiles_url);
    const cids_from_smiles = smiles_response.data.IdentifierList?.CID;
    if (cids_from_smiles && cids_from_smiles.length > 0) {
      req.cid = cids_from_smiles[0];
      next();
      return;
    }
    else {
      res.status(404).json({error: 'No compound found for ID'});
    }
  } catch (err) {
    res.status(500).json({ error: 'Could not get CID for this smiles number', details: err.message });
  }

}

module.exports = getCID;
