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

export async function createMessage(channelId: string, content: string): Promise<string | null> {
  const res = await dfetch(`/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
  });
  if (!res.ok) {
    console.error("createMessage failed", res.status, await res.text());
    return null;
  }
  const j = await res.json();
  return j.id as string;
}

export async function editMessage(channelId: string, messageId: string, content: string): Promise<boolean> {
  const res = await dfetch(`/channels/${channelId}/messages/${messageId}`, {
    method: "PATCH",
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
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
  content: string,
): Promise<string | null> {
  if (existingMessageId) {
    const ok = await editMessage(channelId, existingMessageId, content);
    if (ok) return existingMessageId;
    // fall through to create new
  }
  return await createMessage(channelId, content);
}

// Truncate to Discord's 2000-char limit
export function clipDiscord(content: string, max = 1990): string {
  if (content.length <= max) return content;
  return content.slice(0, max - 3) + "...";
}
