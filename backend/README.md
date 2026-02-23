# CricLive Backend

Caching proxy server for CricketData.org API. Polls the API on a schedule and serves all users from cache — so 1000 users refreshing = still only 1 API call every 30 seconds.

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env and add your CRICKET_API_KEY

# 3. Run in development (auto-restarts on changes)
npm run dev

# 4. Run in production
npm start
```

## API Endpoints

| Endpoint | Description | Cache TTL |
|---|---|---|
| `GET /api/matches` | All matches (live + upcoming + results) | 30s |
| `GET /api/matches/live` | Live matches only | 30s |
| `GET /api/match/:id/scorecard` | Full scorecard for a match | 30s |
| `GET /api/match/:id/info` | Match info (venue, toss, umpires) | 1hr |
| `GET /api/health` | Server health + cache stats | — |

## How caching works

```
User A refreshes ──┐
User B refreshes ──┤──► Backend cache ──► CricketData.org (once per 30s)
User C refreshes ──┘         ▲
                              └── 2,880 API calls/day max
                                  regardless of users
```

## Deploying to Render (free tier)

1. Push this folder to a GitHub repo
2. Go to render.com → New Web Service
3. Connect your repo
4. Set environment variables in Render dashboard:
   - `CRICKET_API_KEY` = your key
   - `CORS_ORIGIN` = your Netlify URL e.g. `https://criclive.netlify.app`
5. Deploy — Render gives you a free URL like `https://criclive-api.onrender.com`
6. Update the frontend API_BASE to point to your Render URL

## Environment Variables

See `.env.example` for all options.
