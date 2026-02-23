/**
 * Cricket API client — wraps CricketData.org calls
 * All calls go through here so we can swap providers easily later
 */

const fetch = require('node-fetch');
require('dotenv').config();

const API_KEY = process.env.CRICKET_API_KEY;
const BASE    = 'https://api.cricapi.com/v1';

async function apiGet(endpoint, params = {}) {
  const url = new URL(`${BASE}/${endpoint}`);
  url.searchParams.set('apikey', API_KEY);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), { timeout: 10000 });
  if (!res.ok) throw new Error(`Cricket API HTTP ${res.status} for ${endpoint}`);

  const json = await res.json();
  if (json.status !== 'success') {
    throw new Error(json.message || `Cricket API error for ${endpoint}`);
  }
  return json;
}

module.exports = {
  // Returns current + recently ended matches
  getCurrentMatches: (offset = 0) =>
    apiGet('currentMatches', { offset }),

  // Returns upcoming + scheduled matches
  getMatches: (offset = 0) =>
    apiGet('matches', { offset }),

  // Returns full scorecard for a match
  getScorecard: (matchId) =>
    apiGet('match_scorecard', { id: matchId }),

  // Returns match info (venue, toss, umpires etc)
  getMatchInfo: (matchId) =>
    apiGet('match_info', { id: matchId }),
};
