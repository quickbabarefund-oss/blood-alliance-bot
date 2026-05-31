import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

const API_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/war-tracker-api`;

type Tab = "live" | "room" | "debrief" | "overview";

function normalizeTag(t: string) {
  return t.trim().toUpperCase().replace(/^#/, "").replace(/O/g, "0");
}

function useCountdown(endIso?: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!endIso) return null;
  const end = new Date(endIso).getTime();
  const ms = Math.max(0, end - now);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const total = 24 * 3_600_000;
  return { label: `${h}h ${m}m ${s}s`, pct: Math.min(100, Math.max(0, (ms / total) * 100)) };
}

async function api(action: string, clan: string, guild: string) {
  const res = await fetch(`${API_BASE}?action=${action}&clan=${encodeURIComponent(clan)}&guild=${encodeURIComponent(guild)}`);
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export default function WarTracker() {
  const { clanTag = "" } = useParams();
  const [params] = useSearchParams();
  const guild = params.get("guild") ?? "";
  const navigate = useNavigate();

  const [tagInput, setTagInput] = useState(normalizeTag(clanTag));
  const [tab, setTab] = useState<Tab>("live");
  const [live, setLive] = useState<any>(null);
  const [room, setRoom] = useState<any>(null);
  const [debrief, setDebrief] = useState<any>(null);
  const [overview, setOverview] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const tag = useMemo(() => normalizeTag(clanTag), [clanTag]);

  async function loadAll() {
    if (!tag) return;
    setLoading(true);
    setErr(null);
    try {
      const [l, r, d, o] = await Promise.all([
        api("live", tag, guild),
        api("room", tag, guild),
        api("debrief", tag, guild),
        api("overview", tag, guild),
      ]);
      setLive(l); setRoom(r); setDebrief(d); setOverview(o);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); /* eslint-disable-next-line */ }, [tag, guild]);
  // Auto-refresh live tab every 60s
  useEffect(() => {
    if (tab !== "live") return;
    const id = setInterval(() => { api("live", tag, guild).then(setLive).catch(() => {}); }, 60_000);
    return () => clearInterval(id);
  }, [tab, tag, guild]);

  const countdown = useCountdown(live?.end_time);

  return (
    <div className="min-h-screen bg-[#0a1117] text-foreground" style={{
      backgroundImage: "radial-gradient(ellipse at top, rgba(241,185,59,0.06), transparent 60%), radial-gradient(ellipse at bottom, rgba(74,141,255,0.04), transparent 60%)",
    }}>
      <div className="max-w-6xl mx-auto p-4 md:p-8">
        <header className="mb-6 flex items-center gap-3">
          <span className="text-3xl">🛡️</span>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-wider text-[#F1B93B]" style={{ fontFamily: "'Bebas Neue', 'Inter', sans-serif", letterSpacing: "0.08em" }}>
            WAR TRACKER · SLACKER ALERT
          </h1>
          <div className="flex-1 h-px bg-gradient-to-r from-[#F1B93B]/60 to-transparent ml-3" />
        </header>

        <div className="flex flex-col sm:flex-row gap-3 mb-6 items-center justify-center">
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            placeholder="CLAN TAG"
            className="bg-black/40 border border-white/10 rounded-md px-4 py-2 text-center font-mono text-base w-56 focus:outline-none focus:border-[#F1B93B]"
          />
          <button
            onClick={() => { if (tagInput) navigate(`/war/${encodeURIComponent(normalizeTag(tagInput))}${guild ? `?guild=${guild}` : ""}`); }}
            className="bg-[#F1B93B] hover:bg-[#FFD060] text-black font-semibold px-5 py-2 rounded-md transition"
          >🔍 Check War</button>
        </div>

        {err && <div className="text-red-400 text-sm mb-3 text-center">{err}</div>}

        <div className="flex gap-1 bg-black/40 border border-white/5 rounded-full p-1 max-w-xl mx-auto mb-6">
          {([
            ["live", "🛰️", "LIVE INTEL"],
            ["room", "⚔️", "WAR ROOM"],
            ["debrief", "📜", "WAR DEBRIEF"],
            ["overview", "🏰", "CLAN OVERVIEW"],
          ] as const).map(([k, ico, label]) => (
            <button key={k}
              onClick={() => setTab(k)}
              className={`flex-1 text-xs sm:text-sm py-2 px-3 rounded-full transition font-semibold tracking-wide ${
                tab === k ? "bg-[#F1B93B] text-black shadow-lg shadow-[#F1B93B]/20" : "text-white/70 hover:text-white"
              }`}
            >{ico} {label}</button>
          ))}
        </div>

        {loading && <div className="text-center text-white/50 py-10">Loading war intel…</div>}

        {!loading && tab === "live" && (
          <LiveIntel live={live} countdown={countdown} />
        )}
        {!loading && tab === "room" && <WarRoom data={room} />}
        {!loading && tab === "debrief" && <Debrief data={debrief} />}
        {!loading && tab === "overview" && <Overview data={overview} />}
      </div>
    </div>
  );
}

function StatusBar({ pct, color = "#F1B93B" }: { pct: number; color?: string }) {
  return (
    <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
      <div className="h-full transition-all" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

function DecisionBadge({ decision, by }: { decision?: string | null; by?: string | null }) {
  if (!decision) return <span className="text-white/40 text-xs">—</span>;
  const tone = decision === "win"
    ? "bg-emerald-500/20 text-emerald-300"
    : decision === "lose"
      ? "bg-red-500/20 text-red-300"
      : "bg-white/10 text-white/70";
  const icon = decision === "win" ? "🏆" : decision === "lose" ? "🏳️" : "🚫";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold tracking-wide ${tone}`}>
      {icon} {decision.toUpperCase()}
      {by && <span className="font-normal opacity-60">· {by === "auto-fwa" ? "auto" : by === "manual" ? "manual" : by}</span>}
    </span>
  );
}

function FwaBadge({ fwa }: { fwa: any }) {
  if (!fwa) return null;
  if (fwa.status === "ok" && fwa.decision) {
    const tone = fwa.decision === "win" ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300";
    const icon = fwa.decision === "win" ? "🏆" : "🏳️";
    return (
      <a href={fwa.calculatorUrl} target="_blank" rel="noreferrer" title={fwa.reason ?? ""}
         className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold tracking-wide hover:underline ${tone}`}>
        🍫 FWA {icon} {fwa.decision.toUpperCase()}
      </a>
    );
  }
  if (fwa.status === "blocked") {
    return <a href={fwa.calculatorUrl} target="_blank" rel="noreferrer" className="text-[11px] text-amber-300/80 italic hover:underline">🍫 FWA verdict blocked — retry</a>;
  }
  return <a href={fwa.calculatorUrl} target="_blank" rel="noreferrer" className="text-[11px] text-white/40 italic hover:underline">🍫 FWA verdict not posted</a>;
}

function LiveIntel({ live, countdown }: { live: any; countdown: any }) {
  if (!live || live.state === "notInWar") {
    return <div className="text-center py-16 text-white/60">No active war right now.</div>;
  }
  const teamSize = live.team_size ?? 50;
  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 bg-black/40 border border-white/5 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="text-emerald-400 font-bold text-sm tracking-wider">WAR ACTIVE</span>
          {live.match_type && (
            <span className="text-[10px] font-bold tracking-wider px-2 py-0.5 rounded bg-white/10 text-white/70">
              {String(live.match_type).toUpperCase()}
            </span>
          )}
          <DecisionBadge decision={live.decision} by={live.decided_by} />
          <FwaBadge fwa={live.fwa} />
          <span className="ml-auto text-sm text-white/70">
            <span className="font-bold text-white">{live.clan?.name}</span>
            <span className="text-white/40"> vs </span>
            <span className="font-bold text-red-400">{live.opponent?.name}</span>
            <span className="ml-2 text-white/40">• {teamSize}v{teamSize}</span>
          </span>
        </div>
        {live.fwa?.status === "ok" && live.fwa.reason && (
          <div className="mb-3 text-xs text-white/60">
            <span className="text-white/40">FWA reason:</span> <span className="italic">{live.fwa.reason}</span>
          </div>
        )}
        <div className="grid grid-cols-2 gap-6 items-center text-center">
          <div>
            <div className="text-emerald-400 font-bold text-xs tracking-wider mb-1">{live.clan?.name?.toUpperCase()}</div>
            <div className="text-5xl font-extrabold text-[#F1B93B]">{live.clan?.stars}</div>
            <div className="text-sm text-white/60 mt-1">{live.clan?.destruction}%</div>
            <div className="text-xs text-white/40 mt-1">Attacks: {live.clan?.attacks}/{teamSize * 2}</div>
          </div>
          <div>
            <div className="text-red-400 font-bold text-xs tracking-wider mb-1">{live.opponent?.name?.toUpperCase()}</div>
            <div className="text-5xl font-extrabold text-red-400">{live.opponent?.stars}</div>
            <div className="text-sm text-white/60 mt-1">{live.opponent?.destruction}%</div>
            <div className="text-xs text-white/40 mt-1">Attacks: {live.opponent?.attacks}/{teamSize * 2}</div>
          </div>
        </div>

      </div>

      <div className="bg-black/40 border border-white/5 rounded-xl p-5">
        <div className="text-[#F1B93B] text-xs tracking-wider font-bold text-center mb-2">TIME REMAINING</div>
        <div className="text-3xl md:text-4xl font-bold text-center mb-3">{countdown?.label ?? "—"}</div>
        <StatusBar pct={countdown?.pct ?? 0} />
        <div className="mt-5 text-center">
          <div className="text-emerald-400 text-xs tracking-wider font-bold">🎲 WIN PROB</div>
          <div className="text-3xl font-extrabold text-emerald-400 mt-1">{live.win_prob}%</div>
          <div className="text-xs text-white/50">{live.win_prob >= 60 ? "Likely Victory" : live.win_prob >= 40 ? "Too Close to Call" : "Uphill Battle"}</div>
        </div>
      </div>

      <div className="lg:col-span-2 bg-black/40 border border-white/5 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-orange-400 font-bold text-sm">🔥 WAR MOMENTUM</span>
          <span className="text-sm font-mono bg-black/50 px-2 py-0.5 rounded">{live.momentum}%</span>
        </div>
        <div className="h-3 w-full rounded-full overflow-hidden" style={{
          background: "linear-gradient(90deg, #ef4444 0%, #f59e0b 50%, #22c55e 100%)",
        }}>
          <div className="h-full bg-black/40" style={{ marginLeft: `${live.momentum}%`, width: `${100 - live.momentum}%` }} />
        </div>
        <div className="flex justify-between text-xs text-white/40 mt-1 tracking-wide">
          <span>THEM</span><span>US</span>
        </div>

        <div className="mt-6">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sky-400 font-bold text-sm">🛰️ LIVE FEED</span>
            <span className="text-xs text-white/40 ml-auto">{live.feed?.length ?? 0} attacks</span>
          </div>
          <div className="max-h-96 overflow-y-auto space-y-2 pr-1">
            {(live.feed ?? []).map((a: any, i: number) => (
              <div key={i} className={`bg-black/30 rounded-lg p-3 border-l-4 ${a.badge === "CLUTCH" ? "border-orange-400" : a.badge === "RISKY" ? "border-red-400" : "border-white/10"}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold">{a.attacker_name}</span>
                  {a.badge === "CLUTCH" && <span className="bg-orange-500/30 text-orange-300 text-[10px] font-bold px-2 py-0.5 rounded">CLUTCH</span>}
                  {a.badge === "RISKY" && <span className="bg-red-500/30 text-red-300 text-[10px] font-bold px-2 py-0.5 rounded">RISKY</span>}
                  <span className="ml-auto text-sm">
                    {a.stars === 3 ? "🔥" : a.stars === 0 ? "💀" : "⚔️"} <span className="text-[#F1B93B] font-bold">{a.stars}★</span>
                  </span>
                </div>
                <div className="text-xs text-white/50 mt-1">#{a.attacker_pos} → #{a.defender_pos} · {a.destruction}% destruction {a.mirror ? "· mirror" : ""}</div>
              </div>
            ))}
            {(live.feed ?? []).length === 0 && <div className="text-white/40 text-sm py-6 text-center">No attacks yet.</div>}
          </div>
        </div>
      </div>

      <div className="bg-black/40 border border-red-500/20 rounded-xl p-5">
        <div className="text-red-400 font-bold text-sm flex items-center gap-2 mb-3">
          📍 PRIORITY TARGETS <span className="bg-red-500/20 px-2 rounded">{live.priority_targets?.length ?? 0}</span>
        </div>
        <div className="max-h-96 overflow-y-auto space-y-1">
          {(live.priority_targets ?? []).map((t: any) => (
            <div key={t.tag} className="flex items-center gap-2 text-sm py-1 border-b border-white/5">
              <span className="text-white/40 w-8">#{t.pos}</span>
              <span className="flex-1 truncate">{t.name}</span>
              <span className="text-xs text-white/40">TH{t.th}</span>
              <span className="text-[#F1B93B] text-xs">{t.best_stars}★</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function WarRoom({ data }: { data: any }) {
  if (!data || data.state === "notInWar") return <div className="text-center py-16 text-white/60">No active war.</div>;
  return (
    <div className="bg-black/40 border border-white/5 rounded-xl p-5 overflow-x-auto">
      <h2 className="text-lg font-bold mb-3">⚔️ Roster — first-attack &amp; status</h2>
      <table className="w-full text-sm">
        <thead className="text-white/50 text-xs uppercase">
          <tr><th className="text-left p-2">#</th><th className="text-left p-2">Player</th><th className="p-2">TH</th><th className="p-2">Used</th><th className="text-left p-2">Mirror</th><th className="text-left p-2">1st attack</th></tr>
        </thead>
        <tbody>
          {(data.roster ?? []).map((m: any) => (
            <tr key={m.tag} className="border-t border-white/5">
              <td className="p-2 text-white/40">{m.pos}</td>
              <td className="p-2 font-medium">{m.name}</td>
              <td className="p-2 text-center">TH{m.th}</td>
              <td className="p-2 text-center"><span className={m.used === 2 ? "text-emerald-400" : m.used === 0 ? "text-red-400" : "text-[#F1B93B]"}>{m.used}/2</span></td>
              <td className="p-2 text-white/60 text-xs">#{m.mirror?.pos ?? "?"} {m.mirror?.name ?? "—"} (TH{m.mirror?.th ?? "?"})</td>
              <td className="p-2 text-xs">{m.first_attack
                ? <span><span className={m.first_attack.defender_pos === m.pos ? "text-emerald-400" : "text-red-300"}>{m.first_attack.defender_pos === m.pos ? "mirror" : "off-mirror"}</span> → #{m.first_attack.defender_pos} · {m.first_attack.stars}★ {m.first_attack.destruction}%</span>
                : <span className="text-white/30">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Debrief({ data }: { data: any }) {
  if (!data?.war) return <div className="text-center py-16 text-white/60">No finished wars yet.</div>;
  const w = data.war;
  const grouped: Record<string, any[]> = {};
  for (const b of (data.breaks ?? [])) (grouped[b.player_tag] ??= []).push(b);
  return (
    <div className="space-y-4">
      <div className="bg-black/40 border border-white/5 rounded-xl p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-bold">📜 {w.clan_name} vs {w.opponent_name}</h2>
          <span className={`px-2 py-0.5 text-xs rounded font-bold ${w.result === "win" ? "bg-emerald-500/20 text-emerald-300" : w.result === "lose" ? "bg-red-500/20 text-red-300" : "bg-white/10"}`}>{(w.result ?? "—").toUpperCase()}</span>
          <span className="text-sm text-white/60 ml-auto">{new Date(w.end_time).toLocaleString()}</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          <Stat label="Stars" value={`${w.our_stars} – ${w.opp_stars}`} />
          <Stat label="Destruction" value={`${(+w.our_destruction).toFixed(1)}% – ${(+w.opp_destruction).toFixed(1)}%`} />
          <Stat label="Match Type" value={w.match_type ?? "—"} />
          <Stat label="Decision" value={(w.decision ?? "—").toUpperCase()} />
        </div>
      </div>

      <div className="bg-black/40 border border-red-500/10 rounded-xl p-5">
        <h3 className="font-bold text-red-300 mb-3">Rule Violations ({Object.keys(grouped).length})</h3>
        {Object.keys(grouped).length === 0 && <div className="text-emerald-400 text-sm">No violations 🎉</div>}
        <div className="space-y-3">
          {Object.entries(grouped).map(([tag, list]) => (
            <div key={tag} className="border-l-2 border-red-400/40 pl-3">
              <div className="font-semibold">{list[0].player_name} <span className="text-white/40 font-mono text-xs">{tag}</span></div>
              <ul className="text-sm text-white/70 mt-1 space-y-0.5">
                {list.map((b, i) => (
                  <li key={i}><span className="font-mono text-xs text-[#F1B93B]">{b.rule}</span> — {b.detail}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-black/30 rounded-lg p-3">
      <div className="text-xs text-white/40 tracking-wider uppercase">{label}</div>
      <div className="text-lg font-bold mt-1">{value}</div>
    </div>
  );
}

function Overview({ data }: { data: any }) {
  if (!data) return null;
  const rec = data.record ?? { wins: 0, losses: 0, total: 0 };
  return (
    <div className="space-y-4">
      <div className="bg-black/40 border border-white/5 rounded-xl p-5 flex items-center gap-5">
        {data.clan?.badge && <img src={data.clan.badge} alt="badge" className="w-20 h-20" />}
        <div className="flex-1">
          <h2 className="text-xl font-bold">{data.clan?.name ?? "—"}</h2>
          <div className="text-xs text-white/40 font-mono">{data.clan?.tag}</div>
          <div className="text-sm text-white/60 mt-1">Level {data.clan?.level ?? "?"} · {data.clan?.members ?? 0} members</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-white/40 tracking-wider">RECENT RECORD</div>
          <div className="text-lg font-bold"><span className="text-emerald-400">{rec.wins}W</span> · <span className="text-red-400">{rec.losses}L</span></div>
        </div>
      </div>

      <div className="bg-black/40 border border-white/5 rounded-xl p-5">
        <h3 className="font-bold mb-3">War History</h3>
        <div className="space-y-1">
          {(data.history ?? []).map((w: any) => (
            <div key={w.id} className="flex flex-wrap items-center gap-2 text-sm border-b border-white/5 py-2">
              <span className={`w-12 font-bold text-xs ${w.result === "win" ? "text-emerald-400" : "text-red-400"}`}>{(w.result ?? "—").toUpperCase()}</span>
              <span className="flex-1 min-w-[160px]">{w.opponent_name} <span className="text-white/30 text-xs">{w.opponent_tag}</span></span>
              <DecisionBadge decision={w.decision} by={w.decided_by} />
              {String(w.match_type ?? "").toUpperCase() === "FWA" && w.fwa_decision && (
                <span title={w.fwa_reason ?? ""}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${w.fwa_decision === "win" ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}`}>
                  🍫 {w.fwa_decision === "win" ? "🏆" : "🏳️"} {w.fwa_decision.toUpperCase()}
                </span>
              )}
              <span className="text-white/60 text-xs">{w.our_stars}–{w.opp_stars} · {(+w.our_destruction).toFixed(0)}%–{(+w.opp_destruction).toFixed(0)}%</span>
              <span className="text-white/30 text-xs ml-3 w-32 text-right">{new Date(w.end_time).toLocaleDateString()}</span>
            </div>
          ))}

          {(data.history ?? []).length === 0 && <div className="text-white/40 text-sm">No history yet.</div>}
        </div>
      </div>
    </div>
  );
}
