/**
 * CricLive Backend Server
 * Caching proxy for CricketData.org API
 */

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const routes  = require('./routes');
const poller  = require('./poller');

const app  = express();
const PORT = parseInt(process.env.PORT || '3001');

// ── CORS ────────────────────────────────────────────────────────────────────
// Allow your Netlify frontend + localhost for dev
const allowedOrigins = (process.env.CORS_ORIGIN || '*').split(',').map(o => o.trim());
app.use(cors({
  origin: (origin, cb) => {
    if (allowedOrigins.includes('*') || !origin || allowedOrigins.includes(origin)) {
      cb(null, true);
    } else {
      cb(new Error(`CORS: origin ${origin} not allowed`));
    }
  },
  methods: ['GET'],
}));

app.use(express.json());

// ── REQUEST LOGGING ─────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms  = Date.now() - start;
    const hit = res.getHeader('X-Cache-Hit') === 'true' ? '(cache)' : '(fresh)';
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${ms}ms ${hit}`);
  });
  next();
});

// ── ROUTES ───────────────────────────────────────────────────────────────────
app.use('/api', routes);

// Root — useful sanity check
app.get('/', (req, res) => {
  res.json({ name: 'CricLive API', version: '1.0.0', docs: '/api/health' });
});

// 404
app.use((req, res) => {
  res.status(404).json({ status: 'error', message: `Route ${req.path} not found` });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[server] Unhandled error:', err.message);
  res.status(500).json({ status: 'error', message: err.message });
});

// ── START ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🏏 CricLive backend running on http://localhost:${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/api/health\n`);
  poller.start();
});
