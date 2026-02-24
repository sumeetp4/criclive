/**
 * Cricbuzz scraper — extracts match data from Cricbuzz's publicly rendered pages
 *
 * No API key required. Data comes from:
 *  - Match list:  RSC stream in https://www.cricbuzz.com/cricket-match/live-scores
 *  - Scorecard:   HTML page  https://www.cricbuzz.com/live-cricket-scorecard/{id}/{slug}
 *  - Match info:  HTML page  https://www.cricbuzz.com/live-cricket-scores/{id}/{slug}
 *
 * Match IDs are encoded as "{cricbuzzMatchId}~{urlSlug}" so the backend can
 * reconstruct the full URL without a separate lookup.
 */

const fetch   = require('node-fetch');
const cheerio = require('cheerio');

const CB_BASE = 'https://www.cricbuzz.com';

const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer':         'https://www.cricbuzz.com/',
};

async function fetchPage(path) {
  const res = await fetch(`${CB_BASE}${path}`, { headers: HEADERS, timeout: 15000 });
  if (!res.ok) throw new Error(`Cricbuzz HTTP ${res.status} for ${path}`);
  return res.text();
}

// ── JSON extraction from RSC stream ────────────────────────────────────────
// Cricbuzz uses Next.js RSC streaming; match data is embedded in the HTML
// as a JSON-ish string inside self.__next_f.push([1,"..."]) calls.
// Braces are literal, but " chars are escaped as \".

function extractJsonAt(html, startIdx) {
  let depth = 0, start = -1;
  for (let i = startIdx; i < html.length; i++) {
    const c = html[i];
    if (c === '{') { if (!depth) start = i; depth++; }
    else if (c === '}') { if (!--depth && start !== -1) return html.slice(start, i + 1); }
  }
  return null;
}

function parseRscJson(raw) {
  // Replace \" → " and \' → ' so we can JSON.parse the embedded objects
  return JSON.parse(raw.replace(/\\"/g, '"').replace(/\\'/g, "'"));
}

// ── Match state helpers ─────────────────────────────────────────────────────
const LIVE_STATES  = new Set(['in progress', 'innings break', 'strategic timeout',
                               'rain', 'bad light', 'stumps', 'drinks', 'tea', 'lunch', 'in break']);
const ENDED_STATES = new Set(['complete', 'result', 'abandoned', 'no result', 'cancelled']);

function parseState(state = '') {
  const s = state.toLowerCase();
  const matchEnded   = ENDED_STATES.has(s);
  const matchStarted = matchEnded || LIVE_STATES.has(s);
  return { matchStarted, matchEnded };
}

// ── Team image URL (Cricbuzz CDN) ───────────────────────────────────────────
function teamImg(imageId) {
  if (!imageId) return null;
  return `https://static.cricbuzz.com/a/img/v1/75x75/i1/c${imageId}/team.jpg`;
}

// ── Build score array from matchScore object ────────────────────────────────
function buildScores(matchInfo, matchScore) {
  const scores = [];
  const t1Name = matchInfo.team1?.teamName || '';
  const t2Name = matchInfo.team2?.teamName || '';

  // Cricbuzz may put scores in matchScore OR inline in matchInfo — try both
  const t1Score = matchScore?.team1Score || matchInfo?.team1Score;
  const t2Score = matchScore?.team2Score || matchInfo?.team2Score;

  for (const [key, innObj] of Object.entries(t1Score || {})) {
    if (!innObj) continue;
    scores.push({
      inning: `${t1Name} Inning ${innObj.inningsId || 1}`,
      r: innObj.runs  ?? innObj.r,
      w: innObj.wickets ?? innObj.w,
      o: innObj.overs ?? innObj.o,
    });
  }
  for (const [key, innObj] of Object.entries(t2Score || {})) {
    if (!innObj) continue;
    scores.push({
      inning: `${t2Name} Inning ${innObj.inningsId || 1}`,
      r: innObj.runs  ?? innObj.r,
      w: innObj.wickets ?? innObj.w,
      o: innObj.overs ?? innObj.o,
    });
  }
  return scores;
}

// ── Normalize a single matchInfo + matchScore into our format ───────────────
function normalizeMatch(matchInfo, matchScore, slug) {
  const { matchStarted, matchEnded } = parseState(matchInfo.state);
  const t1 = matchInfo.team1;
  const t2 = matchInfo.team2;

  const id = slug
    ? `${matchInfo.matchId}~${slug}`
    : String(matchInfo.matchId);

  return {
    id,
    name:        [matchInfo.seriesName, matchInfo.matchDesc].filter(Boolean).join(' – '),
    matchType:   (matchInfo.matchFormat || '').toLowerCase(),
    status:      matchInfo.status || '',
    dateTimeGMT: matchInfo.startDate
      ? new Date(Number(matchInfo.startDate)).toISOString()
      : '',
    matchStarted,
    matchEnded,
    teams:    [t1?.teamName, t2?.teamName].filter(Boolean),
    teamInfo: [
      t1 && { name: t1.teamName, shortname: t1.teamSName, img: teamImg(t1.imageId) },
      t2 && { name: t2.teamName, shortname: t2.teamSName, img: teamImg(t2.imageId) },
    ].filter(Boolean),
    score: buildScores(matchInfo, matchScore),
  };
}

// ── Fetch + parse the live-scores match list ────────────────────────────────
async function fetchMatchList() {
  const html = await fetchPage('/cricket-match/live-scores');

  // 1. Extract slug map from navigation links
  const slugMap = {};
  const linkRe = /href="\/live-cricket-scores\/(\d+)\/([^"]+)"/g;
  let lm;
  while ((lm = linkRe.exec(html)) !== null) {
    slugMap[lm[1]] = lm[2];
  }

  // 2. Extract currentMatchesList JSON from RSC stream
  const key = 'currentMatchesList';
  const keyIdx = html.indexOf(key);
  if (keyIdx < 0) throw new Error('Could not find currentMatchesList in Cricbuzz page');

  const braceIdx = html.indexOf('{', keyIdx + key.length);
  const raw = extractJsonAt(html, braceIdx);
  if (!raw) throw new Error('Could not extract match list JSON');

  const data = parseRscJson(raw);

  // 3. Flatten matches from typeMatches → seriesMatches → matches
  const matches = [];
  for (const typeBlock of (data.typeMatches || [])) {
    for (const seriesBlock of (typeBlock.seriesMatches || [])) {
      const wrapper = seriesBlock.seriesAdWrapper;
      if (!wrapper?.matches) continue;
      for (const m of wrapper.matches) {
        if (!m.matchInfo) continue;
        const slug = slugMap[m.matchInfo.matchId] || '';
        matches.push(normalizeMatch(m.matchInfo, m.matchScore, slug));
      }
    }
  }

  return matches;
}

// ── Parse scorecard HTML with cheerio ──────────────────────────────────────
function parseScorecardHtml(html) {
  const $ = cheerio.load(html);
  const innings = [];

  // Each innings block has an id like "scard-team-{teamId}-innings-{innNum}"
  // Track seen ids to avoid processing the duplicate mobile/desktop elements
  const seen = new Set();
  $('[id^="scard-team-"]').each((_, innBlock) => {
    const scardId = $(innBlock).attr('id');
    if (seen.has(scardId)) return;
    seen.add(scardId);

    // Derive inning name from the header sibling
    // scard-team-97-innings-1 → header id is team-97-innings-1
    const headerId = scardId.replace('scard-', '');
    const innNumMatch = headerId.match(/innings-(\d+)$/);
    const innNum = innNumMatch ? innNumMatch[1] : '1';

    const header = $(`#${headerId}`);
    // Use the longer team name if available (hidden on mobile, shown on desktop)
    const longNameEl = header.find('[class*="hidden"][class*="font-bold"]').first();
    const shortNameEl = header.find('[class*="font-bold"]').first();
    const teamName = (longNameEl.text().trim() || shortNameEl.text().trim() || 'Team');

    // Batting rows — class contains scorecard-bat-grid but skip the header row
    const batRows = $(innBlock).find('[class*="scorecard-bat-grid"]').not('[class*="bg-cbBorderGrey"]');
    const batting = [];
    batRows.each((_, row) => {
      const cells = $(row).children();
      if (cells.length < 6) return;

      const batter     = $(cells[0]).find('a').first().text().trim();
      const dismissal  = $(cells[0]).find('[class*="cbTxtSec"]').text().trim() || 'not out';
      if (!batter) return; // skip empty rows

      batting.push({
        batsman:          { name: batter },
        'dismissal-text': dismissal,
        r:  toNum($(cells[1]).text()),
        b:  toNum($(cells[2]).text()),
        '4s': toNum($(cells[3]).text()),
        '6s': toNum($(cells[4]).text()),
        sr: toNum($(cells[5]).text()),
      });
    });

    // Extras row
    const extrasText = $(innBlock).find('.font-bold:contains("Extras")').closest('[class*="flex"]').text();
    const extras = parseExtras(extrasText);

    // Total row
    const totalText = $(innBlock).find('.font-bold:contains("Total")').closest('[class*="flex"]').text();
    const total = parseTotal(totalText);

    // Bowling rows — cells[0] is a direct <a> for the bowler (no wrapping div)
    const bowlRows = $(innBlock).find('[class*="scorecard-bowl-grid"]').not('[class*="bg-cbBorderGrey"]');
    const bowling = [];
    bowlRows.each((_, row) => {
      const cells = $(row).children();
      if (cells.length < 5) return;

      // cells[0] might be a bare <a> or a div containing <a>
      const c0 = cells[0];
      const bowler = c0.tagName === 'a'
        ? $(c0).text().trim()
        : $(c0).find('a').first().text().trim();
      if (!bowler) return;

      bowling.push({
        bowler: { name: bowler },
        o:  toNum($(cells[1]).text()),
        m:  toNum($(cells[2]).text()),
        r:  toNum($(cells[3]).text()),
        w:  toNum($(cells[4]).text()),
        nb: toNum($(cells[5]).text()),
        wd: toNum($(cells[6]).text()),
      });
    });

    innings.push({ inning: `${teamName} Inning ${innNum}`, batting, bowling, extras, total });
  });

  return innings;
}

function toNum(s) {
  const n = parseFloat(String(s || '').trim());
  return isNaN(n) ? null : n;
}

function parseExtras(text) {
  // e.g. "Extras 9 (b 0, lb 1, w 8, nb 0, p 0)"
  const b  = (text.match(/b (\d+)/)  || [])[1];
  const lb = (text.match(/lb (\d+)/) || [])[1];
  const w  = (text.match(/w (\d+)/)  || [])[1];
  const nb = (text.match(/nb (\d+)/) || [])[1];
  const p  = (text.match(/p (\d+)/)  || [])[1];
  return { b: +b||0, lb: +lb||0, w: +w||0, nb: +nb||0, p: +p||0 };
}

function parseTotal(text) {
  // e.g. "Total 79-3 (18 Overs, RR: 4.39)"
  const scoreM = text.match(/(\d+)[-/](\d+)/);
  const oversM = text.match(/\(([0-9.]+)\s+Ov/i);
  if (!scoreM) return null;
  return { r: +scoreM[1], w: +scoreM[2], o: oversM ? oversM[1] : null };
}

// ── Parse match info from scorecard page ────────────────────────────────────
// The scorecard page has team names, scores, toss, venue, umpires, referee.
function parseMatchInfoHtml(html) {
  const $ = cheerio.load(html);

  // ── Key-value facts (Toss, Venue, Umpires, Referee) ──────────────────────
  const facts = {};
  $('[class*="facts-row-grid"]').each((_, row) => {
    const label = $(row).find('.font-bold').first().text().trim();
    const value = $(row).children().last().text().trim();
    if (label && value && label !== value) facts[label] = value;
  });

  // ── SportsEvent schema → start date, team names, match type, series ────────
  let startDate = '', sportsEventName = '';
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const d = JSON.parse($(el).html());
      if (d['@type'] === 'SportsEvent') {
        startDate = d.startDate || '';
        sportsEventName = d.name || '';
      }
    } catch {}
  });

  // "Australia Women vs India Women, 1st ODI, India Women tour of Australia, 2026 - ..."
  // schemaTeam1, schemaTeam2 from "T1 vs T2"
  const vsMatch = sportsEventName.match(/^(.+?)\s+vs\s+(.+?),/i);
  const schemaTeam1 = vsMatch ? vsMatch[1].trim() : '';
  const schemaTeam2 = vsMatch ? vsMatch[2].trim() : '';

  // matchDesc = "1st ODI", "Final", "44th Match", etc. → extract format
  const descM = sportsEventName.match(/vs .+?,\s*(.+?),/i);
  const matchDesc = descM ? descM[1].trim() : '';
  const fmtM = matchDesc.match(/\b(test|odi|t20i?|t10|hundred|fc|list\s*a)\b/i);
  const matchType = fmtM ? fmtM[1].toLowerCase().replace(/\s+/g, '') : '';

  // seriesName = 3rd comma-separated segment, stripped of trailing " - Live..."
  const seriesM = sportsEventName.match(/vs .+?, .+?,\s*(.+?)(?:\s+-\s+|$)/i);
  const seriesName = seriesM ? seriesM[1].trim() : '';

  // Human-readable date from startDate ISO string
  let date = '';
  if (startDate) {
    try {
      date = new Date(startDate).toLocaleDateString('en-IN', {
        weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
      }) + ' IST';
    } catch {}
  }

  // ── Team names and current scores from innings headers ────────────────────
  // Each header has id "team-{teamId}-innings-{n}", short name and long name
  const teams = [], teamInfo = [], score = [];
  const seenTeams = new Set(), seenHeaders = new Set();

  $('[id^="team-"][id*="-innings-"]').each((_, el) => {
    const headerId = $(el).attr('id');
    if (!headerId || seenHeaders.has(headerId)) return;
    seenHeaders.add(headerId);

    const innNumM = headerId.match(/innings-(\d+)$/);
    const innNum = innNumM ? innNumM[1] : '1';

    // Short name: first child with "font-bold" (visible on mobile: "tb:hidden font-bold")
    // Long name: child with "tb:block" in class (shown on tablet/web: "hidden tb:block font-bold")
    const shortName = $(el).children('[class*="font-bold"]').first().text().trim();
    const longName  = $(el).children('[class*="tb:block"]').first().text().trim() || shortName;

    if (longName && !seenTeams.has(longName)) {
      seenTeams.add(longName);
      teams.push(longName);
      teamInfo.push({ name: longName, shortname: shortName, img: null });
    }

    // Score: e.g. "83-3" and " (19 Ov)"
    const scoreSpan = $(el).find('span').filter('[class*="font-bold"]').first().text().trim();
    const oversSpan = $(el).find('span').not('[class*="font-bold"]').first().text().replace(/[()]/g, '').trim();
    const sm = scoreSpan.match(/^(\d+)[-\/](\d+)$/);
    if (sm) {
      score.push({
        inning: `${longName} Inning ${innNum}`,
        r: +sm[1], w: +sm[2],
        o: oversSpan.replace(/\s*Ov$/i, '').trim() || null,
      });
    }
  });

  // ── Fill in missing teams from SportsEvent schema ─────────────────────────
  // Cricbuzz scorecard only shows headers for teams that have batted.
  // If only one (or zero) teams extracted, use the schema names as fallback.
  if (schemaTeam1 && schemaTeam2) {
    if (!teams.includes(schemaTeam1)) {
      teams.push(schemaTeam1);
      teamInfo.push({ name: schemaTeam1, shortname: '', img: null });
    }
    if (!teams.includes(schemaTeam2)) {
      teams.push(schemaTeam2);
      teamInfo.push({ name: schemaTeam2, shortname: '', img: null });
    }
  }

  // ── Toss ──────────────────────────────────────────────────────────────────
  const tossText = facts['Toss'] || '';
  const tossWinnerM = tossText.match(/^(.+?)\s+won the toss/i);
  const tossChoiceM = tossText.match(/opt to (\w+)/i);

  return {
    teams,
    teamInfo,
    score,
    matchType,
    seriesName,
    date,
    venue:        facts['Venue'] || '',
    dateTimeGMT:  startDate,
    status:       tossText,
    tossWinner:   tossWinnerM ? tossWinnerM[1] : '',
    tossChoice:   tossChoiceM ? tossChoiceM[1].toLowerCase() : '',
    umpires:      [facts['Umpires'], facts['3rd Umpire']].filter(Boolean).join(', '),
    matchReferee: facts['Referee'] || '',
  };
}

// ── Public API ──────────────────────────────────────────────────────────────
module.exports = {

  async getCurrentMatches() {
    const matches = await fetchMatchList();
    // Current = live + recently ended (Complete) + Preview (about to start)
    const current = matches.filter(m =>
      m.matchStarted || (m.status || '').toLowerCase().includes('preview') ||
      (m.status || '').toLowerCase().includes('starts')
    );
    return { data: current.length ? current : matches };
  },

  async getMatches() {
    const matches = await fetchMatchList();
    // Return everything (live + upcoming) – frontend deduplicates
    return { data: matches };
  },

  // id = "{cricbuzzMatchId}~{urlSlug}"
  async getScorecard(id) {
    const [matchId, slug] = id.split('~');
    if (!matchId) throw new Error(`Invalid match id: ${id}`);
    const path = slug
      ? `/live-cricket-scorecard/${matchId}/${slug}`
      : `/live-cricket-scorecard/${matchId}`;
    const html = await fetchPage(path);
    const scorecard = parseScorecardHtml(html);
    return { data: { scorecard } };
  },

  // id = "{cricbuzzMatchId}~{urlSlug}"
  async getMatchInfo(id) {
    const [matchId, slug] = id.split('~');
    if (!matchId) throw new Error(`Invalid match id: ${id}`);

    // Scorecard page has all info: toss, umpires, referee, venue
    const path = slug
      ? `/live-cricket-scorecard/${matchId}/${slug}`
      : `/live-cricket-scorecard/${matchId}`;
    const html = await fetchPage(path);
    const info = parseMatchInfoHtml(html);

    return { data: { id, ...info } };
  },
};
