import express from 'express';
import cors from 'cors';
import multer from 'multer';
import axios from 'axios';
import pool from './db.js';
import { createRequire } from 'module';
import Tesseract from 'tesseract.js';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

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
      const data = await pdfParse(req.file.buffer);
      extractedText = data.text;
    } else {
      const { data: { text } } = await Tesseract.recognize(req.file.buffer, 'fra+eng');
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
        [transactionId, formattedPhone, 650, 'PENDING']);
      await pool.query('INSERT IGNORE INTO users (phoneNumber, credits) VALUES (?, ?)', [formattedPhone, 0]);
    } catch (dbErr) {
      console.error("DB Error ignored", dbErr.message);
    }

    res.json({
      transactionId,
      status: transactionData.status,
      checkoutUrl: transactionData.checkout_url || transactionData.payment_url
    });
  } catch (error) {
    console.error('GeniusPay Error:', error.response?.data || error.message);
    const errorDetail = error.response?.data?.message || error.response?.data?.error || error.message;
    res.status(500).json({ error: `Erreur GeniusPay: ${errorDetail}` });
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

    const transactionData = response.data.data;
    const currentStatus = transactionData.status?.toLowerCase();

    // Si le paiement est réussi, on crédite l'utilisateur dans la DB
    if (currentStatus === 'completed' || currentStatus === 'success') {
      const [trans] = await pool.query('SELECT phoneNumber, status FROM transactions WHERE id = ?', [req.params.id]);
      
      if (trans.length && trans[0].status === 'PENDING') {
        await pool.query('UPDATE transactions SET status = ? WHERE id = ?', [currentStatus, req.params.id]);
        await pool.query('UPDATE users SET credits = credits + 5 WHERE phoneNumber = ?', [trans[0].phoneNumber]);
        console.log(`✅ Crédits ajoutés pour ${trans[0].phoneNumber}`);
      }
    } else if (currentStatus === 'failed' || currentStatus === 'rejected') {
      await pool.query('UPDATE transactions SET status = ? WHERE id = ?', [currentStatus, req.params.id]);
    }

    res.json(transactionData);
  } catch (error) {
    console.error('Erreur Status:', error.message);
    res.status(500).json({ error: 'Erreur statut.' });
  }
});

app.get('/api/credits/:phoneNumber', async (req, res) => {
  try {
    const [users] = await pool.query('SELECT credits FROM users WHERE phoneNumber = ?', [req.params.phoneNumber]);
    res.json({ credits: users[0]?.credits || 0 });
  } catch (error) {
    res.json({ credits: 0 });
  }
});

// --------------------------------------------------------
// ROUTE 6: Coach d'Entretien (Intelligence)
// --------------------------------------------------------
app.post('/api/interview/next', async (req, res) => {
  try {
    const { cvData, jobDescription, history, lastUserResponse } = req.body;
    const { default: Groq } = await import('groq-sdk');
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    let systemPrompt = `
      Tu es un recruteur expert et exigeant. Tu mènes un entretien d'embauche.
      Voici le CV du candidat : ${JSON.stringify(cvData)}
      Voici le poste visé : ${jobDescription}

      TON RÔLE :
      1. Si c'est le début (pas de history), salue le candidat et pose la première question.
      2. Si le candidat a répondu (${lastUserResponse}), analyse BRIÈVEMENT sa réponse (donne un micro-conseil) puis pose la question suivante.
      3. Sois professionnel, un peu difficile mais constructif.
      4. Tes questions doivent être PRÉCISES par rapport à ses expériences listées dans son CV.

      Format de réponse JSON uniquement :
      {
        "feedback": "Court commentaire sur la réponse précédente (optionnel)",
        "question": "Ta prochaine question d'entretien",
        "finished": false
      }
    `;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.map(h => ({ role: h.role, content: h.content }))
    ];
    
    if (lastUserResponse) {
      messages.push({ role: 'user', content: lastUserResponse });
    }

    const completion = await groq.chat.completions.create({
      messages,
      model: 'llama-3.3-70b-versatile',
      response_format: { type: 'json_object' }
    });

    res.json(JSON.parse(completion.choices[0].message.content));
  } catch (error) {
    console.error('Erreur Interview:', error);
    res.status(500).json({ error: 'Erreur Coach.' });
  }
});

export default app;
