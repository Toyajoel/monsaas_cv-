const express = require('express');
const cors = require('cors');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const Tesseract = require('tesseract.js');
const Groq = require('groq-sdk');
const axios = require('axios');
const { uuid } = require('uuidv4');
const pool = require('./db.cjs');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// --------------------------------------------------------
// ROUTE 1: Extraire le texte d'un PDF ou d'une IMAGE
// --------------------------------------------------------
app.post('/api/extract-pdf', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Aucun fichier fourni.' });
    }

    const fileBuffer = req.file.buffer;
    const mimeType = req.file.mimetype;
    let extractedText = '';

    if (mimeType === 'application/pdf') {
      const data = await pdfParse(fileBuffer);
      extractedText = data.text;
    } else if (mimeType.startsWith('image/')) {
      const { data: { text } } = await Tesseract.recognize(fileBuffer, 'fra+eng');
      extractedText = text;
    } else {
      return res.status(400).json({ error: 'Format non supporté (utilisez PDF ou Image).' });
    }

    res.json({ text: extractedText });
  } catch (error) {
    console.error('Erreur extraction texte:', error);
    res.status(500).json({ error: 'Erreur lors de la lecture du fichier.' });
  }
});

// --------------------------------------------------------
// ROUTE 2: Générer le CV avec l'IA Groq
// --------------------------------------------------------
app.post('/api/generate-cv', async (req, res) => {
  try {
    const { currentData, jobDescription } = req.body;

    if (!jobDescription) {
      return res.status(400).json({ error: "L'offre d'emploi est requise." });
    }

    const prompt = `
Tu es un expert mondial en recrutement et optimisation de CV (ATS expert).
Voici le profil actuel du candidat en JSON :
${JSON.stringify(currentData, null, 2)}

Voici l'offre d'emploi visée :
"${jobDescription}"

MISSION : Mettre à jour et optimiser le profil du candidat pour que son CV soit parfait pour cette offre précise.
- CHANGE IMPÉRATIVEMENT LE TITRE ("title") pour correspondre EXACTEMENT à l'offre.
- Réinvente la "bio" pour prouver que le candidat est LE candidat idéal.
- Remplace les "skills", "qualite", "methodes" avec les mots-clés exacts de l'offre.
- Transforme les descriptions "experience" et "projet" avec un vocabulaire puissant.
- Utilise toujours \\n pour les sauts de ligne dans les champs longs.

Retourne un objet JSON avec EXACTEMENT ces clés : "title", "bio", "skills", "methodes", "qualite", "langue", "experience", "projet", "education".
    `;

    const completion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.3-70b-versatile',
      response_format: { type: 'json_object' }
    });

    const aiResult = JSON.parse(completion.choices[0].message.content);
    res.json(aiResult);
  } catch (error) {
    console.error('Erreur Groq:', error);
    res.status(500).json({ error: 'Erreur Serveur IA avec Groq.' });
  }
});

// --------------------------------------------------------
// ROUTE 3: Initialiser un paiement GeniusPay
// --------------------------------------------------------
app.post('/api/pay/initiate', async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({ error: 'Le numéro de téléphone est requis.' });
    }

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
      },
      timeout: 15000
    });

    const transactionData = response.data.data;
    const transactionId = transactionData.reference || transactionData.id;

    await pool.query(
      'INSERT INTO transactions (id, phoneNumber, amount, status) VALUES (?, ?, ?, ?)',
      [transactionId, formattedPhone, 650, 'PENDING']
    );

    await pool.query(
      'INSERT IGNORE INTO users (phoneNumber, credits) VALUES (?, ?)',
      [formattedPhone, 0]
    );

    res.json({
      transactionId,
      status: transactionData.status,
      checkoutUrl: transactionData.checkout_url || transactionData.payment_url
    });
  } catch (error) {
    console.error('Erreur GeniusPay Initiation:', error.response?.data || error.message);
    const errorMsg = error.response?.data?.message || "Échec de l'initiation du paiement.";
    res.status(500).json({ error: errorMsg });
  }
});

// --------------------------------------------------------
// ROUTE 4: Vérifier le statut du paiement
// --------------------------------------------------------
app.get('/api/pay/status/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const response = await axios.get(`${process.env.GENIUSPAY_API_URL}/${id}`, {
      headers: {
        'X-API-Key': process.env.GENIUSPAY_PUBLIC_KEY,
        'X-API-Secret': process.env.GENIUSPAY_SECRET_KEY,
      },
      timeout: 10000
    });

    const transactionData = response.data.data;
    const currentStatus = transactionData.status?.toLowerCase();

    if (currentStatus === 'completed' || currentStatus === 'success') {
      const [trans] = await pool.query(
        'SELECT phoneNumber, status FROM transactions WHERE id = ?',
        [id]
      );
      if (trans.length && trans[0].status === 'PENDING') {
        await pool.query('UPDATE transactions SET status = ? WHERE id = ?', [currentStatus, id]);
        await pool.query('UPDATE users SET credits = credits + 5 WHERE phoneNumber = ?', [trans[0].phoneNumber]);
      }
    } else if (currentStatus === 'failed' || currentStatus === 'rejected') {
      await pool.query('UPDATE transactions SET status = ? WHERE id = ?', [currentStatus, id]);
    }

    res.json(transactionData);
  } catch (error) {
    console.error('Erreur GeniusPay Status:', error.message);
    res.status(500).json({ error: 'Impossible de vérifier le statut GeniusPay.' });
  }
});

// --------------------------------------------------------
// ROUTE 5: Récupérer les crédits d'un utilisateur
// --------------------------------------------------------
app.get('/api/credits/:phoneNumber', async (req, res) => {
  try {
    const { phoneNumber } = req.params;
    const [users] = await pool.query(
      'SELECT credits FROM users WHERE phoneNumber = ?',
      [phoneNumber]
    );
    if (!users.length) return res.json({ credits: 0 });
    res.json({ credits: users[0].credits });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la récupération des crédits.' });
  }
});

module.exports = app;

if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(`🚀 Serveur démarré sur le port ${port}`);
  });
}
