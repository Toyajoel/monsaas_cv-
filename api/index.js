import express from 'express';
import cors from 'cors';
import multer from 'multer';
import axios from 'axios';
import dotenv from 'dotenv';
import pool from './db.js';
import PDFParser from 'pdf2json';

dotenv.config();

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
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu.' });
    
    const mimeType = req.file.mimetype;
    let extractedText = '';

    console.log(`Extraction débutée pour: ${mimeType}`);

    if (mimeType === 'application/pdf') {
      try {
        const extractPDF = (buffer) => new Promise((resolve, reject) => {
          const pdfParser = new PDFParser(null, 1);
          pdfParser.on("pdfParser_dataError", errData => reject(errData.parserError));
          pdfParser.on("pdfParser_dataReady", () => resolve(pdfParser.getRawTextContent()));
          pdfParser.parseBuffer(buffer);
        });
        extractedText = await extractPDF(req.file.buffer);
      } catch (pdfErr) {
        console.error("PDF Parsing Error:", pdfErr);
        throw new Error(`Échec de lecture du PDF : ${pdfErr.message}`);
      }
    } else if (mimeType.startsWith('image/')) {
      try {
        const { default: Groq } = await import('groq-sdk');
        const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
        const base64Image = req.file.buffer.toString('base64');
        const completion = await groq.chat.completions.create({
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Lis tout le texte (job description ou cv) présent dans cette image et renvoie UNIQUEMENT le texte, sans aucun autre commentaire.' },
                { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } }
              ]
            }
          ],
          model: 'meta-llama/llama-4-scout-17b-16e-instruct'
        });
        extractedText = completion.choices[0].message.content;
      } catch (visionErr) {
        console.error("Groq Vision Error:", visionErr);
        throw new Error(`Échec Vision IA : ${visionErr.message}`);
      }
    }

    if (!extractedText || extractedText.trim().length === 0) {
      return res.status(422).json({ error: "Le fichier est illisible ou vide." });
    }

    res.json({ text: extractedText });
  } catch (error) {
    console.error('Extraction Error:', error.message);
    res.status(500).json({ error: `Erreur interne d'extraction: ${error.message}` });
  }
});

// --------------------------------------------------------
// ROUTE 2: Générer le CV (Chargement à la demande)
// --------------------------------------------------------
app.post('/api/generate-cv', async (req, res) => {
  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch(e){}
    }
    const { currentData, jobDescription } = body;
    if (!currentData || !jobDescription) {
      return res.status(400).json({ error: 'Données CV ou description de poste manquantes.' });
    }

    const { default: Groq } = await import('groq-sdk');
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    const systemPrompt = `Tu es un EXPERT SENIOR en rédaction de CV et en recrutement avec 15 ans d'expérience dans les RH internationales. Tu maîtrises :
- Le COPYWRITING persuasif pour CV (méthode STAR: Situation, Tâche, Action, Résultat)
- L'optimisation ATS (Applicant Tracking System) : tu insères les mots-clés exacts de l'offre
- L'utilisation de VERBES D'ACTION FORTS au passé (Ex: Piloté, Développé, Optimisé, Généré, Conçu, Dirigé, Négocié, Lancé, Transformé, Réduit, Augmenté, Managé)
- La QUANTIFICATION des résultats (%, chiffres, délais)
- La rédaction d'un BIO/RÉSUMÉ accrocheur de 3-4 lignes qui donne envie de lire la suite

Ta mission : transformer un CV ordinaire en un CV qui décroche des entretiens.`;

    const userPrompt = `Analyse cette offre d'emploi et optimise ce CV pour maximiser les chances d'être recruté.

═══════════════════════════════════════
📋 OFFRE D'EMPLOI CIBLE :
═══════════════════════════════════════
${jobDescription}

═══════════════════════════════════════
📄 CV ACTUEL (format JSON) :
═══════════════════════════════════════
${JSON.stringify(currentData, null, 2)}

═══════════════════════════════════════
🎯 RÈGLES DE RÉÉCRITURE OBLIGATOIRES :
═══════════════════════════════════════

1. **BIO** : Rédige un accroche percutant de 3-4 lignes. Commence par le profil, mentionne les années d'expérience, cite 2-3 compétences clés de l'offre, et termine par la valeur ajoutée apportée à l'employeur. Style direct, professionnel, sans "je".

2. **SKILLS (Compétences techniques)** : Liste 6-8 compétences en bullet points "•", triées par pertinence pour CE poste. Reprends les termes EXACTS utilisés dans l'offre pour maximiser le score ATS.

3. **EXPERIENCE** : Pour chaque expérience, réécris les bullets avec des verbes d'action forts + chiffres si possible. Format : "• [Verbe fort passé] [action] [résultat mesurable si possible]". Ex: "• Piloté le déploiement d'une solution CRM pour 200 utilisateurs, réduisant les délais de traitement de 30%".

4. **PROJET** : Mets en avant les projets les plus alignés avec l'offre. Reformule pour montrer l'impact et les technologies/méthodes recherchées.

5. **EDUCATION** : NE PAS juste copier les formations. Réécris chaque formation en mettant en valeur CE QUI INTÉRESSE LE RECRUTEUR dans le contexte de cette offre. Ajoute une ligne de contexte si pertinent (ex: mention, spécialisation, projet de fin d'études lié au poste). Trie par pertinence pour CE poste, pas juste par date. Format : "• [Diplôme] - [École] ([Année])\n  → [Spécialisation ou point fort utile pour ce poste]".

6. **QUALITE** : 4-5 qualités en bullet points "•" directement liées aux besoins du poste (ex: si l'offre demande "autonome" → mets "Autonomie et proactivité").

7. **METHODES** : C'est une section CRITIQUE. Réécris complètement les méthodes de travail pour qu'elles reflètent exactement les pratiques, outils et frameworks mentionnés dans l'offre. Si l'offre mentionne Agile → mets "Méthodologie Agile / Scrum". Si elle mentionne autonomie → "Gestion autonome des priorités". Si elle parle de reporting → "Suivi de KPIs et reporting hebdomadaire". Génère 4-6 méthodes concrètes en bullets "•" adaptées au contexte du poste.

8. **LANGUE** : Conserve les langues existantes, reformule le niveau si nécessaire.

CONTRAINTES ABSOLUES :
- Pour EDUCATION et METHODES : tu peux adapter et enrichir la formulation mais pas inventer des diplômes ou entreprises inexistants
- Tu DOIS obligatoirement réécrire TOUS les champs listés. Ne laisser aucun champ identique à l'original.
- Ne PAS modifier : name, email, phone, address, photo
- Retourner UNIQUEMENT un JSON valide avec les mêmes clés que le CV original
- Chaque champ doit être une STRING (les sauts de ligne avec \\n)`;

    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      model: 'llama-3.3-70b-versatile',
      response_format: { type: 'json_object' },
      temperature: 0.4,
      max_tokens: 4096
    });

    const rawContent = completion.choices[0].message.content;
    let parsed;
    try {
      // Tentative 1 : parse direct
      parsed = JSON.parse(rawContent);
    } catch (e1) {
      try {
        // Tentative 2 : extraire le JSON depuis un bloc markdown ```json ... ```
        const jsonMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[1].trim());
        } else {
          // Tentative 3 : extraire le premier objet JSON { ... } trouvé dans la réponse
          const objMatch = rawContent.match(/\{[\s\S]*\}/);
          if (objMatch) {
            parsed = JSON.parse(objMatch[0]);
          } else {
            throw new Error('Aucun JSON trouvé dans la réponse IA');
          }
        }
      } catch (e2) {
        console.error('JSON parse error from AI:', rawContent.substring(0, 500));
        return res.status(500).json({ error: "L'IA a renvoyé une réponse invalide. Réessayez." });
      }
    }

    res.json(parsed);
  } catch (error) {
    console.error('Erreur generate-cv:', error.message);
    res.status(500).json({ error: `Erreur IA: ${error.message}` });
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
      currency: 'XAF',
      description: 'Achat de 5 crédits CV AI (Cameroun)',
      customer: { 
        name: 'Utilisateur MonCV',
        email: 'paiement@moncv.app',
        phone: formattedPhone 
      },
      payment_method: 'mobile_money',
      success_url: `${req.headers.origin || 'https://moncv.app'}/payment-success`,
      error_url: `${req.headers.origin || 'https://moncv.app'}/payment-error`
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
    console.error('GeniusPay Error Full:', error.response?.data || error.message);
    const errorDetail = error.response?.data?.message || error.response?.data?.error || JSON.stringify(error.response?.data) || error.message;
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
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch(e){}
    }
    const { cvData, jobDescription, history = [], lastUserResponse } = body;
    const { default: Groq } = await import('groq-sdk');
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    const systemPrompt = `Tu es un recruteur francophone expert, sympathique mais exigeant. Tu mènes une simulation d'entretien d'embauche réaliste.
    
CONTEXTE DE L'ENTRETIEN :
POSTE VISÉ : ${jobDescription || 'Non spécifié'}
PROFIL DU CANDIDAT (CV) : ${JSON.stringify(cvData)}

RÈGLES STRICTES DE L'ENTRETIEN :
1. Rôle : Reste TOUJOURS dans ton rôle de recruteur. Ne sors pas du personnage. Ne dis pas "en tant que modèle d'IA".
2. Suivi : Si la transcription vocale du candidat contient des fautes de frappe ou des phrases légèrement étranges (les micros font souvent des erreurs), sois indulgent et essaie de comprendre l'idée générale.
3. Déroulement : 
   - Relance et rebondis TOUJOURS sur la réponse précédente du candidat au lieu de lire une liste de questions génériques.
   - Si la réponse est trop courte, demande des exemples concrets (méthode STAR).
   - Ne pose qu'UNE SEULE question à la fois. Ne pose pas 3 questions dans le même message.
   - Ne parle pas trop. Reste concis.
4. Correction : Fais un retour (feedback) d'UNE ligne très brève sur la réponse du candidat avant de poser ta question suivante. Ex: "C'est un bel exemple d'autonomie." ou "Soyez plus précis la prochaine fois".

Format de sortie strictement JSON :
{
  "feedback": "Court commentaire de 1 ou 2 phrases max sur la réponse du candidat. (Vide si c'est la toute 1ere question)",
  "question": "Ta question d'entretien précise, courte et directe",
  "finished": false
}`;

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

    const rawContent = completion.choices[0].message.content;
    let parsedMatch = rawContent.match(/\{[\s\S]*\}/);
    let parsedJson = parsedMatch ? JSON.parse(parsedMatch[0]) : JSON.parse(rawContent);

    res.json(parsedJson);
  } catch (error) {
    console.error('Erreur Interview:', error);
    res.status(500).json({ error: 'Erreur Coach.' });
  }
});

export default app;
