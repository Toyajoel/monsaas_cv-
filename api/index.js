const express = require('express');
const cors = require('cors');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const Tesseract = require('tesseract.js');
const Groq = require("groq-sdk");
const axios = require('axios');
const { uuid } = require('uuidv4');
const pool = require('./db');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

// Configuration middlewares
app.use(cors());
app.use(express.json());

// Configuration de Multer pour stocker le fichier (PDF ou Image) en mémoire
const upload = multer({ storage: multer.memoryStorage() });

// Configuration Groq
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
    let extractedText = "";

    if (mimeType === 'application/pdf') {
      const data = await pdfParse(fileBuffer);
      extractedText = data.text;
    } else if (mimeType.startsWith('image/')) {
      const { data: { text } } = await Tesseract.recognize(fileBuffer, 'fra+eng');
      extractedText = text;
    } else {
      return res.status(400).json({ error: 'Format de fichier non supporté (utilisez PDF ou Image).' });
    }

    res.json({ text: extractedText });
  } catch (error) {
    console.error('Erreur extraction texte:', error);
    res.status(500).json({ error: 'Erreur lors de la lecture du fichier.' });
  }
});

// --------------------------------------------------------
// ROUTE 2: Générer le CV parfait avec l'IA Groq
// --------------------------------------------------------
app.post('/api/generate-cv', async (req, res) => {
  try {
    const { currentData, jobDescription, phoneNumber } = req.body;

    if (!jobDescription) {
      return res.status(400).json({ error: 'L\'offre d\'emploi (jobDescription) est requise.' });
    }

    // Le numéro n'est plus requis pour l'IA car c'est gratuit
    // On ne vérifie plus les crédits ici

    const prompt = `
Tu es un expert mondial en recrutement et optimisation de CV (ATS expert).
Voici le profil actuel du candidat en JSON :
${JSON.stringify(currentData, null, 2)}

Voici l'offre d'emploi visée :
"${jobDescription}"

MISSION : Mettre à jour et optimiser le profil du candidat pour que son CV soit parfait pour cette offre précise.
- CHANGE IMPÉRATIVEMENT LE TITRE ("title") pour qu'il corresponde EXACTEMENT à la demande de l'offre d'emploi (Même si le candidat était développeur web, s'il postule comme Marketeur, tu le transformes en Marketeur).
- Réinvente et reformule TOTALEMENT la "bio" pour prouver que le candidat est LE candidat idéal pour CE poste précis.
- Remplace, ajuste et invente de nouvelles "skills", "qualite", "methodes" pertinentes qui contiennent les mots-clés exacts de l'offre.
- Transforme complètement les descriptions des "experience" et "projet" pour faire croire que toutes ses missions passées l'ont préparé à cette offre. Utilise un vocabulaire puissant.
- Utilise toujours \\n pour faire de beaux sauts de ligne dans les champs longs.
- Règle d'or de cette application : "Le Client est roi". Tu as le feu vert absolu pour réécrire, adapter, modifier ou inventer tout le contenu (même changer totalement de domaine professionnel) afin de séduire le recruteur pour CETTE RECHERCHE.

Tu DOIS retourner un objet JSON avec EXACTEMENT ces clés (et aucune autre) : "title", "bio", "skills", "methodes", "qualite", "langue", "experience", "projet", "education".
    `;

    // Utilisation de llama-3.3-70b-versatile sur Groq
    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" }
    });

    const aiResult = JSON.parse(completion.choices[0].message.content);
    // On ne décompte plus de crédit car l'IA est gratuite
    res.json(aiResult);

  } catch (error) {
    console.error('Erreur API Génération CV avec Groq:', error);
    res.status(500).json({ error: 'Erreur Serveur IA avec Groq.' });
  }
});

// --------------------------------------------------------
// ROUTE 3: Initialiser un paiement GeniusPay (Mode Auto-Détection)
// --------------------------------------------------------
app.post('/api/pay/initiate', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({ error: "Le numéro de téléphone est requis." });
    }

    // On s'assure que le numéro a l'indicatif +237 (Cameroun) pour l'auto-détection
    let formattedPhone = phoneNumber.trim().replace(/\s/g, '');
    if (!formattedPhone.startsWith('+')) {
      formattedPhone = formattedPhone.length === 9 ? `+237${formattedPhone}` : `+${formattedPhone}`;
    }

    const payload = {
      amount: 650,
      description: "Achat de 5 crédits CV AI (Cameroun)",
      customer: {
        phone: formattedPhone
      }
    };

    const response = await axios.post(process.env.GENIUSPAY_API_URL, payload, {
      headers: {
        'X-API-Key': process.env.GENIUSPAY_PUBLIC_KEY,
        'X-API-Secret': process.env.GENIUSPAY_SECRET_KEY,
        'Content-Type': 'application/json'
      }
    });

    const transactionData = response.data.data;
    const transactionId = transactionData.reference || transactionData.id;

    // Sauvegarder la transaction dans TiDB
    await pool.query('INSERT INTO transactions (id, phoneNumber, amount, status) VALUES (?, ?, ?, ?)', 
      [transactionId, formattedPhone, 650, 'PENDING']);
    
    // S'assurer que l'utilisateur existe dans TiDB
    await pool.query('INSERT IGNORE INTO users (phoneNumber, credits) VALUES (?, ?)', [formattedPhone, 0]);

    res.json({ 
      transactionId: transactionId, 
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
// ROUTE 4: Vérifier le statut du paiement et créditer
// --------------------------------------------------------
app.get('/api/pay/status/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const response = await axios.get(`${process.env.GENIUSPAY_API_URL}/${id}`, {
      headers: {
        'X-API-Key': process.env.GENIUSPAY_PUBLIC_KEY,
        'X-API-Secret': process.env.GENIUSPAY_SECRET_KEY,
      }
    });
    
    const transactionData = response.data.data;
    const currentStatus = transactionData.status?.toLowerCase();

    // Si le paiement est réussi, on crédite l'utilisateur
    if (currentStatus === 'completed' || currentStatus === 'success') {
      const [trans] = await pool.query('SELECT phoneNumber, status FROM transactions WHERE id = ?', [id]);
      
      if (trans.length && trans[0].status === 'PENDING') {
        // Mettre à jour la transaction
        await pool.query('UPDATE transactions SET status = ? WHERE id = ?', [currentStatus, id]);
        // Ajouter les crédits (5 crédits pour 650 FCFA)
        await pool.query('UPDATE users SET credits = credits + 5 WHERE phoneNumber = ?', [trans[0].phoneNumber]);
      }
    } else if (currentStatus === 'failed' || currentStatus === 'rejected') {
      await pool.query('UPDATE transactions SET status = ? WHERE id = ?', [currentStatus, id]);
    }

    res.json(transactionData);
  } catch (error) {
    console.error('Erreur GeniusPay Status:', error.message);
    res.status(500).json({ error: "Impossible de vérifier le statut GeniusPay." });
  }
});

// --------------------------------------------------------
// ROUTE 5: Récupérer les crédits d'un utilisateur
// --------------------------------------------------------
app.get('/api/credits/:phoneNumber', async (req, res) => {
  try {
    const { phoneNumber } = req.params;
    const [users] = await pool.query('SELECT credits FROM users WHERE phoneNumber = ?', [phoneNumber]);
    if (!users.length) {
      return res.json({ credits: 0 });
    }
    res.json({ credits: users[0].credits });
  } catch (error) {
    res.status(500).json({ error: "Erreur lors de la récupération des crédits." });
  }
});

module.exports = app;

if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(`🚀 Serveur IA démarré avec succès sur le port ${port}`);
  });
}
