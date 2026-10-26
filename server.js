const express = require('express');
const wppconnect = require('@wppconnect-team/wppconnect');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

let whatsappClient = null;
const SESSION_NAME = 'whatsapp-worker-session'; // Aligned with your Python script token upload
const CF_WORKER_URL = process.env.CF_WORKER_URL; 
const API_SECRET = process.env.API_SECRET;

// Custom token store to fetch pre-authenticated session tokens from Cloudflare D1
const cloudflareTokenStore = {
  saveToken: async (sessionName, token) => {
    try {
      await fetch(`${CF_WORKER_URL}/token/save`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_SECRET}`
        },
        body: JSON.stringify({ sessionName, token })
      });
      console.log('Session token backed up to Cloudflare D1.');
    } catch (err) {
      console.error('Failed to save token to Cloudflare:', err);
    }
  },
  getToken: async (sessionName) => {
    try {
      console.log('Fetching session token from Cloudflare D1...');
      const res = await fetch(`${CF_WORKER_URL}/token/get?session=${sessionName}`, {
        headers: { 'Authorization': `Bearer ${API_SECRET}` }
      });
      const data = await res.json();
      if (data && data.token) {
        console.log('Pre-authenticated session token retrieved from Cloudflare D1.');
        return data.token;
      }
    } catch (err) {
      console.error('Failed to retrieve token from Cloudflare:', err);
    }
    return null;
  },
  removeToken: async () => true,
  tokenExists: async (sessionName) => true,
  listTokens: async () => [SESSION_NAME]
};

// Initialize WPPConnect using the pre-loaded database token
wppconnect.create({
  session: SESSION_NAME,
  autoClose: false,
  headless: true,
  useHere: true,
  tokenStore: cloudflareTokenStore,
  folderNameToken: './tokens',
  browserArgs: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--metrics-recording-only',
    '--no-default-browser-check',
    '--single-process', // Lowers RAM usage for 512MB container limit
    '--headless=new'
  ],
  puppeteerOptions: {
    timeout: 90000
  },
  statusFind: (statusSession) => {
    console.log('WhatsApp Status: ', statusSession);
  },
  logQR: false
})
.then((client) => {
  whatsappClient = client;
  console.log('WhatsApp Client successfully restored and ready via Cloudflare D1 token!');
})
.catch((error) => {
  console.error('Error initializing WhatsApp client:', error);
});

// Secure endpoint called by Cloudflare Worker queue
app.post('/send-message', async (req, res) => {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${API_SECRET}`) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const { phone, message } = req.body;
  if (!whatsappClient) {
    return res.status(503).json({ success: false, error: 'WhatsApp client not ready yet.' });
  }

  try {
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    const formattedPhone = cleanPhone.includes('@c.us') ? cleanPhone : `${cleanPhone}@c.us`;

    const result = await whatsappClient.sendText(formattedPhone, message);
    return res.json({ success: true, result });
  } catch (err) {
    console.error('Error sending message:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/', (req, res) => {
  res.json({ status: 'running', clientReady: whatsappClient !== null });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`OpenWA Render service listening on port ${PORT}`);
});
