import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { HexColorPicker } from "react-colorful";
import {
  Plus, Trash2, Save, RotateCcw, Send, Megaphone, RefreshCw,
  ArrowUp, ArrowDown, MousePointerClick, Link as LinkIcon, ChevronDown,
} from "lucide-react";

const API = `https://oumdgsdoehqbsyudkwzm.supabase.co/functions/v1/embed-templates-api`;

// ---------- Types ----------
interface Field { name: string; value: string; inline?: boolean }
type ButtonStyle = 1 | 2 | 3 | 4 | 5; // Primary/Secondary/Success/Danger/Link
interface BtnComponent {
  type: 2; style: ButtonStyle; label: string;
  url?: string; custom_id?: string; emoji?: { name: string };
  disabled?: boolean;
}
interface SelectOption { label: string; value: string; description?: string; default?: boolean }
interface SelectComponent {
  type: 3; custom_id: string; placeholder?: string;
  min_values?: number; max_values?: number;
  options: SelectOption[];
}
type RowChild = BtnComponent | SelectComponent;
interface ActionRow { type: 1; components: RowChild[] }

interface Template {
  slot: string; enabled: boolean;
  title: string | null; title_url: string | null;
  description: string | null;
  color: number | null; footer_text: string | null;
  thumbnail_url: string | null; image_url: string | null;
  content: string | null;
  fields: Field[];
  show_timestamp: boolean;
  author_name: string | null;
  author_icon_url: string | null;
  author_url: string | null;
  components: ActionRow[];
}
interface SlotMeta { slot: string; label: string }
interface WarClan {
  clan_tag: string; clan_name: string;
  win_announcement: string | null; lose_announcement: string | null;
  mail_channel_id: string | null; mail_ping_role_id: string | null;
}

const empty = (slot: string): Template => ({
  slot, enabled: true,
  title: "", title_url: "", description: "", color: 0x5865F2,
  footer_text: "", thumbnail_url: "", image_url: "",
  content: "", fields: [], show_timestamp: false,
  author_name: "", author_icon_url: "", author_url: "",
  components: [],
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

const COLOR_PRESETS = [
  "#5865f2","#57f287","#fee75c","#eb459e","#ed4245","#ffffff","#000000",
  "#f59e0b","#10b981","#3b82f6","#a855f7","#ec4899","#ef4444","#22c55e",
];

// ---------- Main ----------
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
  const [syncing, setSyncing] = useState(false);
  const [warClans, setWarClans] = useState<WarClan[]>([]);
  const [annDefaults, setAnnDefaults] = useState<{ win: string; lose: string }>({ win: "", lose: "" });
  const [familySpacing, setFamilySpacing] = useState<number>(1);
  const [sampleValues, setSampleValues] = useState<Record<string, string>>({});
  const lastFocusedRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

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
          const t = j.templates[s.slot];
          map[s.slot] = t ? { ...empty(s.slot), ...t, components: Array.isArray(t.components) ? t.components : [] } : empty(s.slot);
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

  const insertAtCaret = (text: string) => {
    const el = lastFocusedRef.current;
    if (!el) { navigator.clipboard.writeText(text); toast({ title: "Copied", description: `${text} → clipboard` }); return; }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + text + el.value.slice(end);
    // dispatch native input event so React updates
    const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, "value")?.set;
    setter?.call(el, next);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + text.length, start + text.length);
    });
  };

  const trackFocus = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    lastFocusedRef.current = e.currentTarget;
  };

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
        toast({ title: "Saved (Discord message not refreshed)", description: j.sync_warning, variant: "destructive" });
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

  const forceSyncNow = async () => {
    setSyncing(true);
    try {
      const body: any = { token, action: "force_sync" };
      if (active === "family_dashboard" && tplMap.family_dashboard) {
        body.pending_template = tplMap.family_dashboard;
        body.spacing_lines = familySpacing;
      }
      const r = await fetch(API, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      const proof = j.proof;
      const proofMsg = proof?.message_id
        ? `Discord message ${proof.message_id} updated. Title: ${proof.title ?? "—"}`
        : "Discord embeds refreshed for this server.";
      if (j.sync_warning) {
        toast({ title: "Force sync had issues", description: j.sync_warning, variant: "destructive" });
      } else {
        toast({ title: "Force sync complete", description: proofMsg });
      }
    } catch (e: any) {
      toast({ title: "Force sync failed", description: e?.message ?? "error", variant: "destructive" });
    } finally { setSyncing(false); }
  };

  if (loading) return <div className="p-8 text-center text-muted-foreground">Loading…</div>;
  if (error) return <div className="mx-auto max-w-xl p-8 text-center text-destructive">{error}</div>;
  if (!isAnnouncementsTab && !tpl) return <div className="p-8">No template loaded.</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-gold">Embed Editor</h1>
        <p className="text-sm text-muted-foreground">
          Build fully custom Discord messages for {guildName ? <span className="font-medium">{guildName}</span> : "this server"}.
          Variables like <code>{"{opponent}"}</code> are replaced at send time.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <aside className="space-y-1 lg:sticky lg:top-4 lg:self-start">
          <div className="mb-2 px-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Components</div>
          {slots.map((s) => (
            <button
              key={s.slot}
              onClick={() => setActive(s.slot)}
              className={`block w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                active === s.slot ? "bg-secondary text-gold" : "bg-card text-muted-foreground hover:bg-secondary"
              }`}
            >
              {s.label}
            </button>
          ))}
          <div className="my-2 border-t border-border" />
          <button
            onClick={() => setActive("__announcements__")}
            className={`flex w-full items-center gap-1.5 rounded-md px-3 py-2 text-left text-sm transition-colors ${
              isAnnouncementsTab ? "bg-secondary text-gold" : "bg-card text-muted-foreground hover:bg-secondary"
            }`}
          >
            <Megaphone className="h-3.5 w-3.5" /> War Announcements
          </button>
        </aside>

        <div className="min-w-0">
        {isAnnouncementsTab ? (
          <WarAnnouncementsSection
            token={token}
            warClans={warClans}
            defaults={annDefaults}
            onSaved={(updated) => setWarClans((cs) => cs.map((c) => c.clan_tag === updated.clan_tag ? updated : c))}
          />
        ) : (
        <div className="grid gap-6 xl:grid-cols-[1fr_minmax(380px,440px)]">
          <Card className="space-y-4 p-5 min-w-0">
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

            <Tabs defaultValue="embed" className="w-full">
              <TabsList className="w-full justify-start overflow-x-auto">
                <TabsTrigger value="content">Content</TabsTrigger>
                <TabsTrigger value="embed">Embed</TabsTrigger>
                <TabsTrigger value="fields">Fields ({tpl.fields.length})</TabsTrigger>
                <TabsTrigger value="components">Components ({tpl.components.length})</TabsTrigger>
                <TabsTrigger value="placeholders">Placeholders</TabsTrigger>
              </TabsList>

              {/* CONTENT TAB */}
              <TabsContent value="content" className="space-y-3 pt-4">
                <FieldLabel label="Plain message content (sent above the embed)">
                  <Textarea rows={3} value={tpl.content ?? ""} onFocus={trackFocus}
                    onChange={(e) => update({ content: e.target.value })}
                    placeholder="Optional. Supports Discord markdown and role mentions like <@&123>." />
                </FieldLabel>
                <EmojiBar onPick={insertAtCaret} />
              </TabsContent>

              {/* EMBED TAB */}
              <TabsContent value="embed" className="space-y-4 pt-4">
                <Card className="space-y-3 p-3 bg-muted/20">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Author block</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FieldLabel label="Author name">
                      <Input value={tpl.author_name ?? ""} onFocus={trackFocus}
                        onChange={(e) => update({ author_name: e.target.value })} />
                    </FieldLabel>
                    <FieldLabel label="Author link URL">
                      <Input value={tpl.author_url ?? ""} onFocus={trackFocus}
                        onChange={(e) => update({ author_url: e.target.value })}
                        placeholder="https://…" />
                    </FieldLabel>
                  </div>
                  <FieldLabel label="Author icon URL">
                    <Input value={tpl.author_icon_url ?? ""} onFocus={trackFocus}
                      onChange={(e) => update({ author_icon_url: e.target.value })}
                      placeholder="https://…/avatar.png" />
                  </FieldLabel>
                </Card>

                <div className="grid gap-3 sm:grid-cols-2">
                  <FieldLabel label="Title">
                    <Input value={tpl.title ?? ""} onFocus={trackFocus}
                      onChange={(e) => update({ title: e.target.value })} />
                  </FieldLabel>
                  <FieldLabel label="Title URL (clickable title)">
                    <Input value={tpl.title_url ?? ""} onFocus={trackFocus}
                      onChange={(e) => update({ title_url: e.target.value })}
                      placeholder="https://…" />
                  </FieldLabel>
                </div>

                <FieldLabel label="Description">
                  <Textarea rows={5} value={tpl.description ?? ""} onFocus={trackFocus}
                    onChange={(e) => update({ description: e.target.value })} />
                </FieldLabel>

                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                  <FieldLabel label="Color">
                    <ColorPickerField
                      value={colorToHex(tpl.color)}
                      onChange={(hex) => update({ color: hexToInt(hex) })}
                    />
                  </FieldLabel>
                  <FieldLabel label="Show timestamp">
                    <div className="flex h-9 items-center">
                      <Switch checked={tpl.show_timestamp} onCheckedChange={(v) => update({ show_timestamp: v })} />
                    </div>
                  </FieldLabel>
                </div>

                <FieldLabel label="Footer text">
                  <Input value={tpl.footer_text ?? ""} onFocus={trackFocus}
                    onChange={(e) => update({ footer_text: e.target.value })} />
                </FieldLabel>

                <div className="grid gap-3 sm:grid-cols-2">
                  <FieldLabel label="Thumbnail URL (top-right)">
                    <Input value={tpl.thumbnail_url ?? ""} onFocus={trackFocus}
                      onChange={(e) => update({ thumbnail_url: e.target.value })} />
                  </FieldLabel>
                  <FieldLabel label="Image URL (large, below)">
                    <Input value={tpl.image_url ?? ""} onFocus={trackFocus}
                      onChange={(e) => update({ image_url: e.target.value })} />
                  </FieldLabel>
                </div>

                {active === "family_dashboard" && (
                  <FieldLabel label="Spacing between description & categories">
                    <div className="flex items-center gap-2">
                      {[0, 1, 2].map((n) => (
                        <Button key={n} type="button" size="sm"
                          variant={familySpacing === n ? "default" : "outline"}
                          onClick={() => setFamilySpacing(n)}>
                          {n === 0 ? "None" : n === 1 ? "1 line" : "2 lines"}
                        </Button>
                      ))}
                    </div>
                  </FieldLabel>
                )}
              </TabsContent>

              {/* FIELDS TAB */}
              <TabsContent value="fields" className="space-y-3 pt-4">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-muted-foreground">{tpl.fields.length}/25 fields</div>
                  <Button size="sm" variant="secondary" disabled={tpl.fields.length >= 25}
                    onClick={() => update({ fields: [...tpl.fields, { name: "Name", value: "Value", inline: false }] })}>
                    <Plus className="mr-1 h-4 w-4" /> Add field
                  </Button>
                </div>
                <div className="space-y-2">
                  {tpl.fields.map((f, i) => (
                    <div key={i} className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
                      <div className="grid gap-2 sm:grid-cols-[1fr_2fr]">
                        <Input placeholder="name" value={f.name} onFocus={trackFocus} onChange={(e) => {
                          const nf = [...tpl.fields]; nf[i] = { ...f, name: e.target.value }; update({ fields: nf });
                        }} />
                        <Textarea placeholder="value" rows={2} value={f.value} onFocus={trackFocus} onChange={(e) => {
                          const nf = [...tpl.fields]; nf[i] = { ...f, value: e.target.value }; update({ fields: nf });
                        }} />
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span>inline</span>
                          <Switch checked={!!f.inline} onCheckedChange={(v) => {
                            const nf = [...tpl.fields]; nf[i] = { ...f, inline: v }; update({ fields: nf });
                          }} />
                        </div>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" disabled={i === 0} onClick={() => {
                            const nf = [...tpl.fields]; [nf[i-1], nf[i]] = [nf[i], nf[i-1]]; update({ fields: nf });
                          }}><ArrowUp className="h-4 w-4" /></Button>
                          <Button size="icon" variant="ghost" disabled={i === tpl.fields.length - 1} onClick={() => {
                            const nf = [...tpl.fields]; [nf[i+1], nf[i]] = [nf[i], nf[i+1]]; update({ fields: nf });
                          }}><ArrowDown className="h-4 w-4" /></Button>
                          <Button size="icon" variant="ghost" onClick={() => update({ fields: tpl.fields.filter((_, j) => j !== i) })}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {tpl.fields.length === 0 && (
                    <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                      No fields yet. Click <strong>Add field</strong> to add inline columns or full-width rows.
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* COMPONENTS TAB */}
              <TabsContent value="components" className="space-y-3 pt-4">
                <ComponentsBuilder
                  rows={tpl.components}
                  onChange={(components) => update({ components })}
                  onFocus={trackFocus}
                />
              </TabsContent>

              {/* PLACEHOLDERS TAB */}
              <TabsContent value="placeholders" className="space-y-3 pt-4">
                <PlaceholdersPanel
                  vars={placeholders[active] ?? []}
                  descriptions={placeholderDescriptions[active] ?? {}}
                  sampleValues={sampleValues}
                  setSampleValues={setSampleValues}
                  onInsert={insertAtCaret}
                />
              </TabsContent>
            </Tabs>

            <div className="flex flex-wrap gap-2 border-t border-border pt-4">
              <Button onClick={save} disabled={saving}>
                <Save className="mr-1 h-4 w-4" /> {saving ? "Saving…" : "Save"}
              </Button>
              <Button variant="secondary" onClick={forceSyncNow} disabled={saving || syncing}>
                <RefreshCw className={`mr-1 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Syncing…" : "Force sync now"}
              </Button>
              <Button variant="outline" onClick={reset} disabled={saving}>
                <RotateCcw className="mr-1 h-4 w-4" /> Reset to default
              </Button>
            </div>
          </Card>

          {/* Live Preview */}
          <div className="space-y-2 lg:sticky lg:top-4 lg:self-start">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Live Preview</div>
            <DiscordPreview tpl={tpl} sampleValues={sampleValues} />
            <p className="text-xs text-muted-foreground">
              Rendered with your sample placeholder values (Placeholders tab). Discord may render slightly differently.
            </p>
          </div>
        </div>
        )}
        </div>
      </div>
    </div>
  );
}

// ---------- Small components ----------

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function EmojiBar({ onPick }: { onPick: (e: string) => void }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="mb-1.5 text-xs uppercase tracking-wide text-muted-foreground">Emoji palette (click to insert)</div>
      <div className="flex flex-wrap gap-1">
        {EMOJI_PALETTE.map((e) => (
          <button key={e} type="button" onClick={() => onPick(e)}
            className="rounded px-1.5 py-0.5 text-lg hover:bg-secondary">
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

function ColorPickerField({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setOpen((o) => !o)}
          className="h-9 w-12 rounded border border-border" style={{ background: value }} aria-label="Open color picker" />
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="font-mono" />
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>
          <ChevronDown className="h-4 w-4" />
        </Button>
      </div>
      {open && (
        <div className="rounded-md border border-border bg-card p-3 space-y-2">
          <HexColorPicker color={value} onChange={onChange} />
          <div className="flex flex-wrap gap-1">
            {COLOR_PRESETS.map((c) => (
              <button key={c} type="button" onClick={() => onChange(c)}
                className="h-6 w-6 rounded border border-border" style={{ background: c }} title={c} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PlaceholdersPanel({
  vars, descriptions, sampleValues, setSampleValues, onInsert,
}: {
  vars: string[]; descriptions: Record<string, string>;
  sampleValues: Record<string, string>;
  setSampleValues: (s: Record<string, string>) => void;
  onInsert: (text: string) => void;
}) {
  if (!vars.length) {
    return (
      <div className="rounded-md border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        No placeholders for this slot — text is sent as-is.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Click a chip to insert it where you last clicked in the editor. Fill <strong>Sample value</strong>
        to see how it will look in the live preview.
      </p>
      <div className="space-y-1.5">
        {vars.map((v) => (
          <div key={v} className="grid grid-cols-[160px_1fr_1fr] items-center gap-2 rounded-md border border-border bg-muted/20 p-2">
            <button type="button" onClick={() => onInsert(`{${v}}`)}
              className="rounded bg-secondary px-2 py-1 text-xs font-mono text-gold hover:bg-secondary/70 text-left">
              {`{${v}}`}
            </button>
            <span className="text-xs text-muted-foreground">{descriptions[v] ?? ""}</span>
            <Input placeholder="Sample value" value={sampleValues[v] ?? ""}
              onChange={(e) => setSampleValues({ ...sampleValues, [v]: e.target.value })} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Components builder ----------

function ComponentsBuilder({
  rows, onChange, onFocus,
}: {
  rows: ActionRow[];
  onChange: (rows: ActionRow[]) => void;
  onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
}) {
  const addRow = () => {
    if (rows.length >= 5) return;
    onChange([...rows, { type: 1, components: [] }]);
  };
  const updateRow = (i: number, row: ActionRow) => {
    const nr = [...rows]; nr[i] = row; onChange(nr);
  };
  const removeRow = (i: number) => onChange(rows.filter((_, j) => j !== i));

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Up to 5 action rows. Each row can hold up to 5 buttons, OR one select menu.
      </p>
      {rows.map((row, i) => (
        <RowEditor
          key={i}
          row={row}
          index={i}
          onChange={(r) => updateRow(i, r)}
          onRemove={() => removeRow(i)}
          onFocus={onFocus}
        />
      ))}
      <Button size="sm" variant="secondary" onClick={addRow} disabled={rows.length >= 5}>
        <Plus className="mr-1 h-4 w-4" /> Add row
      </Button>
    </div>
  );
}

function RowEditor({
  row, index, onChange, onRemove, onFocus,
}: {
  row: ActionRow; index: number;
  onChange: (r: ActionRow) => void;
  onRemove: () => void;
  onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
}) {
  const hasSelect = row.components.some((c) => c.type === 3);
  const buttonCount = row.components.filter((c) => c.type === 2).length;

  const addButton = (link = false) => {
    if (hasSelect || buttonCount >= 5) return;
    const btn: BtnComponent = link
      ? { type: 2, style: 5, label: "Open", url: "https://example.com" }
      : { type: 2, style: 1, label: "Click", custom_id: `btn_${Date.now()}` };
    onChange({ ...row, components: [...row.components, btn] });
  };
  const addSelect = () => {
    if (row.components.length > 0) return;
    const sel: SelectComponent = {
      type: 3, custom_id: `sel_${Date.now()}`, placeholder: "Choose…",
      min_values: 1, max_values: 1, options: [{ label: "Option 1", value: "opt1" }],
    };
    onChange({ ...row, components: [sel] });
  };
  const updateChild = (idx: number, child: RowChild) => {
    const nc = [...row.components]; nc[idx] = child;
    onChange({ ...row, components: nc });
  };
  const removeChild = (idx: number) =>
    onChange({ ...row, components: row.components.filter((_, j) => j !== idx) });

  return (
    <Card className="space-y-3 p-3 bg-muted/20">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Row {index + 1}</div>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" disabled={hasSelect || buttonCount >= 5} onClick={() => addButton(false)}>
            <MousePointerClick className="mr-1 h-3 w-3" /> Button
          </Button>
          <Button size="sm" variant="outline" disabled={hasSelect || buttonCount >= 5} onClick={() => addButton(true)}>
            <LinkIcon className="mr-1 h-3 w-3" /> Link
          </Button>
          <Button size="sm" variant="outline" disabled={row.components.length > 0} onClick={addSelect}>
            <ChevronDown className="mr-1 h-3 w-3" /> Select
          </Button>
          <Button size="icon" variant="ghost" onClick={onRemove}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>
      {row.components.length === 0 && (
        <div className="rounded border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
          Empty row — add a button, link, or select menu.
        </div>
      )}
      <div className="space-y-2">
        {row.components.map((c, idx) =>
          c.type === 2 ? (
            <ButtonEditor key={idx} btn={c} onChange={(b) => updateChild(idx, b)} onRemove={() => removeChild(idx)} onFocus={onFocus} />
          ) : (
            <SelectEditor key={idx} sel={c} onChange={(s) => updateChild(idx, s)} onRemove={() => removeChild(idx)} onFocus={onFocus} />
          )
        )}
      </div>
    </Card>
  );
}

const BTN_STYLES: Array<{ v: ButtonStyle; label: string; cls: string }> = [
  { v: 1, label: "Primary", cls: "bg-[#5865f2] text-white" },
  { v: 2, label: "Secondary", cls: "bg-[#4e5058] text-white" },
  { v: 3, label: "Success", cls: "bg-[#248046] text-white" },
  { v: 4, label: "Danger", cls: "bg-[#da373c] text-white" },
];

function ButtonEditor({
  btn, onChange, onRemove, onFocus,
}: {
  btn: BtnComponent;
  onChange: (b: BtnComponent) => void;
  onRemove: () => void;
  onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
}) {
  const isLink = btn.style === 5;
  return (
    <div className="rounded border border-border bg-card p-2 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium">{isLink ? "Link Button" : "Button"}</div>
        <Button size="icon" variant="ghost" onClick={onRemove}><Trash2 className="h-3 w-3" /></Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input placeholder="Label" value={btn.label} onFocus={onFocus} onChange={(e) => onChange({ ...btn, label: e.target.value })} />
        {isLink ? (
          <Input placeholder="https://…" value={btn.url ?? ""} onFocus={onFocus} onChange={(e) => onChange({ ...btn, url: e.target.value })} />
        ) : (
          <Input placeholder="custom_id (bot handles click)" value={btn.custom_id ?? ""} onFocus={onFocus}
            onChange={(e) => onChange({ ...btn, custom_id: e.target.value })} />
        )}
      </div>
      {!isLink && (
        <div className="flex flex-wrap gap-1">
          {BTN_STYLES.map((s) => (
            <button key={s.v} type="button" onClick={() => onChange({ ...btn, style: s.v })}
              className={`rounded px-2 py-1 text-xs ${btn.style === s.v ? "ring-2 ring-gold" : ""} ${s.cls}`}>
              {s.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3 text-xs">
        <label className="flex items-center gap-1">
          Emoji <Input className="w-16 h-7" value={btn.emoji?.name ?? ""} onFocus={onFocus}
            onChange={(e) => onChange({ ...btn, emoji: e.target.value ? { name: e.target.value } : undefined })} />
        </label>
        <label className="flex items-center gap-1">
          Disabled <Switch checked={!!btn.disabled} onCheckedChange={(v) => onChange({ ...btn, disabled: v })} />
        </label>
      </div>
    </div>
  );
}

function SelectEditor({
  sel, onChange, onRemove, onFocus,
}: {
  sel: SelectComponent;
  onChange: (s: SelectComponent) => void;
  onRemove: () => void;
  onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
}) {
  const updateOpt = (i: number, opt: SelectOption) => {
    const no = [...sel.options]; no[i] = opt; onChange({ ...sel, options: no });
  };
  return (
    <div className="rounded border border-border bg-card p-2 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium">Select Menu</div>
        <Button size="icon" variant="ghost" onClick={onRemove}><Trash2 className="h-3 w-3" /></Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input placeholder="custom_id" value={sel.custom_id} onFocus={onFocus}
          onChange={(e) => onChange({ ...sel, custom_id: e.target.value })} />
        <Input placeholder="Placeholder text" value={sel.placeholder ?? ""} onFocus={onFocus}
          onChange={(e) => onChange({ ...sel, placeholder: e.target.value })} />
      </div>
      <div className="grid gap-2 sm:grid-cols-2 text-xs">
        <label className="flex items-center gap-2">Min
          <Input type="number" min={0} max={25} value={sel.min_values ?? 1}
            onChange={(e) => onChange({ ...sel, min_values: Number(e.target.value) })} />
        </label>
        <label className="flex items-center gap-2">Max
          <Input type="number" min={1} max={25} value={sel.max_values ?? 1}
            onChange={(e) => onChange({ ...sel, max_values: Number(e.target.value) })} />
        </label>
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Options ({sel.options.length}/25)</Label>
          <Button size="sm" variant="ghost" disabled={sel.options.length >= 25}
            onClick={() => onChange({ ...sel, options: [...sel.options, { label: `Option ${sel.options.length + 1}`, value: `opt${sel.options.length + 1}` }] })}>
            <Plus className="h-3 w-3" /> Add option
          </Button>
        </div>
        {sel.options.map((o, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1 items-center">
            <Input placeholder="Label" value={o.label} onFocus={onFocus} onChange={(e) => updateOpt(i, { ...o, label: e.target.value })} />
            <Input placeholder="value" value={o.value} onChange={(e) => updateOpt(i, { ...o, value: e.target.value })} />
            <Input placeholder="Description" value={o.description ?? ""} onFocus={onFocus}
              onChange={(e) => updateOpt(i, { ...o, description: e.target.value })} />
            <Button size="icon" variant="ghost" onClick={() => onChange({ ...sel, options: sel.options.filter((_, j) => j !== i) })}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Preview ----------

function applyVars(s: string | null | undefined, vars: Record<string, string>): string {
  if (!s) return "";
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null && vars[k] !== "" ? vars[k] : `{${k}}`));
}

// Tiny Discord-flavored markdown renderer (bold, italic, underline, strike, inline code, masked links)
function renderMarkdown(s: string): React.ReactNode {
  if (!s) return null;
  // escape HTML
  const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
  let html = esc(s);
  html = html
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer" class="text-[#00a8fc] hover:underline">$1</a>')
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<u>$1</u>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/_(.+?)_/g, "<em>$1</em>")
    .replace(/~~(.+?)~~/g, "<s>$1</s>")
    .replace(/`([^`]+)`/g, '<code class="rounded bg-[#1e1f22] px-1 py-0.5 font-mono text-xs">$1</code>')
    .replace(/\n/g, "<br/>");
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

function DiscordPreview({ tpl, sampleValues }: { tpl: Template; sampleValues: Record<string, string> }) {
  const color = useMemo(() => colorToHex(tpl.color), [tpl.color]);
  if (!tpl.enabled) {
    return <Card className="p-4 text-sm text-muted-foreground">Disabled — bot will use built-in embed.</Card>;
  }
  const v = sampleValues;
  const title = applyVars(tpl.title, v);
  const desc = applyVars(tpl.description, v);
  const footer = applyVars(tpl.footer_text, v);
  const content = applyVars(tpl.content, v);
  const authorName = applyVars(tpl.author_name, v);

  return (
    <div className="rounded-md bg-[#313338] p-4 text-[#dbdee1]" style={{ fontFamily: "system-ui, sans-serif" }}>
      {content && <div className="mb-2 whitespace-pre-wrap text-sm">{renderMarkdown(content)}</div>}

      <div className="flex gap-3 rounded-md bg-[#2b2d31] p-3" style={{ borderLeft: `4px solid ${color}` }}>
        <div className="min-w-0 flex-1">
          {authorName && (
            <div className="mb-1 flex items-center gap-1.5 text-xs">
              {tpl.author_icon_url && (
                <img src={tpl.author_icon_url} alt="" className="h-5 w-5 rounded-full"
                  onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
              )}
              {tpl.author_url ? (
                <a href={applyVars(tpl.author_url, v)} target="_blank" rel="noreferrer"
                  className="font-semibold text-white hover:underline">{authorName}</a>
              ) : (
                <span className="font-semibold text-white">{authorName}</span>
              )}
            </div>
          )}
          {title && (
            <div className="mb-1 text-base font-semibold">
              {tpl.title_url
                ? <a href={applyVars(tpl.title_url, v)} target="_blank" rel="noreferrer" className="text-[#00a8fc] hover:underline">{title}</a>
                : <span className="text-white">{title}</span>}
            </div>
          )}
          {desc && <div className="mb-2 whitespace-pre-wrap text-sm">{renderMarkdown(desc)}</div>}

          {tpl.fields.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-x-4 gap-y-2">
              {tpl.fields.map((f, i) => (
                <div key={i} className={f.inline ? "min-w-[120px] flex-1" : "w-full"}>
                  <div className="text-sm font-semibold text-white">{renderMarkdown(applyVars(f.name, v))}</div>
                  <div className="whitespace-pre-wrap text-sm">{renderMarkdown(applyVars(f.value, v))}</div>
                </div>
              ))}
            </div>
          )}

          {tpl.image_url && (
            <img src={tpl.image_url} alt="" className="mt-2 max-h-64 rounded"
              onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
          )}

          {(footer || tpl.show_timestamp) && (
            <div className="mt-2 text-xs text-[#949ba4]">
              {footer}
              {footer && tpl.show_timestamp ? " • " : ""}
              {tpl.show_timestamp ? new Date().toLocaleString() : ""}
            </div>
          )}
        </div>
        {tpl.thumbnail_url && (
          <img src={tpl.thumbnail_url} alt="" className="h-20 w-20 shrink-0 rounded object-cover"
            onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
        )}
      </div>

      {/* Components preview */}
      {tpl.components.length > 0 && (
        <div className="mt-2 space-y-1">
          {tpl.components.map((row, i) => (
            <div key={i} className="flex flex-wrap gap-2">
              {row.components.map((c, j) => c.type === 2 ? (
                <button key={j} disabled
                  className={`rounded px-3 py-1.5 text-sm font-medium ${
                    c.style === 5 ? "bg-[#4e5058] text-white" :
                    c.style === 1 ? "bg-[#5865f2] text-white" :
                    c.style === 2 ? "bg-[#4e5058] text-white" :
                    c.style === 3 ? "bg-[#248046] text-white" :
                    "bg-[#da373c] text-white"
                  } ${c.disabled ? "opacity-50" : ""}`}>
                  {c.emoji?.name ? `${c.emoji.name} ` : ""}{c.label}
                </button>
              ) : (
                <div key={j} className="flex items-center justify-between rounded border border-[#1e1f22] bg-[#1e1f22] px-3 py-2 text-sm min-w-[200px]">
                  <span className="text-[#949ba4]">{c.placeholder || "Choose…"}</span>
                  <ChevronDown className="h-4 w-4 text-[#949ba4]" />
                </div>
              ))}
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
          <Label className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">Clan</Label>
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
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">🏆 WIN announcement</Label>
            <Textarea rows={5} value={winText} onChange={(e) => setWinText(e.target.value)} placeholder={defaults.win} />
            <div className="rounded-md bg-[#313338] p-3 text-sm text-[#dcddde] whitespace-pre-wrap">
              {renderPreview(winText)}
            </div>
            <Button size="sm" variant="outline" disabled={busy !== ""} onClick={() => testSend("win")}>
              <Send className="mr-1 h-4 w-4" /> {busy === "test-win" ? "Sending…" : "Send test to mail channel"}
            </Button>
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">🏳️ LOSE announcement</Label>
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
      </Card>
    </div>
  );
}
