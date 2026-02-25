/**
 * On-demand data fetcher — populates the cache when requested.
 * No background polling; data is fetched when the client triggers a refresh.
 */

const cache      = require('./cache');
const cricketApi = require('./cricbuzzScraper');
require('dotenv').config();

const LIVE_TTL     = parseInt(process.env.CACHE_CURRENT_TTL  || '30');
const UPCOMING_TTL = parseInt(process.env.CACHE_UPCOMING_TTL || '300');

let fetchCount  = 0;
let lastSuccess = null;
let lastError   = null;

async function fetchCurrentMatches() {
  console.log(`[poller] Fetching currentMatches... (#${++fetchCount})`);
  try {
    const data = await cricketApi.getCurrentMatches();
    cache.set('currentMatches', data, LIVE_TTL);
    lastSuccess = new Date();
    console.log(`[poller] ✅ currentMatches cached — ${data.data?.length || 0} matches`);
  } catch (err) {
    lastError = err.message;
    console.error('[poller] ❌ currentMatches error:', err.message);
    throw err;
  }
}

async function fetchUpcomingMatches() {
  console.log('[poller] Fetching upcomingMatches...');
  try {
    const data = await cricketApi.getMatches();
    cache.set('upcomingMatches', data, UPCOMING_TTL);
    console.log(`[poller] ✅ upcomingMatches cached — ${data.data?.length || 0} matches`);
  } catch (err) {
    console.error('[poller] ❌ upcomingMatches error:', err.message);
    throw err;
  }
}

function start() {
  // Warm up cache once on startup — no ongoing cron polling
  fetchCurrentMatches().catch(() => {});
  fetchUpcomingMatches().catch(() => {});
  console.log('[poller] Cache warmed on startup — on-demand mode (no background polling)');
}

function status() {
  return { fetchCount, lastSuccess, lastError, mode: 'on-demand' };
}

module.exports = { start, status, fetchCurrentMatches, fetchUpcomingMatches };
