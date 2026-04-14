import React, { useState, useEffect } from 'react';
import html2pdf from 'html2pdf.js';
import { Phone, Mail, MapPin, User, Settings, CheckCircle, Globe, Briefcase, GraduationCap, Folder, Sparkles, Bot, Loader2, FileText, Lock, CreditCard } from 'lucide-react';

const API_URL = import.meta.env.PROD ? '' : (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:5000');

function App() {
  const [activeTab, setActiveTab] = useState('form');
  const [data, setData] = useState({
    name: 'VOTRE NOM COMPLET',
    email: 'votre.email@exemple.com',
    phone: '+237 6XX XX XX XX',
    address: 'Ville, Pays',
    title: 'TITRE DU POSTE (Ex: Commerçant, Ingénieur)',
    bio: 'Décrivez ici votre parcours en quelques lignes pour attirer l\'attention des recruteurs...',
    skills: '• Compétence 1\n• Compétence 2\n• Compétence 3',
    langue: '• Français : Langue maternelle\n• Anglais : Courant',
    qualite: '• Rigueur et ponctualité\n• Esprit d\'équipe',
    projet: 'Nom du Projet\n• Description de votre réalisation\n\nAutre Réalisation\n• Détails de ce que vous avez accompli',
    experience: 'Poste Occupé - Nom de l\'Entreprise (Dates)\n• Responsabilités et résultats obtenus',
    education: 'Diplôme Obtenu - Nom de l\'École (Année)\n• Mention ou spécialité',
    methodes: '• Méthode 1\n• Méthode 2',
    photo: null
  });
  const [template, setTemplate] = useState('premium');
  const [themeColor, setThemeColor] = useState('#0b1c3e'); // Dark Blue
  const [accentColor, setAccentColor] = useState('#d97706'); // Orange
  
  // Magic Job Matcher State
  const [jobDescription, setJobDescription] = useState('');
  const [isGeneratingJob, setIsGeneratingJob] = useState(false);

  // Business Logic: Credits & Paywall
  const [credits, setCredits] = useState(0);
  const [showPaywall, setShowPaywall] = useState(false);
  const [mtnNumber, setMtnNumber] = useState(localStorage.getItem('premium_phone') || '');
  const [isPaying, setIsPaying] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState(null); // 'PENDING', 'COMPLETED', 'FAILED'

  // Sync credits with TiDB on mount if phone is present
  useEffect(() => {
    if (mtnNumber) {
      fetch(`${API_URL}/api/credits/${mtnNumber}`)
        .then(res => res.json())
        .then(data => {
          if (data.credits !== undefined) setCredits(data.credits);
        })
        .catch(err => console.error("Erreur sync crédits:", err));
    }
  }, [mtnNumber]);

  const handlePdfUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    setIsGeneratingJob(true);
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      console.log("Envoi du fichier vers :", `${API_URL}/api/extract-pdf`);
      const response = await fetch(`${API_URL}/api/extract-pdf`, {
        method: 'POST',
        body: formData,
      });

      const contentType = response.headers.get("content-type");
      if (!response.ok || !contentType || !contentType.includes("application/json")) {
        const errorText = await response.text();
        console.error("Réponse serveur invalide :", errorText);
        throw new Error(`Le serveur a répondu avec une erreur (Code ${response.status})`);
      }

      const result = await response.json();
      if (result.text) {
        setJobDescription(result.text);
      } else {
        throw new Error(result.error || "Aucun texte n'a pu être extrait.");
      }
    } catch (error) {
      console.error("Erreur complète :", error);
      alert("Erreur : " + error.message);
    } finally {
      setIsGeneratingJob(false);
    }
  };

  const generateJobTailoredCV = async () => {
    setIsGeneratingJob(true);
    try {
      const response = await fetch(`${API_URL}/api/generate-cv`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          currentData: data, 
          jobDescription: jobDescription,
          phoneNumber: mtnNumber || 'FREE_USER'
        })
      });

      const contentType = response.headers.get("content-type");
      if (!response.ok || !contentType || !contentType.includes("application/json")) {
        throw new Error(`Erreur IA (Code ${response.status})`);
      }

      const result = await response.json();
      setData((prev) => ({ ...prev, ...result }));
      setActiveTab('form');
    } catch (error) {
      console.error("Erreur IA :", error);
      alert("Erreur : " + error.message);
    } finally {
      setIsGeneratingJob(false);
    }
  };

  const handleChange = (e) => {
    setData({ ...data, [e.target.name]: e.target.value });
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setData({ ...data, photo: reader.result });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleMtnPayment = async () => {
    if (!mtnNumber) return alert("Veuillez entrer votre numéro MTN");
    setIsPaying(true);
    setPaymentStatus('PENDING');

    try {
      const response = await fetch(`${API_URL}/api/pay/initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: mtnNumber })
      });
      const result = await response.json();

      if (response.ok) {
        // Rediriger ou ouvrir l'URL de checkout dans un nouvel onglet
        if (result.checkoutUrl) {
          window.open(result.checkoutUrl, '_blank');
        }

        // Commencer à vérifier le statut toutes les 3 secondes
        const checkInterval = setInterval(async () => {
          try {
            const statusRes = await fetch(`${API_URL}/api/pay/status/${result.transactionId}`);
            const statusData = await statusRes.json();
            
            // GeniusPay/PawaPay peuvent renvoyer des statuts différents
            const currentStatus = (Array.isArray(statusData) ? statusData[0]?.status : statusData.status)?.toLowerCase();

            if (currentStatus === 'completed' || currentStatus === 'success') {
              clearInterval(checkInterval);
              // Sauvegarder le numéro pour la session
              localStorage.setItem('premium_phone', mtnNumber);
              
              // Refetch credits from server to be sure
              const credRes = await fetch(`${API_URL}/api/credits/${mtnNumber}`);
              const credData = await credRes.json();
              setCredits(credData.credits || 5);

              setShowPaywall(false);
              setPaymentStatus('COMPLETED');
              setIsPaying(false);
              alert("Paiement réussi ! Votre compte a été crédité.");
            } else if (currentStatus === 'failed' || currentStatus === 'rejected' || currentStatus === 'cancelled') {
              clearInterval(checkInterval);
              setPaymentStatus('FAILED');
              setIsPaying(false);
              alert("Le paiement a été rejeté ou a échoué.");
            }
          } catch (e) {
            console.error("Erreur polling status:", e);
          }
        }, 3000);
      } else {
        alert("Erreur de paiement : " + result.error);
        setIsPaying(false);
      }
    } catch (error) {
      alert("Erreur de connexion au service de paiement.");
      setIsPaying(false);
    }
  };

  const handleDownloadPDF = () => {
    if (credits <= 0) {
      setShowPaywall(true);
      return;
    }
    window.scrollTo(0, 0);
    const element = document.getElementById('cv-preview');
    const opt = {
      margin: 0,
      filename: 'mon-cv.pdf',
      image: { type: 'jpeg', quality: 1 },
      html2canvas: { scale: 2, useCORS: true, scrollY: 0 },
      jsPDF: { unit: 'px', format: [794, 1123], orientation: 'portrait' }
    };
    html2pdf().set(opt).from(element).save();
    setCredits(prev => prev - 1);
    alert("Téléchargement réussi ! Il vous reste " + (credits - 1) + " crédits.");
  };


  const renderTextWithBreaks = (text, defaultText) => {
    const content = text || defaultText;
    if (!content) return null;
    return content.split('\n').map((line, idx) => (
      <React.Fragment key={idx}>
        {line}
        <br />
      </React.Fragment>
    ));
  };

  const TitleBannerLeft = ({ icon: Icon, title }) => (
    <div className="relative mb-5 mt-5 h-8 flex items-center pr-2">
      <div
        className="absolute left-4 right-0 top-0 bottom-0 z-0 rounded-r-full border-[1.5px] border-white"
        style={{ backgroundColor: accentColor }}
      ></div>

      <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center shadow-md z-20 border-2 relative shrink-0" style={{ borderColor: accentColor }}>
        <Icon size={16} color={accentColor} />
      </div>

      <div className="pl-6 relative z-10 w-full flex items-center justify-center h-full pr-2">
        <span className="text-white font-bold text-[11px] uppercase tracking-wider block" style={{ textShadow: '1px 1px 2px rgba(0,0,0,0.3)' }}>{title}</span>
      </div>
    </div>
  );

  const TitleBannerRight = ({ title }) => (
    <div className="mb-5 mt-6 flex flex-col w-[100%] -ml-8">
      <div className="relative h-9 shadow-sm w-[96%]">
        <div className="absolute inset-0 z-0">
          <svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 40">
            <polygon points="0,0 100,0 95,40 0,40" fill={themeColor} />
            <rect x="0" y="3" width="100" height="2" fill="white" />
            <rect x="0" y="35" width="100" height="2" fill="white" />
          </svg>
        </div>
        <div className="relative z-10 w-full h-full flex items-center justify-center pr-4">
          <span className="text-white font-bold text-[12px] uppercase tracking-widest pointer-events-none">{title}</span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center py-6">
      <h1 className="text-4xl font-black mb-6 text-gray-900 tracking-tighter">mon<span className="text-blue-600">cv</span></h1>

      <div className="bg-white rounded-none lg:rounded-xl shadow-xl w-full max-w-7xl flex flex-col lg:flex-row overflow-hidden lg:min-h-[850px]">
        {/* Left Panel: Controls */}
        <div className="w-full lg:w-1/3 bg-gray-50 border-b lg:border-b-0 lg:border-r p-4 lg:p-6 flex flex-col h-[500px] lg:h-auto overflow-y-auto">
          <div className="flex space-x-2 mb-4">
            {['form', 'design', 'ia'].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-2 text-[11px] font-bold rounded flex items-center justify-center gap-1 transition-all ${activeTab === tab ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
              >
                {tab === 'form' && '📝 Contenu'}
                {tab === 'design' && '🎨 Design'}
                {tab === 'ia' && <><Sparkles size={12}/> Matcher Offre</>}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto pr-2 text-sm z-10">
            {activeTab === 'ia' && (
              <>
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="bg-gradient-to-br from-purple-600 to-indigo-700 p-5 rounded-xl shadow-lg relative overflow-hidden">
                    <div className="absolute top-0 right-0 -mr-4 -mt-4 opacity-20">
                      <Bot size={100} />
                    </div>
                    <h3 className="text-white font-black text-lg mb-2 relative z-10 flex items-center gap-2">
                      <Sparkles /> Ciblage d'Offre Intelligent
                    </h3>
                    <p className="text-purple-100 text-xs mb-4 relative z-10 leading-relaxed">
                      Collez l'annonce (fiche de poste) ci-dessous ou importez la fiche en PDF. Notre Intelligence Artificielle va réécrire votre Bio, trier vos compétences et formater vos expériences pour correspondre exactement aux attentes du recruteur.
                    </p>

                    <div className="relative z-10 mb-4 bg-white/10 p-3 rounded-lg border border-white/20">
                      <p className="text-white font-bold text-xs mb-2">📊 Étape 1 : Importer votre offre</p>
                      <label className="cursor-pointer bg-white text-purple-700 hover:bg-purple-50 font-black text-xs py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 transition-all shadow-md active:scale-95">
                        <FileText size={16} />
                        IMPORTER L'OFFRE (PDF OU IMAGE)
                        <input type="file" accept=".pdf, .png, .jpg, .jpeg" className="hidden" onChange={handlePdfUpload} />
                      </label>
                      <p className="text-[10px] text-purple-100 mt-2 text-center italic">
                        L'IA va extraire automatiquement le texte du document
                      </p>
                    </div>

                    <p className="text-white font-bold text-xs mb-2 relative z-10">✍️ Ou collez le texte manuellement ici :</p>
                    <textarea 
                      value={jobDescription}
                      onChange={(e) => setJobDescription(e.target.value)}
                      placeholder="Collez ici le descriptif complet du poste..." 
                      className="w-full h-32 p-3 text-sm border-0 rounded-lg shadow-inner focus:ring-2 focus:ring-purple-300 mb-4 bg-white/95 relative z-10 text-gray-800"
                    />

                    <button 
                      onClick={generateJobTailoredCV}
                      disabled={isGeneratingJob || (jobDescription || '').trim().length < 10}
                      className="w-full bg-yellow-400 hover:bg-yellow-300 text-yellow-900 font-bold py-3 px-4 rounded-lg shadow-md transition duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isGeneratingJob ? <Loader2 className="animate-spin" /> : <Bot />}
                      {isGeneratingJob ? 'Analyse et Génération en cours...' : `Adapter mon CV gratuitement`}
                    </button>
                  </div>
                  
                  <div className="bg-gray-50 border border-gray-200 p-4 rounded-lg text-xs leading-relaxed text-gray-600">
                    <strong className="block text-gray-800 mb-1">Comment ça marche ?</strong>
                    Le moteur IA lit votre CV actuel et le croise avec l'offre d'emploi. Il ne ment jamais, mais il réécrit vos phrases (Copywriting) pour mettre en lumière ce que le recruteur veut voir en priorité, maximisant vos chances d'entretien.
                  </div>
                </div>
              </>
            )}

            {activeTab === 'form' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Photo de profil</label>
                  <input type="file" accept="image/*" onChange={handleImageUpload} className="w-full text-xs" />
                </div>
                <input name="name" placeholder="Nom Complet" value={data.name} onChange={handleChange} className="w-full p-2 border rounded" />
                <input name="title" placeholder="Titre (Ex: Développeur)" value={data.title} onChange={handleChange} className="w-full p-2 border rounded" />

                <div className="grid grid-cols-2 gap-2">
                  <input name="email" placeholder="Email" value={data.email} onChange={handleChange} className="w-full p-2 border rounded" />
                  <input name="phone" placeholder="Téléphone" value={data.phone} onChange={handleChange} className="w-full p-2 border rounded" />
                </div>
                <input name="address" placeholder="Adresse" value={data.address} onChange={handleChange} className="w-full p-2 border rounded" />

                <label className="block text-xs font-bold text-gray-600 mb-1 mt-2">Résumé / Bio</label>
                <textarea name="bio" placeholder="Résumé / Bio" value={data.bio} onChange={handleChange} className="w-full p-2 border rounded h-20 text-sm" />

                <label className="block text-xs font-bold text-gray-600 border-t pt-2 mt-4">Colonne de gauche</label>
                <textarea name="skills" placeholder="Compétences" value={data.skills} onChange={handleChange} className="w-full p-2 border rounded h-16" />
                <textarea name="methodes" placeholder="Méthodes de travail" value={data.methodes} onChange={handleChange} className="w-full p-2 border rounded h-16" />
                <textarea name="qualite" placeholder="Qualités" value={data.qualite} onChange={handleChange} className="w-full p-2 border rounded h-16" />
                <textarea name="langue" placeholder="Langues" value={data.langue} onChange={handleChange} className="w-full p-2 border rounded h-16" />

                <label className="block text-xs font-bold text-gray-600 border-t pt-2 mt-4">Colonne de droite</label>
                <textarea name="experience" placeholder="Expériences Professionnelles" value={data.experience} onChange={handleChange} className="w-full p-2 border rounded h-24 text-sm" />
                <textarea name="projet" placeholder="Projets Réalisés" value={data.projet} onChange={handleChange} className="w-full p-2 border rounded h-24 text-sm" />
                <textarea name="education" placeholder="Formations" value={data.education} onChange={handleChange} className="w-full p-2 border rounded h-24" />
              </div>
            )}

            {activeTab === 'design' && (
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Choisir le modèle</label>
                  <div className="space-y-2">
                    <button onClick={() => setTemplate('premium')} className={`w-full p-3 border rounded font-semibold text-left transition-colors ${template === 'premium' ? 'border-blue-600 bg-blue-50 text-blue-700' : 'bg-white hover:bg-gray-50'}`}>
                      👑 CV Premium (Colonne Moderne)
                    </button>
                    <button onClick={() => setTemplate('row')} className={`w-full p-3 border rounded font-semibold text-left transition-colors ${template === 'row' ? 'border-blue-600 bg-blue-50 text-blue-700' : 'bg-white hover:bg-gray-50'}`}>
                      📄 CV Classique (Ligne Simple)
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Couleur Principale (Fond / Titres)</label>
                  <div className="flex flex-wrap gap-2">
                    {['#0b1c3e', '#1e293b', '#0f4c5c', '#1b4332', '#4a0404', '#1e3a8a', '#312e81', '#4c1d95', '#000000'].map(c => (
                      <button
                        key={c}
                        onClick={() => setThemeColor(c)}
                        className={`w-8 h-8 rounded shadow-sm border-2 ${themeColor === c ? 'border-gray-400 scale-110' : 'border-transparent'}`}
                        style={{ backgroundColor: c }}
                        title={c}
                      />
                    ))}
                    <input type="color" value={themeColor} onChange={(e) => setThemeColor(e.target.value)} className="w-8 h-8 p-0 border-0 cursor-pointer" title="Couleur personnalisée" />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Couleur Secondaire (Accents)</label>
                  <div className="flex flex-wrap gap-2">
                    {['#d97706', '#eab308', '#dc2626', '#0284c7', '#059669', '#ea580c', '#db2777', '#8b5cf6', '#64748b'].map(c => (
                      <button
                        key={c}
                        onClick={() => setAccentColor(c)}
                        className={`w-8 h-8 rounded shadow-sm border-2 ${accentColor === c ? 'border-gray-400 scale-110' : 'border-transparent'}`}
                        style={{ backgroundColor: c }}
                        title={c}
                      />
                    ))}
                    <input type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} className="w-8 h-8 p-0 border-0 cursor-pointer" title="Couleur personnalisée" />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="mt-4 pt-4 border-t flex flex-col space-y-2">
            <button onClick={handleDownloadPDF} className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded shadow transition duration-200">
              Télécharger PDF
            </button>
          </div>
        </div>

        {/* Right Panel: Preview A4 */}
        <div className="w-full lg:w-2/3 bg-gray-300 lg:bg-gray-200 p-2 lg:p-8 flex justify-center overflow-auto items-start">
          {/* Container with responsive scaling to fit mobile screens */}
          <div className="shadow-2xl bg-white shrink-0 origin-top scale-[0.4] sm:scale-[0.5] md:scale-[0.7] lg:scale-100 transition-transform duration-300">
            {/* The actual element captured by html2pdf - STRICT PIXEL SIZES */}
            <div id="cv-preview" className="relative overflow-hidden bg-white" style={{ width: '794px', height: '1123px', boxSizing: 'border-box', fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif" }}>

              {template === 'premium' ? (
                <>
                  {/* Force explicitly tall background block for left column for html2canvas */}
                  <div className="absolute left-0 top-0 bottom-0 w-[35%] z-0" style={{ backgroundColor: themeColor }}></div>

                  <div className="flex w-full items-stretch relative z-10 h-full">

                    {/* LEFT COLUMN */}
                    <div className="w-[35%] text-white pb-8 flex-shrink-0 relative overflow-hidden">
                      {/* Photo Header */}
                      <div className="h-44 flex justify-center items-end pb-4 relative z-10" style={{ background: `linear-gradient(to bottom, transparent 50%, rgba(255,255,255,0.05) 100%)` }}>
                        {data.photo ? (
                          <img src={data.photo} alt="Profil" className="w-32 h-32 rounded-full object-cover border-4 bg-white" style={{ borderColor: accentColor }} />
                        ) : (
                          <div className="w-32 h-32 rounded-full bg-gray-300 flex items-center justify-center border-4" style={{ borderColor: accentColor }}>
                            <User size={48} className="text-gray-500" />
                          </div>
                        )}
                      </div>

                      <div className="px-5 pb-8 relative z-10">
                        <TitleBannerLeft icon={User} title="Contactez-moi" />
                        <div className="text-[13px] space-y-3 pl-2 pr-1 mb-6 font-medium">
                          <div className="flex items-center gap-2">
                            <Phone size={14} color={accentColor} className="shrink-0" />
                            <span>{data.phone || '00 00 00 00 00'}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Mail size={14} color={accentColor} className="shrink-0" />
                            <span className="break-all">{data.email || 'email@exemple.com'}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <MapPin size={14} color={accentColor} className="shrink-0" />
                            <span>{data.address || 'Ville, Pays'}</span>
                          </div>
                        </div>

                        <TitleBannerLeft icon={Settings} title="Compétences" />
                        <div className="mb-6 pl-2 font-sans text-[13px] leading-tight flex flex-col gap-1">
                          {renderTextWithBreaks(data.skills, 'Compétence 1\nCompétence 2')}
                        </div>

                        <TitleBannerLeft icon={Briefcase} title="Méthode de travail" />
                        <div className="mb-6 pl-2 font-sans text-[13px] leading-tight flex flex-col gap-1">
                          {renderTextWithBreaks(data.methodes, 'Méthode 1\nMéthode 2')}
                        </div>

                        <TitleBannerLeft icon={CheckCircle} title="Qualités" />
                        <div className="mb-6 pl-2 font-sans text-[13px] leading-tight flex flex-col gap-1">
                          {renderTextWithBreaks(data.qualite, 'Qualité 1\nQualité 2')}
                        </div>

                        <TitleBannerLeft icon={Globe} title="Langues" />
                        <div className="mb-6 pl-2 font-sans text-[13px] leading-tight flex flex-col gap-1">
                          {renderTextWithBreaks(data.langue, 'Français\nAnglais')}
                        </div>
                      </div>
                    </div>

                    {/* RIGHT COLUMN */}
                    <div className="w-[65%] flex flex-col h-full bg-white relative">

                      {/* Header Block matching left col background optionally, but image has blue header! */}
                      <div className="pt-8 px-8 pb-4" style={{ backgroundColor: themeColor }}>
                        <h1 className="text-2xl font-black text-white tracking-widest uppercase">{data.name.toUpperCase()}</h1>
                        <h2 className="text-sm font-bold mt-1" style={{ color: accentColor }}>{data.title.toUpperCase()}</h2>
                      </div>

                      <div className="px-8 py-6 text-gray-800 text-[13px] leading-relaxed relative flex-1">

                        {/* Bio block overlapping or below */}
                        {data.bio && (
                          <div className="mb-4 text-justify">
                            {renderTextWithBreaks(data.bio)}
                          </div>
                        )}

                        <TitleBannerRight title="Expériences Professionnelles" />
                        <div className="mb-4 pl-2 font-sans flex flex-col gap-1">
                          {renderTextWithBreaks(data.experience, 'Vos expériences ici...')}
                        </div>

                        <TitleBannerRight title="Projets Réalisés" />
                        <div className="mb-4 pl-2 font-sans flex flex-col gap-1">
                          {renderTextWithBreaks(data.projet, 'Vos projets ici...')}
                        </div>

                        <TitleBannerRight title="Formations" />
                        <div className="pl-2 font-sans pb-8 flex flex-col gap-1">
                          {renderTextWithBreaks(data.education, 'Vos diplômes ici...')}
                        </div>

                      </div>

                      {/* Footer Watermark */}

                    </div>
                  </div>
                </>
              ) : (
                <div className="p-12 h-full text-gray-900 bg-white overflow-hidden" style={{ fontFamily: "'Times New Roman', Times, serif" }}>

                  {/* Header: Executive Style */}
                  <div className="text-center mb-6">
                    {data.photo && (
                      <img src={data.photo} alt="Profil" className="w-20 h-20 rounded-full object-cover mx-auto mb-3 grayscale contrast-125" />
                    )}
                    <h1 className="text-4xl font-bold uppercase tracking-widest text-gray-900">{data.name || 'Prénom Nom'}</h1>
                    <h2 className="text-xl mt-2 font-medium tracking-wide" style={{ color: themeColor }}>{data.title || 'Profil Professionnel'}</h2>

                    <div className="flex flex-wrap justify-center items-center mt-3 text-sm text-gray-700 space-x-2">
                      {data.email && <span>{data.email}</span>}
                      {data.email && data.phone && <span>•</span>}
                      {data.phone && <span>{data.phone}</span>}
                      {data.phone && data.address && <span>•</span>}
                      {data.address && <span>{data.address}</span>}
                    </div>
                  </div>

                  <div className="w-full h-0.5 mb-6" style={{ backgroundColor: themeColor }}></div>

                  {/* Profil / Bio */}
                  {data.bio && (
                    <div className="mb-6">
                      <h3 className="text-lg font-bold uppercase mb-2 tracking-widest" style={{ color: themeColor }}>Profil Professionnel</h3>
                      <div className="text-sm leading-relaxed text-justify">
                        {renderTextWithBreaks(data.bio)}
                      </div>
                    </div>
                  )}

                  {/* Expériences */}
                  {data.experience && (
                    <div className="mb-6">
                      <h3 className="text-lg font-bold uppercase mb-2 tracking-widest border-b pb-1" style={{ color: themeColor, borderColor: accentColor }}>
                        Expériences Professionnelles
                      </h3>
                      <div className="text-sm leading-relaxed pl-1 pt-2 font-sans text-gray-800">
                        {renderTextWithBreaks(data.experience)}
                      </div>
                    </div>
                  )}

                  {/* Projets */}
                  {data.projet && (
                    <div className="mb-6">
                      <h3 className="text-lg font-bold uppercase mb-2 tracking-widest border-b pb-1" style={{ color: themeColor, borderColor: accentColor }}>
                        Réalisations et Projets
                      </h3>
                      <div className="text-sm leading-relaxed pl-1 pt-2 font-sans text-gray-800">
                        {renderTextWithBreaks(data.projet)}
                      </div>
                    </div>
                  )}

                  {/* Formation */}
                  {data.education && (
                    <div className="mb-6">
                      <h3 className="text-lg font-bold uppercase mb-2 tracking-widest border-b pb-1" style={{ color: themeColor, borderColor: accentColor }}>
                        Formation
                      </h3>
                      <div className="text-sm leading-relaxed pl-1 pt-2 font-sans text-gray-800">
                        {renderTextWithBreaks(data.education)}
                      </div>
                    </div>
                  )}

                  {/* Compétences & Autres */}
                  <div className="grid grid-cols-2 gap-8 mt-8">
                    <div>
                      <h3 className="text-lg font-bold uppercase mb-2 tracking-widest border-b pb-1" style={{ color: themeColor, borderColor: accentColor }}>
                        Compétences Techniques
                      </h3>
                      <div className="text-sm leading-relaxed pl-1 pt-2 font-sans text-gray-800">
                        {renderTextWithBreaks(data.skills)}
                      </div>
                    </div>
                    <div>
                      <h3 className="text-lg font-bold uppercase mb-2 tracking-widest border-b pb-1" style={{ color: themeColor, borderColor: accentColor }}>
                        Langues & Atouts
                      </h3>
                      <div className="space-y-4 font-sans mt-2 text-sm leading-relaxed pl-1 text-gray-800">
                        {data.langue && (
                          <div>
                            <strong className="text-sm font-bold text-gray-800 block mb-1">Langues :</strong>
                            {renderTextWithBreaks(data.langue)}
                          </div>
                        )}
                        {data.qualite && (
                          <div>
                            <strong className="text-sm font-bold text-gray-800 block mb-1">Qualités :</strong>
                            {renderTextWithBreaks(data.qualite)}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>
      </div>
      {/* PAYWALL MODAL */}
      {showPaywall && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in duration-300">
            <div className="bg-gradient-to-r from-yellow-400 to-amber-500 p-6 text-center relative">
              <button 
                onClick={() => setShowPaywall(false)}
                className="absolute top-4 right-4 text-amber-900 hover:scale-110 transition-transform font-bold text-xl"
              >
                ✕
              </button>
              <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-4 backdrop-blur-md">
                <Sparkles className="text-white" size={40} />
              </div>
              <h3 className="text-white font-black text-2xl uppercase tracking-tight">Version Premium</h3>
              <p className="text-amber-50 text-sm font-medium mt-1">Débloquez le téléchargement et l'IA</p>
            </div>

            <div className="p-8">
              <div className="space-y-4 mb-8">
                <div className="flex items-start gap-3">
                  <div className="mt-1 bg-green-100 text-green-600 rounded-full p-1"><CheckCircle size={14}/></div>
                  <p className="text-sm text-gray-700 font-medium">Téléchargements PDF illimités (pendant 5 crédits)</p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-1 bg-green-100 text-green-600 rounded-full p-1"><CheckCircle size={14}/></div>
                  <p className="text-sm text-gray-700 font-medium">Intelligence Artificielle pour adapter votre CV</p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-1 bg-green-100 text-green-600 rounded-full p-1"><CheckCircle size={14}/></div>
                  <p className="text-sm text-gray-700 font-medium">Modèles de CV Premium inclus</p>
                </div>
              </div>

              <div className="bg-gray-50 border border-gray-100 p-4 rounded-xl mb-6">
                <h4 className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-3">Paiement Mobile Money (Cameroun)</h4>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                  <input 
                    type="tel" 
                    placeholder="Numéro MTN (Ex: 677...)"
                    value={mtnNumber}
                    onChange={(e) => setMtnNumber(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 rounded-lg border-2 border-gray-200 outline-none focus:border-yellow-500 transition-all font-bold text-gray-800"
                  />
                </div>
              </div>

              <button 
                onClick={handleMtnPayment}
                disabled={isPaying || !mtnNumber}
                className="w-full bg-yellow-400 hover:bg-yellow-500 text-yellow-900 font-black py-4 px-6 rounded-xl shadow-lg shadow-yellow-200 active:scale-[0.98] transition-all flex items-center justify-center gap-3 disabled:opacity-50"
              >
                {isPaying ? <Loader2 className="animate-spin" /> : <CreditCard size={20} />}
                {isPaying ? 'Vérification du paiement...' : 'ACTIVER POUR 650 FCFA'}
              </button>

              <p className="text-[10px] text-gray-400 mt-6 text-center leading-relaxed">
                Une demande de confirmation apparaîtra sur votre téléphone.<br/>Validez avec votre code PIN pour débloquer vos options.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
