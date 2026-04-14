import express from 'express';
import cors from 'cors';
import multer from 'multer';
import axios from 'axios';
import pool from './db.js';

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

// Route de santé pour vérifier que le serveur répond
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Le serveur répond parfaitement.' });
});

// --------------------------------------------------------
// ROUTE 1: Extraire le texte (Chargement à la demande)
// --------------------------------------------------------
app.post('/api/extract-pdf', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier.' });
    
    const mimeType = req.file.mimetype;
    let extractedText = '';

    if (mimeType === 'application/pdf') {
      const { createRequire } = await import('module');
      const require = createRequire(import.meta.url);
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(req.file.buffer);
      extractedText = data.text;
    } else {
      const Tesseract = await import('tesseract.js');
      const { data: { text } } = await Tesseract.default.recognize(req.file.buffer, 'fra+eng');
      extractedText = text;
    }
    res.json({ text: extractedText });
  } catch (error) {
    res.status(500).json({ error: 'Erreur extraction.' });
  }
});

// --------------------------------------------------------
// ROUTE 2: Générer le CV (Chargement à la demande)
// --------------------------------------------------------
app.post('/api/generate-cv', async (req, res) => {
  try {
    const { currentData, jobDescription } = req.body;
    const { default: Groq } = await import('groq-sdk');
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    const prompt = `Optimise ce CV JSON pour cette offre : ${jobDescription}. CV: ${JSON.stringify(currentData)}`;
    
    const completion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.3-70b-versatile',
      response_format: { type: 'json_object' }
    });

    res.json(JSON.parse(completion.choices[0].message.content));
  } catch (error) {
    res.status(500).json({ error: 'Erreur IA.' });
  }
});

// --------------------------------------------------------
// ROUTE 3: Paiement GeniusPay
// --------------------------------------------------------
app.post('/api/pay/initiate', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: 'Numéro requis.' });

    let formattedPhone = phoneNumber.trim().replace(/\s/g, '');
    if (!formattedPhone.startsWith('+')) {
      formattedPhone = formattedPhone.length === 9 ? `+237${formattedPhone}` : `+${formattedPhone}`;
    }

    const payload = {
      amount: 650,
      description: 'Achat de 5 crédits CV AI (Cameroun)',
      customer: { phone: formattedPhone }
    };

    const response = await axios.post(process.env.GENIUSPAY_API_URL, payload, {
      headers: {
        'X-API-Key': process.env.GENIUSPAY_PUBLIC_KEY,
        'X-API-Secret': process.env.GENIUSPAY_SECRET_KEY,
        'Content-Type': 'application/json'
      }
    });

    const transactionData = response.data.data;
    const transactionId = transactionData.reference || transactionData.id || Date.now().toString();

    // On ignore l'erreur DB pour que le client puisse au moins payer
    try {
      await pool.query('INSERT INTO transactions (id, phoneNumber, amount, status) VALUES (?, ?, ?, ?)',
        [transactionId, phoneNumber, 650, 'PENDING']);
      await pool.query('INSERT IGNORE INTO users (phoneNumber, credits) VALUES (?, ?)', [phoneNumber, 0]);
    } catch (dbErr) {
      console.error("DB Error ignored for checkout flow", dbErr.message);
    }

    res.json({
      transactionId,
      status: transactionData.status,
      checkoutUrl: transactionData.checkout_url || transactionData.payment_url
    });
  } catch (error) {
    console.error('GeniusPay Error:', error.response?.data || error.message);
    res.status(500).json({ error: "Échec de l'initiation." });
  }
});

// --------------------------------------------------------
// ROUTE 4: Statut et Crédits
// --------------------------------------------------------
app.get('/api/pay/status/:id', async (req, res) => {
  try {
    const response = await axios.get(`${process.env.GENIUSPAY_API_URL}/${req.params.id}`, {
      headers: {
        'X-API-Key': process.env.GENIUSPAY_PUBLIC_KEY,
        'X-API-Secret': process.env.GENIUSPAY_SECRET_KEY,
      }
    });
    res.json(response.data.data);
  } catch (error) {
    res.status(500).json({ error: 'Erreur statut.' });
  }
});

app.get('/api/credits/:phoneNumber', async (req, res) => {
  try {
    const [users] = await pool.query('SELECT credits FROM users WHERE phoneNumber = ?', [req.params.phoneNumber]);
    res.json({ credits: users[0]?.credits || 0 });
  } catch (error) {
    res.json({ credits: 0 }); // Fallback silent
  }
});

export default app;
