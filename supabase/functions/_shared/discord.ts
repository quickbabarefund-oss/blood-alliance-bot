// Minimal Discord REST helpers using the bot token.
const BOT = Deno.env.get("DISCORD_BOT_TOKEN") ?? "";
const API = "https://discord.com/api/v10";

async function dfetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${BOT}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  return res;
}

export type DiscordPayload = {
  content?: string;
  embeds?: any[];
  components?: any[];
};

export async function createMessage(channelId: string, payload: DiscordPayload): Promise<string | null> {
  const body = { allowed_mentions: { parse: [] }, ...payload };
  const res = await dfetch(`/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error("createMessage failed", res.status, await res.text());
    return null;
  }
  const j = await res.json();
  return j.id as string;
}

export async function editMessage(channelId: string, messageId: string, payload: DiscordPayload): Promise<boolean> {
  const body = { allowed_mentions: { parse: [] }, ...payload };
  const res = await dfetch(`/channels/${channelId}/messages/${messageId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error("editMessage failed", res.status, await res.text());
    return false;
  }
  return true;
}

export async function upsertLeaderboardMessage(
  channelId: string,
  existingMessageId: string | null,
  payload: DiscordPayload,
): Promise<string | null> {
  if (existingMessageId) {
    const ok = await editMessage(channelId, existingMessageId, payload);
    if (ok) return existingMessageId;
  }
  return await createMessage(channelId, payload);
}
