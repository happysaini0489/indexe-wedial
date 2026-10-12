const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();

app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://indexe.wedial.in'
  ],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json({ limit: '1mb' }));

// Credentials: local development me credentials.json use karega.
// Hosting par environment variables set hon to unhe use karega.
let credentials;

try {
  if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    credentials = {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
    };
  } else {
    const credentialsPath = path.join(__dirname, 'credentials.json');
    credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
  }
} catch (error) {
  console.error('Google credentials load nahi hue:', error.message);
  process.exit(1);
}

const auth = new google.auth.JWT({
  email: credentials.client_email,
  key: credentials.private_key,
  scopes: ['https://www.googleapis.com/auth/indexing']
});

const INDEXING_API_URL =
  process.env.GOOGLE_INDEXING_API_URL ||
  'https://indexing.googleapis.com/v3/urlNotifications:publish';

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

async function submitUrl(url) {
  try {
    const tokenResponse = await auth.getAccessToken();
    const accessToken = tokenResponse.token;

    if (!accessToken) {
      throw new Error('Google access token nahi mila.');
    }

    const response = await fetch(INDEXING_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url,
        type: 'URL_UPDATED'
      })
    });

    const data = await response.json().catch(() => ({}));

    return {
      success: response.ok,
      url,
      status: response.ok
        ? 'submitted_not_confirmed_indexed'
        : 'error',
      message: response.ok
        ? 'Google ne request receive ki. Iska matlab URL indexed hona confirm nahi hai.'
        : data.error?.message || 'Google API request fail hui.',
      httpStatus: response.status,
      data
    };
  } catch (error) {
    return {
      success: false,
      url,
      status: 'error',
      message: error.message
    };
  }
}

// Single URL
app.post('/api/submit', async (req, res) => {
  const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';

  if (!url) {
    return res.status(400).json({ error: 'URL required hai.' });
  }

  if (!isValidHttpUrl(url)) {
    return res.status(400).json({
      error: 'Valid http:// ya https:// URL daalein.'
    });
  }

  const result = await submitUrl(url);

  // Google API error par bhi result details bhejte hain
  return res.status(result.success ? 200 : 502).json(result);
});

// Bulk URLs (maximum 20 URLs per request)
app.post('/api/submit-bulk', async (req, res) => {
  const input = req.body?.urls;

  if (!Array.isArray(input)) {
    return res.status(400).json({ error: 'URLs ka array required hai.' });
  }

  const urls = [...new Set(
    input
      .filter(url => typeof url === 'string')
      .map(url => url.trim())
      .filter(Boolean)
  )];

  if (urls.length === 0) {
    return res.status(400).json({ error: 'Kam se kam ek valid URL daalein.' });
  }

  if (urls.length > 20) {
    return res.status(400).json({
      error: 'Ek request me maximum 20 URLs bhejein.'
    });
  }

  const invalidUrls = urls.filter(url => !isValidHttpUrl(url));

  if (invalidUrls.length > 0) {
    return res.status(400).json({
      error: 'Kuch URLs valid http/https URLs nahi hain.',
      invalidUrls
    });
  }

  const results = [];

  // Requests ko ek-ek karke bhejte hain
  for (const url of urls) {
    results.push(await submitUrl(url));
  }

  return res.json({
    total: results.length,
    success: results.filter(result => result.success).length,
    failed: results.filter(result => !result.success).length,
    results
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'Server running' });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend running on port ${PORT}`);
});