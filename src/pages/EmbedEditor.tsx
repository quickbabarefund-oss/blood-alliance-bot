import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { Plus, Trash2, Save, RotateCcw, Send, Megaphone } from "lucide-react";

const API = `https://oumdgsdoehqbsyudkwzm.supabase.co/functions/v1/embed-templates-api`;

interface Field { name: string; value: string; inline?: boolean }
interface Template {
  slot: string; enabled: boolean;
  title: string | null; description: string | null;
  color: number | null; footer_text: string | null;
  thumbnail_url: string | null; image_url: string | null;
  content: string | null;
  fields: Field[];
  show_timestamp: boolean;
}
interface SlotMeta { slot: string; label: string }
interface WarClan {
  clan_tag: string; clan_name: string;
  win_announcement: string | null; lose_announcement: string | null;
  mail_channel_id: string | null; mail_ping_role_id: string | null;
}

const empty = (slot: string): Template => ({
  slot, enabled: true,
  title: "", description: "", color: 0x5865F2,
  footer_text: "", thumbnail_url: "", image_url: "",
  content: "", fields: [], show_timestamp: false,
});

function colorToHex(c: number | null): string {
  if (c == null) return "#5865f2";
  return "#" + c.toString(16).padStart(6, "0");
}
function hexToInt(h: string): number {
  const m = h.replace(/^#/, "");
  return parseInt(/^[0-9a-f]{6}$/i.test(m) ? m : "5865f2", 16);
}

const EMOJI_PALETTE = [
  "🏰","🛡️","⚔️","🏆","🔥","👑","🥈","🎖️","🏷️","👥","🎮","🍫",
  "⭐","💥","🎯","📊","📈","📉","🟢","🔴","🟡","✅","❌","⏰",
  "🕒","🗡️","🪖","💀","☠️","🧱","💣","⚡","✨","💎","📜","📣",
  "📢","🔔","❤️","💙","💚","🎁","📥","🦸","🌍","ℹ️","🏯","🥇",
];

export default function EmbedEditor() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [slots, setSlots] = useState<SlotMeta[]>([]);
  const [placeholders, setPlaceholders] = useState<Record<string, string[]>>({});
  const [placeholderDescriptions, setPlaceholderDescriptions] = useState<Record<string, Record<string, string>>>({});
  const [guildName, setGuildName] = useState<string | null>(null);
  const [active, setActive] = useState<string>("family_dashboard");
  const [tplMap, setTplMap] = useState<Record<string, Template>>({});
  const [saving, setSaving] = useState(false);
  const [warClans, setWarClans] = useState<WarClan[]>([]);
  const [annDefaults, setAnnDefaults] = useState<{ win: string; lose: string }>({ win: "", lose: "" });
  const [familySpacing, setFamilySpacing] = useState<number>(1);
  // "announcements" is a synthetic tab — handled separately from embed slots
  const isAnnouncementsTab = active === "__announcements__";

  useEffect(() => {
    if (!token) { setError("Missing token. Run /embed_editor in Discord to get a link."); setLoading(false); return; }
    (async () => {
      try {
        const r = await fetch(`${API}?token=${encodeURIComponent(token)}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? r.statusText);
        setSlots(j.slots ?? []);
        setPlaceholders(j.placeholders ?? {});
        setPlaceholderDescriptions(j.placeholder_descriptions ?? {});
        setGuildName(j.guild_name ?? null);
        const map: Record<string, Template> = {};
        for (const s of j.slots ?? []) {
          map[s.slot] = j.templates[s.slot] ?? empty(s.slot);
        }
        setTplMap(map);
        setWarClans(j.war_clans ?? []);
        setAnnDefaults(j.announcement_defaults ?? { win: "", lose: "" });
        setFamilySpacing(typeof j.family_dashboard_spacing === "number" ? j.family_dashboard_spacing : 1);
        if (j.slots?.[0]) setActive(j.slots[0].slot);
      } catch (e: any) {
        setError(e?.message ?? "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const tpl = tplMap[active];
  const update = (patch: Partial<Template>) =>
    setTplMap((m) => ({ ...m, [active]: { ...m[active], ...patch } }));

  const save = async () => {
    setSaving(true);
    try {
      const payload: any = { token, ...tpl };
      if (active === "family_dashboard") payload.spacing_lines = familySpacing;
      const r = await fetch(API, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      if (j.sync_warning) {
        toast({ title: "Saved (dashboard not refreshed)", description: j.sync_warning, variant: "destructive" });
      } else {
        toast({ title: "Saved", description: `Template for ${active} updated.` });
      }
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message ?? "error", variant: "destructive" });
    } finally { setSaving(false); }
  };

  const reset = async () => {
    if (!confirm("Reset this slot to defaults? The bot will fall back to its built-in embed.")) return;
    setSaving(true);
    try {
      const r = await fetch(API, {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, slot: active }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setTplMap((m) => ({ ...m, [active]: empty(active) }));
      toast({ title: "Reset", description: `${active} cleared.` });
    } catch (e: any) {
      toast({ title: "Reset failed", description: e?.message ?? "error", variant: "destructive" });
    } finally { setSaving(false); }
  };

  if (loading) return <div className="p-8 text-center text-muted-foreground">Loading…</div>;
  if (error) return <div className="mx-auto max-w-xl p-8 text-center text-destructive">{error}</div>;
  if (!isAnnouncementsTab && !tpl) return <div className="p-8">No template loaded.</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-gold">Embed Editor</h1>
        <p className="text-sm text-muted-foreground">
          Customize bot embeds for {guildName ? <span className="font-medium">{guildName}</span> : "this server"}.
          Variables like <code>{"{opponent}"}</code> are replaced at send time. Leave a field blank to use the bot default.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {slots.map((s) => (
          <button
            key={s.slot}
            onClick={() => setActive(s.slot)}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              active === s.slot ? "bg-secondary text-gold" : "bg-card text-muted-foreground hover:bg-secondary"
            }`}
          >
            {s.label}
          </button>
        ))}
        <button
          onClick={() => setActive("__announcements__")}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
            isAnnouncementsTab ? "bg-secondary text-gold" : "bg-card text-muted-foreground hover:bg-secondary"
          }`}
        >
          <Megaphone className="h-3.5 w-3.5" /> War Announcements
        </button>
      </div>

      {isAnnouncementsTab ? (
        <WarAnnouncementsSection
          token={token}
          warClans={warClans}
          defaults={annDefaults}
          onSaved={(updated) => setWarClans((cs) => cs.map((c) => c.clan_tag === updated.clan_tag ? updated : c))}
        />
      ) : null}

      {!isAnnouncementsTab && (

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Form */}
        <Card className="space-y-4 p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Slot</div>
              <div className="font-medium">{slots.find((x) => x.slot === active)?.label}</div>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-sm">Enabled</Label>
              <Switch checked={tpl.enabled} onCheckedChange={(v) => update({ enabled: v })} />
            </div>
          </div>

          <PlaceholderBar vars={placeholders[active] ?? []} descriptions={placeholderDescriptions[active] ?? {}} />
          <EmojiBar />

          <Field label="Title">
            <Input value={tpl.title ?? ""} onChange={(e) => update({ title: e.target.value })} />
          </Field>
          <Field label="Description">
            <Textarea rows={4} value={tpl.description ?? ""} onChange={(e) => update({ description: e.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Color">
              <div className="flex items-center gap-2">
                <input type="color" value={colorToHex(tpl.color)} onChange={(e) => update({ color: hexToInt(e.target.value) })} className="h-9 w-12 cursor-pointer rounded border border-border bg-transparent" />
                <Input value={colorToHex(tpl.color)} onChange={(e) => update({ color: hexToInt(e.target.value) })} />
              </div>
            </Field>
            <Field label="Show timestamp">
              <Switch checked={tpl.show_timestamp} onCheckedChange={(v) => update({ show_timestamp: v })} />
            </Field>
          </div>
          <Field label="Footer text">
            <Input value={tpl.footer_text ?? ""} onChange={(e) => update({ footer_text: e.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Thumbnail URL">
              <Input value={tpl.thumbnail_url ?? ""} onChange={(e) => update({ thumbnail_url: e.target.value })} />
            </Field>
            <Field label="Image URL">
              <Input value={tpl.image_url ?? ""} onChange={(e) => update({ image_url: e.target.value })} />
            </Field>
          </div>
          <Field label="Plain content (above embed, optional)">
            <Textarea rows={2} value={tpl.content ?? ""} onChange={(e) => update({ content: e.target.value })} />
          </Field>

          {active === "family_dashboard" && (
            <Field label="Spacing between description & categories">
              <div className="flex items-center gap-2">
                {[0, 1, 2].map((n) => (
                  <Button key={n} type="button" size="sm"
                    variant={familySpacing === n ? "default" : "outline"}
                    onClick={() => setFamilySpacing(n)}>
                    {n === 0 ? "None" : n === 1 ? "1 line" : "2 lines"}
                  </Button>
                ))}
                <span className="text-xs text-muted-foreground">
                  Controls blank lines between description→first category and between categories.
                </span>
              </div>
            </Field>
          )}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label>Fields ({tpl.fields.length}/25)</Label>
              <Button size="sm" variant="secondary" onClick={() => update({ fields: [...tpl.fields, { name: "Name", value: "Value", inline: false }] })}>
                <Plus className="mr-1 h-4 w-4" /> Add field
              </Button>
            </div>
            <div className="space-y-2">
              {tpl.fields.map((f, i) => (
                <div key={i} className="rounded-md border border-border bg-muted/30 p-3">
                  <div className="grid gap-2 sm:grid-cols-[1fr_2fr_auto_auto]">
                    <Input placeholder="name" value={f.name} onChange={(e) => {
                      const nf = [...tpl.fields]; nf[i] = { ...f, name: e.target.value }; update({ fields: nf });
                    }} />
                    <Textarea placeholder="value" rows={1} value={f.value} onChange={(e) => {
                      const nf = [...tpl.fields]; nf[i] = { ...f, value: e.target.value }; update({ fields: nf });
                    }} />
                    <div className="flex items-center gap-1 text-xs">
                      inline
                      <Switch checked={!!f.inline} onCheckedChange={(v) => {
                        const nf = [...tpl.fields]; nf[i] = { ...f, inline: v }; update({ fields: nf });
                      }} />
                    </div>
                    <Button size="icon" variant="ghost" onClick={() => update({ fields: tpl.fields.filter((_, j) => j !== i) })}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button onClick={save} disabled={saving}>
              <Save className="mr-1 h-4 w-4" /> {saving ? "Saving…" : "Save"}
            </Button>
            <Button variant="outline" onClick={reset} disabled={saving}>
              <RotateCcw className="mr-1 h-4 w-4" /> Reset to default
            </Button>
          </div>
        </Card>

        {/* Preview */}
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Live Preview</div>
          <DiscordEmbedPreview tpl={tpl} />
          <p className="text-xs text-muted-foreground">
            Discord may render slightly differently. Available variables vary by slot
            (e.g. <code>{"{opponent}"}</code>, <code>{"{our}"}</code>, <code>{"{ping}"}</code> for war embeds).
          </p>
        </div>
      </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function PlaceholderBar({ vars, descriptions }: { vars: string[]; descriptions: Record<string, string> }) {
  if (!vars.length) {
    return (
      <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        No variables for this slot — text is used as-is.
      </div>
    );
  }
  const copy = (v: string) => {
    navigator.clipboard.writeText(`{${v}}`);
    toast({ title: "Copied", description: `{${v}} → clipboard. Paste into any field.` });
  };
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="mb-1.5 text-xs uppercase tracking-wide text-muted-foreground">Available placeholders (click to copy)</div>
      <div className="flex flex-wrap gap-1.5">
        {vars.map((v) => (
          <button key={v} type="button" onClick={() => copy(v)}
            className="rounded bg-secondary px-2 py-0.5 text-xs font-mono text-gold hover:bg-secondary/70">
            {`{${v}}`}
          </button>
        ))}
      </div>
      {Object.keys(descriptions).length > 0 && (
        <div className="mt-2.5 space-y-1 border-t border-border pt-2">
          {vars.map((v) => descriptions[v] && (
            <div key={v} className="flex items-start gap-2 text-xs">
              <code className="shrink-0 rounded bg-muted px-1 py-0.5 font-mono text-gold">{`{${v}}`}</code>
              <span className="text-muted-foreground">{descriptions[v]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EmojiBar() {
  const copy = (e: string) => {
    navigator.clipboard.writeText(e);
    toast({ title: "Emoji copied", description: `${e} → clipboard.` });
  };
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="mb-1.5 text-xs uppercase tracking-wide text-muted-foreground">Emoji palette (click to copy)</div>
      <div className="flex flex-wrap gap-1">
        {EMOJI_PALETTE.map((e) => (
          <button key={e} type="button" onClick={() => copy(e)}
            className="rounded px-1.5 py-0.5 text-lg hover:bg-secondary">
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

function DiscordEmbedPreview({ tpl }: { tpl: Template }) {
  const color = useMemo(() => colorToHex(tpl.color), [tpl.color]);
  if (!tpl.enabled) {
    return <Card className="p-4 text-sm text-muted-foreground">Disabled — bot will use built-in embed.</Card>;
  }
  return (
    <div className="rounded-md bg-[#313338] p-4 text-[#dcddde]" style={{ fontFamily: "system-ui, sans-serif" }}>
      {tpl.content && <div className="mb-2 whitespace-pre-wrap text-sm">{tpl.content}</div>}
      <div className="flex gap-3 rounded-md bg-[#2b2d31] p-3" style={{ borderLeft: `4px solid ${color}` }}>
        <div className="min-w-0 flex-1">
          {tpl.title && <div className="mb-1 font-semibold text-white">{tpl.title}</div>}
          {tpl.description && <div className="mb-2 whitespace-pre-wrap text-sm">{tpl.description}</div>}
          {tpl.fields.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-x-4 gap-y-2">
              {tpl.fields.map((f, i) => (
                <div key={i} className={f.inline ? "min-w-[120px] flex-1" : "w-full"}>
                  <div className="text-sm font-semibold text-white">{f.name}</div>
                  <div className="whitespace-pre-wrap text-sm">{f.value}</div>
                </div>
              ))}
            </div>
          )}
          {tpl.image_url && <img src={tpl.image_url} alt="" className="mt-2 max-h-64 rounded" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />}
          {(tpl.footer_text || tpl.show_timestamp) && (
            <div className="mt-2 text-xs text-[#949ba4]">
              {tpl.footer_text}
              {tpl.footer_text && tpl.show_timestamp ? " • " : ""}
              {tpl.show_timestamp ? new Date().toLocaleString() : ""}
            </div>
          )}
        </div>
        {tpl.thumbnail_url && <img src={tpl.thumbnail_url} alt="" className="h-20 w-20 shrink-0 rounded object-cover" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />}
      </div>
    </div>
  );
}

const ANNOUNCEMENT_PLACEHOLDERS: Array<[string, string]> = [
  ["{opponent}", "Opponent clan name"],
  ["{opp_tag}", "Opponent clan tag"],
  ["{our}", "Your clan name"],
  ["{our_tag}", "Your clan tag"],
  ["{ping}", "Mail-room role mention"],
];

function WarAnnouncementsSection({
  token, warClans, defaults, onSaved,
}: {
  token: string;
  warClans: WarClan[];
  defaults: { win: string; lose: string };
  onSaved: (c: WarClan) => void;
}) {
  const [selectedTag, setSelectedTag] = useState<string>(warClans[0]?.clan_tag ?? "");
  const selected = warClans.find((c) => c.clan_tag === selectedTag);
  const [winText, setWinText] = useState<string>("");
  const [loseText, setLoseText] = useState<string>("");
  const [busy, setBusy] = useState<"" | "save" | "test-win" | "test-lose">("");

  useEffect(() => {
    if (!selected) { setWinText(""); setLoseText(""); return; }
    setWinText(selected.win_announcement ?? defaults.win);
    setLoseText(selected.lose_announcement ?? defaults.lose);
  }, [selectedTag, selected, defaults.win, defaults.lose]);

  if (!warClans.length) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        No clans are war-tracked in this server yet. Use <code>/war_track_setup</code> first.
      </Card>
    );
  }

  const copy = (v: string) => {
    navigator.clipboard.writeText(v);
    toast({ title: "Copied", description: `${v} → clipboard.` });
  };

  const save = async () => {
    if (!selected) return;
    setBusy("save");
    try {
      const r = await fetch(API, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token, action: "save_announcement", clan_tag: selected.clan_tag,
          win_announcement: winText, lose_announcement: loseText,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      onSaved({ ...selected, win_announcement: winText || null, lose_announcement: loseText || null });
      toast({ title: "Saved", description: `Announcements updated for ${selected.clan_name || selected.clan_tag}.` });
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message ?? "error", variant: "destructive" });
    } finally { setBusy(""); }
  };

  const testSend = async (outcome: "win" | "lose") => {
    if (!selected) return;
    if (!selected.mail_channel_id) {
      toast({ title: "No mail channel", description: "Configure a mail channel via /war_track_setup first.", variant: "destructive" });
      return;
    }
    setBusy(outcome === "win" ? "test-win" : "test-lose");
    try {
      const r = await fetch(API, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token, action: "test_announcement", clan_tag: selected.clan_tag,
          outcome, template: outcome === "win" ? winText : loseText,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      toast({ title: "Test sent", description: `Posted to <#${j.channel_id}> in Discord.` });
    } catch (e: any) {
      toast({ title: "Test failed", description: e?.message ?? "error", variant: "destructive" });
    } finally { setBusy(""); }
  };

  const renderPreview = (tpl: string) => tpl
    .split("{opponent}").join("Sample Enemy Clan")
    .split("{opp_tag}").join("#OPPTAG")
    .split("{our}").join(selected?.clan_name || selected?.clan_tag || "")
    .split("{our_tag}").join(selected?.clan_tag ?? "")
    .split("{ping}").join(selected?.mail_ping_role_id ? `@MailRole` : "");

  return (
    <div className="space-y-6">
      <Card className="space-y-4 p-5">
        <div>
          <Label className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
            Clan
          </Label>
          <select
            value={selectedTag}
            onChange={(e) => setSelectedTag(e.target.value)}
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
          >
            {warClans.map((c) => (
              <option key={c.clan_tag} value={c.clan_tag}>
                {c.clan_name ? `${c.clan_name} (${c.clan_tag})` : c.clan_tag}
              </option>
            ))}
          </select>
          {selected && (
            <p className="mt-2 text-xs text-muted-foreground">
              Mail channel: {selected.mail_channel_id ? <code>&lt;#{selected.mail_channel_id}&gt;</code> : <span className="text-destructive">not set</span>}
              {" • "}
              Ping role: {selected.mail_ping_role_id ? <code>&lt;@&{selected.mail_ping_role_id}&gt;</code> : <span className="text-muted-foreground">none</span>}
            </p>
          )}
        </div>

        <div className="rounded-md border border-border bg-muted/30 p-3">
          <div className="mb-1.5 text-xs uppercase tracking-wide text-muted-foreground">Available placeholders (click to copy)</div>
          <div className="flex flex-wrap gap-1.5">
            {ANNOUNCEMENT_PLACEHOLDERS.map(([k, desc]) => (
              <button key={k} type="button" onClick={() => copy(k)}
                className="rounded bg-secondary px-2 py-0.5 text-xs font-mono text-gold hover:bg-secondary/70" title={desc}>
                {k}
              </button>
            ))}
          </div>
          <div className="mt-2 space-y-1 border-t border-border pt-2">
            {ANNOUNCEMENT_PLACEHOLDERS.map(([k, desc]) => (
              <div key={k} className="flex items-start gap-2 text-xs">
                <code className="shrink-0 rounded bg-muted px-1 py-0.5 font-mono text-gold">{k}</code>
                <span className="text-muted-foreground">{desc}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              🏆 WIN announcement
            </Label>
            <Textarea rows={5} value={winText} onChange={(e) => setWinText(e.target.value)} placeholder={defaults.win} />
            <div className="rounded-md bg-[#313338] p-3 text-sm text-[#dcddde] whitespace-pre-wrap">
              {renderPreview(winText)}
            </div>
            <Button size="sm" variant="outline" disabled={busy !== ""} onClick={() => testSend("win")}>
              <Send className="mr-1 h-4 w-4" /> {busy === "test-win" ? "Sending…" : "Send test to mail channel"}
            </Button>
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              🏳️ LOSE announcement
            </Label>
            <Textarea rows={5} value={loseText} onChange={(e) => setLoseText(e.target.value)} placeholder={defaults.lose} />
            <div className="rounded-md bg-[#313338] p-3 text-sm text-[#dcddde] whitespace-pre-wrap">
              {renderPreview(loseText)}
            </div>
            <Button size="sm" variant="outline" disabled={busy !== ""} onClick={() => testSend("lose")}>
              <Send className="mr-1 h-4 w-4" /> {busy === "test-lose" ? "Sending…" : "Send test to mail channel"}
            </Button>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <Button onClick={save} disabled={busy !== ""}>
            <Save className="mr-1 h-4 w-4" /> {busy === "save" ? "Saving…" : "Save announcements"}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          These messages are posted to the mail-room channel when a rep marks a war as Win or Lose.
          Use <strong>Send test</strong> to verify your channel + role permissions are working — it posts a one-off
          message tagged 🧪 to the same channel without affecting any real war.
        </p>
      </Card>
    </div>
  );
}
