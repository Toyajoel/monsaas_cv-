const pdfParse = require('pdf-parse');

module.exports = async function extractTextFromPDF(buffer) {
  try {
    const data = await pdfParse(buffer);
    return data.text;
  } catch (error) {
    throw new Error("Erreur interne pdf-parse : " + error.message);
  }
};
