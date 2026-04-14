import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', msg: 'Simple Express Vercel success' });
});

app.post('/api/pay/initiate', (req, res) => {
  res.json({ transactionId: 'TEST-123', checkoutUrl: 'https://example.com' });
});

export default app;
