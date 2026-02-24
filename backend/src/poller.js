/**
 * Background poller — fetches live match data on a schedule
 * so API calls happen once regardless of how many users are connected
 */

const cron      = require('node-cron');
const cache     = require('./cache');
const cricketApi = require('./cricbuzzScraper');
require('dotenv').config();

const LIVE_TTL     = parseInt(process.env.CACHE_CURRENT_TTL  || '30');
const UPCOMING_TTL = parseInt(process.env.CACHE_UPCOMING_TTL || '300');
const POLL_SECS    = parseInt(process.env.LIVE_POLL_INTERVAL  || '30');

let pollCount   = 0;
let lastSuccess = null;
let lastError   = null;

async function pollCurrentMatches() {
  try {
    console.log(`[poller] Fetching currentMatches... (poll #${++pollCount})`);
    const data = await cricketApi.getCurrentMatches();
    cache.set('currentMatches', data, LIVE_TTL);
    lastSuccess = new Date();
    console.log(`[poller] ✅ currentMatches cached — ${data.data?.length || 0} matches`);
  } catch (err) {
    lastError = err.message;
    console.error('[poller] ❌ currentMatches error:', err.message);
  }
}

async function pollUpcomingMatches() {
  try {
    console.log('[poller] Fetching upcoming matches...');
    const data = await cricketApi.getMatches();
    cache.set('upcomingMatches', data, UPCOMING_TTL);
    console.log(`[poller] ✅ upcomingMatches cached — ${data.data?.length || 0} matches`);
  } catch (err) {
    console.error('[poller] ❌ upcomingMatches error:', err.message);
  }
}

function start() {
  // Run immediately on startup
  pollCurrentMatches();
  pollUpcomingMatches();

  // Poll live matches every N seconds using cron
  // POLL_SECS=30 → every 30 seconds = 2880 calls/day (well within paid plan)
  const cronExpr = `*/${Math.max(POLL_SECS, 10)} * * * * *`;
  cron.schedule(cronExpr, pollCurrentMatches);

  // Poll upcoming matches every 5 minutes (slow-changing data)
  cron.schedule('*/5 * * * *', pollUpcomingMatches);

  console.log(`[poller] Started — live poll every ${POLL_SECS}s, upcoming every 5min`);
}

function status() {
  return { pollCount, lastSuccess, lastError };
}

module.exports = { start, status };
