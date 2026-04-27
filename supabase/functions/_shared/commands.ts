// Single source of truth for slash command definitions.
// Used by discord-register-commands (guild) and discord-register-global-commands (global)
// and by lazy on-join sync inside discord-interactions.

const CHANNEL = 7;
const STRING = 3;
const INTEGER = 4;
const USER = 6;
const ROLE = 8;
const SUB = 1;

// 0 = no one (admins only) — server admins can loosen via Server Settings → Integrations
const ADMIN_ONLY = "0";

export const COMMANDS: any[] = [
  {
    name: "clan", description: "Manage tracked clans",
    default_member_permissions: ADMIN_ONLY,
    options: [
      { type: SUB, name: "add", description: "Register a clan and bind its leaderboard channel", options: [
        { type: STRING, name: "tag", description: "Clan tag (e.g. #ABC123)", required: true },
        { type: CHANNEL, name: "channel", description: "Channel for the auto-updated leaderboard", required: true },
      ]},
      { type: SUB, name: "remove", description: "Stop tracking a clan", options: [
        { type: STRING, name: "tag", description: "Clan tag", required: true },
      ]},
      { type: SUB, name: "list", description: "List tracked clans" },
    ],
  },
  {
    name: "global", description: "Global alliance leaderboard config",
    default_member_permissions: ADMIN_ONLY,
    options: [
      { type: SUB, name: "setchannel", description: "Bind global leaderboard channel", options: [
        { type: CHANNEL, name: "channel", description: "Channel", required: true },
      ]},
    ],
  },
  {
    name: "top", description: "Top donators this month",
    options: [
      { type: STRING, name: "clan", description: "Clan tag (optional)" },
      { type: INTEGER, name: "count", description: "How many (default 10, max 50)" },
    ],
  },
  {
    name: "lowest", description: "Lowest donators this month",
    options: [
      { type: STRING, name: "clan", description: "Clan tag (optional)" },
      { type: INTEGER, name: "count", description: "How many (default 10, max 50)" },
    ],
  },
  {
    name: "player", description: "Player history & totals",
    options: [{ type: STRING, name: "tag", description: "Player tag", required: true }],
  },
  {
    name: "blacklist", description: "Manage blacklist",
    default_member_permissions: ADMIN_ONLY,
    options: [
      { type: SUB, name: "add", description: "Add tag", options: [
        { type: STRING, name: "tag", description: "Player tag", required: true },
        { type: STRING, name: "reason", description: "Reason" },
      ]},
      { type: SUB, name: "remove", description: "Remove tag", options: [
        { type: STRING, name: "tag", description: "Player tag", required: true },
      ]},
      { type: SUB, name: "list", description: "List blacklist" },
    ],
  },
  {
    name: "whitelist", description: "Manage whitelist",
    default_member_permissions: ADMIN_ONLY,
    options: [
      { type: SUB, name: "add", description: "Add tag", options: [
        { type: STRING, name: "tag", description: "Player tag", required: true },
        { type: STRING, name: "reason", description: "Reason" },
      ]},
      { type: SUB, name: "remove", description: "Remove tag", options: [
        { type: STRING, name: "tag", description: "Player tag", required: true },
      ]},
      { type: SUB, name: "list", description: "List whitelist" },
    ],
  },
  {
    name: "refresh", description: "Force immediate poll & leaderboard refresh",
    default_member_permissions: ADMIN_ONLY,
    options: [{ type: STRING, name: "clan", description: "Clan tag (optional, all if omitted)" }],
  },
  {
    name: "link", description: "Link a player or clan tag to a Discord user",
    options: [
      { type: SUB, name: "player", description: "Link a player tag", options: [
        { type: STRING, name: "tag", description: "Player tag", required: true },
        { type: USER, name: "user", description: "Discord user (defaults to you)" },
      ]},
      { type: SUB, name: "clan", description: "Link a clan tag", options: [
        { type: STRING, name: "tag", description: "Clan tag", required: true },
        { type: USER, name: "user", description: "Discord user (defaults to you)" },
      ]},
    ],
  },
  {
    name: "unlink", description: "Remove a link between a tag and a Discord user",
    options: [
      { type: SUB, name: "player", description: "Unlink a player tag", options: [
        { type: STRING, name: "tag", description: "Player tag", required: true },
        { type: USER, name: "user", description: "Discord user (defaults to you)" },
      ]},
      { type: SUB, name: "clan", description: "Unlink a clan tag", options: [
        { type: STRING, name: "tag", description: "Clan tag", required: true },
        { type: USER, name: "user", description: "Discord user (defaults to you)" },
      ]},
    ],
  },
  {
    name: "profile", description: "Look up linked players/clans",
    options: [
      { type: SUB, name: "user", description: "Show linked players for a Discord user", options: [
        { type: USER, name: "user", description: "Discord user (defaults to you)" },
      ]},
      { type: SUB, name: "tag", description: "Find the Discord user linked to a player tag", options: [
        { type: STRING, name: "tag", description: "Player tag", required: true },
      ]},
      { type: SUB, name: "clan", description: "Show linked clans for a Discord user", options: [
        { type: USER, name: "user", description: "Discord user (defaults to you)" },
      ]},
    ],
  },
  {
    name: "perm", description: "Manage which roles can run which bot commands in this server",
    default_member_permissions: ADMIN_ONLY,
    options: [
      { type: SUB, name: "grant", description: "Allow a role to use a command", options: [
        { type: STRING, name: "command", description: "Command name (e.g. clan)", required: true },
        { type: ROLE, name: "role", description: "Role to grant", required: true },
      ]},
      { type: SUB, name: "revoke", description: "Revoke a role from a command", options: [
        { type: STRING, name: "command", description: "Command name", required: true },
        { type: ROLE, name: "role", description: "Role to revoke", required: true },
      ]},
      { type: SUB, name: "list", description: "Show all per-command role overrides" },
    ],
  },
];
