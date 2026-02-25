/**
 * API routes — all endpoints the frontend calls
 */

const express    = require('express');
const router     = express.Router();
const cache      = require('./cache');
const cricketApi = require('./cricbuzzScraper');
const poller     = require('./poller');
require('dotenv').config();

const SCORECARD_TTL  = parseInt(process.env.CACHE_SCORECARD_TTL  || '30');
const MATCH_INFO_TTL = parseInt(process.env.CACHE_MATCH_INFO_TTL || '60');

// Helper to send cached or fresh data
function sendCached(res, key, data, age) {
  res.setHeader('X-Cache-Age', age ?? 0);
  res.setHeader('X-Cache-Hit', age !== null ? 'true' : 'false');
  res.json({ status: 'success', data, cachedAt: new Date() });
}

// ── GET /api/matches ───────────────────────────────────────────────────────
// Returns merged current + upcoming matches — fetches on-demand if cache is stale
router.get('/matches', async (req, res) => {
  let current  = cache.get('currentMatches');
  let upcoming = cache.get('upcomingMatches');

  // Fetch on-demand if cache has expired
  const fetches = [];
  if (!current)  fetches.push(poller.fetchCurrentMatches().catch(() => {}));
  if (!upcoming) fetches.push(poller.fetchUpcomingMatches().catch(() => {}));
  if (fetches.length) {
    await Promise.all(fetches);
    current  = cache.get('currentMatches');
    upcoming = cache.get('upcomingMatches');
  }

  if (!current && !upcoming) {
    return res.status(503).json({
      status: 'error',
      message: 'Match data unavailable — the data source may be temporarily down.',
    });
  }

  const currentData  = current?.value?.data  || [];
  const upcomingData = upcoming?.value?.data || [];

  // Merge & deduplicate by id
  const seen   = new Set();
  const merged = [];
  for (const m of [...currentData, ...upcomingData]) {
    if (!seen.has(m.id)) { seen.add(m.id); merged.push(m); }
  }

  const age = current ? cache.age('currentMatches') : null;
  sendCached(res, 'matches', merged, age);
});

// ── GET /api/matches/live ─────────────────────────────────────────────────
// Returns only live matches — fetches on-demand if cache is stale
router.get('/matches/live', async (req, res) => {
  let current = cache.get('currentMatches');
  if (!current) {
    try { await poller.fetchCurrentMatches(); current = cache.get('currentMatches'); } catch(e) {}
  }
  if (!current) return res.status(503).json({ status: 'error', message: 'Not ready yet' });

  const live = (current.value?.data || []).filter(
    m => m.matchStarted === true && m.matchEnded === false
  );
  sendCached(res, 'live', live, cache.age('currentMatches'));
});

// ── GET /api/match/:id/score ──────────────────────────────────────────────
// Returns the live score — fetches on-demand if cache is stale.
// Used by the match detail page hero so it stays in sync with the home page.
router.get('/match/:id/score', async (req, res) => {
  const { id } = req.params;
  let current  = cache.get('currentMatches');
  let upcoming = cache.get('upcomingMatches');

  // Fetch on-demand if both caches are stale
  if (!current) {
    try { await poller.fetchCurrentMatches(); current = cache.get('currentMatches'); } catch(e) {}
  }

  const all = [
    ...(current?.value?.data  || []),
    ...(upcoming?.value?.data || []),
  ];
  const match = all.find(m => m.id === id);
  if (!match) {
    return res.status(404).json({ status: 'error', message: 'Match not found in cache' });
  }
  sendCached(res, `score:${id}`, {
    score:        match.score,
    status:       match.status,
    matchStarted: match.matchStarted,
    matchEnded:   match.matchEnded,
  }, cache.age('currentMatches'));
});

// ── GET /api/match/:id/scorecard ──────────────────────────────────────────
router.get('/match/:id/scorecard', async (req, res) => {
  const { id } = req.params;
  const cacheKey = `scorecard:${id}`;

  const cached = cache.get(cacheKey);
  if (cached) {
    return sendCached(res, cacheKey, cached.value, cache.age(cacheKey));
  }

  try {
    const data = await cricketApi.getScorecard(id);
    cache.set(cacheKey, data.data, SCORECARD_TTL);
    sendCached(res, cacheKey, data.data, 0);
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ── GET /api/match/:id/info ───────────────────────────────────────────────
router.get('/match/:id/info', async (req, res) => {
  const { id } = req.params;
  const cacheKey = `matchinfo:${id}`;

  const cached = cache.get(cacheKey);
  if (cached) {
    return sendCached(res, cacheKey, cached.value, cache.age(cacheKey));
  }

  try {
    const data = await cricketApi.getMatchInfo(id);
    cache.set(cacheKey, data.data, MATCH_INFO_TTL);
    sendCached(res, cacheKey, data.data, 0);
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ── GET /api/health ───────────────────────────────────────────────────────
router.get('/health', (req, res) => {
  const pollerStatus = poller.status();
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    cache: cache.stats(),
    poller: pollerStatus,
    env: {
      port: process.env.PORT || 3001,
      pollInterval: process.env.LIVE_POLL_INTERVAL || 30,
    },
  });
});

module.exports = router;
