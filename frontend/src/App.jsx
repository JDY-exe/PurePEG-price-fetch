import { useState } from 'react';
import axios from 'axios';

import './App.css';


function App() {
  const [data, setData] = useState([]);
  const [id, setId] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function onSubmit(e) {
    setErrorMessage("");
    e.preventDefault();
    if (!id) {
      setErrorMessage("Field cannot be blank!");
      return;
    }
    setIsLoading(true);
    try {
      const res = await axios.get(`http://192.168.1.8:3001/prices/${encodeURIComponent(id)}`);
      setData(res.data);
    } catch (err) {
      console.error(err);

      // If the backend sent a detailed message, use it
      if (err.response && err.response.data && typeof err.response.data === "string") {
        setErrorMessage(err.response.data);
      } else if (err.response && err.response.data && err.response.data.error) {
        setErrorMessage(err.response.data.error);
      } else {
        setErrorMessage("An unexpected error occurred.");
      }
    } finally {
      setIsLoading(false);
    }

  }

  return (
    <div className="relative">
      <div className="max-w-4xl mx-auto p-4">
        <form onSubmit={onSubmit} className="space-y-4 bg-white shadow-md rounded-lg p-6 border border-gray-200">
          <div>
            <label htmlFor="ID" className="text-sm font-medium text-gray-700 block mb-1">
              CAS/Name/SMILES
            </label>
            <input
              id="ID"
              type="text"
              value={id}
              onChange={(e) => setId(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
              placeholder="Input one of the above"
              autoComplete="off"
            />
          </div>
          <button
            type="submit"
            className="w-full bg-blue-600 text-white text-sm font-medium py-2 px-4 rounded-md hover:bg-blue-700 transition"
          >
            {isLoading ? "Loading..." : "Get Prices"}
          </button>
        </form>
        <div className="text-sm font-medium text-red-400 mt-3 mb-1">
          {errorMessage}
        </div>
        

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          {data.map((company) => (
            <Card key={company.vendorName} company={company} />
          ))}
        </div>
      </div>
    </div>
  )
}

function Card({ company }) {
  return (
    <div className="bg-white border border-gray-200 shadow-sm rounded-lg p-4 space-y-2">
      <h2 className="text-lg font-semibold text-gray-800">{company.vendorName}</h2>

      {company.notes === "array" && (
        <table className="w-full text-sm border border-gray-300 rounded">
          <thead className="bg-gray-100 text-gray-700">
            <tr>
              <th className="px-4 py-2 text-left border-b text-black w-1/2">Quantity</th>
              <th className="px-4 py-2 text-left border-b text-black w-1/2">Price</th>
            </tr>
          </thead>
          <tbody>
            {company.prices.map((item, i) => (
              <tr key={i} className="even:bg-gray-50">
                <td className="px-4 py-2 border-b text-gray-900 w-1/2">{item.quantity}</td>
                <td className="px-4 py-2 border-b text-gray-900 w-1/2">{item.price}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {company.notes === "link" && (
        company.prices ? (
          <a
            href={company.prices}
            target="_blank"
            className="text-blue-600 hover:underline break-all text-sm"
          >
            {company.prices}
          </a>
        ) : (
          <div className="text-sm text-gray-500">Company does not offer product</div>
        )
      )}

      {company.notes === "error" && (
        <div className="text-sm text-red-600">
          ERROR: {company.prices}
        </div>
      )}
    </div>
  )
}

export default App
