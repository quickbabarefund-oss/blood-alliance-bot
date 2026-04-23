
## CoC Alliance Donation Tracker

A donation tracking system for a multi-clan alliance, powered by a CoC proxy API and managed primarily through a Discord bot, with a public read-only web leaderboard.

### Public Web Dashboard (read-only)
- **Global Leaderboard** — all tracked clans combined, ranked by donations this month, with received column, ratio, clan tag/badge.
- **Per-Clan Leaderboard** — pick a clan, see top→lowest donator list with player tag, name, donations, received, ratio, role, last seen.
- **Blacklist & Whitelist pages** — public lists of flagged player tags with reason and date added.
- **Player history page** — search by tag, see last 60 days of daily donation snapshots (so leavers/rejoiners keep history).
- **Clan registry page** — all registered clans with badges and member counts.
- Clean dark theme, mobile responsive, search + sort on every table.

### Discord Bot (primary management surface)
**Auto-updated leaderboard messages** (edited every 5 minutes):
- One global alliance leaderboard message.
- One leaderboard message per registered clan.
- Channel for each is configured via slash command.

**Slash commands:**
- `/clan add <tag> <channel>` — register clan and bind its leaderboard channel
- `/clan remove <tag>`, `/clan list`
- `/global setchannel <channel>` — bind global leaderboard channel
- `/top [clan] [count]` — on-demand top donators
- `/lowest [clan] [count]` — bottom donators (for kick decisions)
- `/player <tag>` — full history + donation totals
- `/blacklist add|remove|list <tag> [reason]`
- `/whitelist add|remove|list <tag> [reason]`
- `/refresh [clan]` — force immediate refresh
- Permission-gated: only Discord roles you mark as "manager" can run mutating commands.

### Data Engine
- **Source**: ClashKing / proxy CoC API (you provide proxy token as a secret).
- **Polling**: every 5 minutes per registered clan via a scheduled job.
- **Storage**: snapshot each player's `donations` and `donationsReceived` on every poll; compute deltas to handle the in-game weekly reset and player leave/rejoin.
- **Retention**: raw snapshots kept 60 days (older auto-pruned); monthly aggregates kept indefinitely.
- **Monthly reset**: leaderboard counters reset at **00:00 IST (GMT+5:30)** on the 1st of each month; previous month archived and viewable in a "Past months" selector.
- **Leaver tracking**: player records persist by tag, not membership — if they leave and rejoin any tracked clan, history continues seamlessly.

### Setup Flow (after approval)
1. Enable Lovable Cloud (database + scheduled functions + secrets).
2. You'll be asked for: **CoC proxy API token**, **Discord bot token**, **Discord application/client ID**, **guild ID**.
3. I provide the bot invite link with the right scopes; you invite it to your server.
4. Use `/clan add` to register each clan and bind channels — the bot starts editing leaderboard messages automatically.

### Out of scope (can add later)
- War/CWL tracking, capital raids, attack stats, kick-vote workflows, payment/donation-money tracking.
