// Permission resolution for slash commands.
// Order of precedence:
//   1. Explicit DB overrides in command_permissions for (guild_id, command).
//   2. Legacy DISCORD_MANAGER_ROLE_IDS env var (workspace-wide).
//   3. Member has Discord ADMINISTRATOR permission bit (0x8).
import { adminClient } from "./leaderboard.ts";

const ADMINISTRATOR = 0x8n;
const LEGACY_ROLES = (Deno.env.get("DISCORD_MANAGER_ROLE_IDS") ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean);

export function isAdmin(member: any): boolean {
  try {
    const perms = BigInt(member?.permissions ?? "0");
    return (perms & ADMINISTRATOR) === ADMINISTRATOR;
  } catch {
    return false;
  }
}

export async function canRunCommand(
  guildId: string,
  command: string,
  member: any,
): Promise<boolean> {
  const memberRoles: string[] = member?.roles ?? [];

  if (guildId) {
    const sb = adminClient();
    const { data } = await sb
      .from("command_permissions")
      .select("role_id")
      .eq("guild_id", guildId)
      .eq("command", command);
    const overrides = (data as { role_id: string }[] | null) ?? [];
    if (overrides.length > 0) {
      const allowed = new Set(overrides.map((r) => r.role_id));
      if (memberRoles.some((r) => allowed.has(r))) return true;
      // Also allow admins through, even when overrides exist.
      return isAdmin(member);
    }
  }

  if (LEGACY_ROLES.length > 0) {
    if (memberRoles.some((r) => LEGACY_ROLES.includes(r))) return true;
  }

  return isAdmin(member);
}
