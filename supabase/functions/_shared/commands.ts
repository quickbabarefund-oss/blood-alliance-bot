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
  {
    name: "war_track_setup", description: "Set up war tracking for a clan in this server",
    default_member_permissions: ADMIN_ONLY,
    options: [
      { type: STRING, name: "clan_tag", description: "Clan tag (e.g. #ABC123)", required: true },
      { type: CHANNEL, name: "rep_channel", description: "Channel for reps approval embeds", required: true },
      { type: ROLE, name: "rep_role", description: "Role allowed to pick Win/Lose", required: true },
      { type: CHANNEL, name: "mail_channel", description: "Channel for mail-room announcements", required: true },
      { type: ROLE, name: "mail_ping_role", description: "Role to ping in announcements", required: true },
      { type: CHANNEL, name: "log_channel", description: "Channel for reminders/results (optional, can also use /setup_war_log_channel)" },
    ],
  },
  {
    name: "setup_war_log_channel", description: "Set the war log channel (reminders, war-started, results)",
    default_member_permissions: ADMIN_ONLY,
    options: [
      { type: STRING, name: "clan_tag", description: "Clan tag", required: true },
      { type: CHANNEL, name: "channel", description: "Log channel", required: true },
    ],
  },
  {
    name: "setup_war_reminder", description: "Manage war-day reminders",
    default_member_permissions: ADMIN_ONLY,
    options: [
      { type: SUB, name: "add", description: "Add a reminder", options: [
        { type: STRING, name: "clan_tag", description: "Clan tag", required: true },
        { type: INTEGER, name: "minutes", description: "Minutes offset (e.g. 120 = 2 hours)", required: true },
        { type: STRING, name: "anchor", description: "Anchor", required: true, choices: [
          { name: "Before war ends", value: "before_end" },
          { name: "After battle day starts", value: "after_start" },
        ]},
      ]},
      { type: SUB, name: "remove", description: "Remove a reminder by id", options: [
        { type: INTEGER, name: "id", description: "Reminder id (from list)", required: true },
      ]},
      { type: SUB, name: "list", description: "List reminders for a clan", options: [
        { type: STRING, name: "clan_tag", description: "Clan tag", required: true },
      ]},
    ],
  },
  {
    name: "war_announcement", description: "Customize win/lose mail-room announcements",
    default_member_permissions: ADMIN_ONLY,
    options: [
      { type: STRING, name: "clan_tag", description: "Clan tag", required: true },
      { type: STRING, name: "outcome", description: "Outcome", required: true, choices: [
        { name: "Win", value: "win" }, { name: "Lose", value: "lose" },
      ]},
      { type: STRING, name: "template", description: "Template. Tokens: {opponent} {opp_tag} {our} {our_tag} {ping}", required: true },
    ],
  },
  {
    name: "th_emoji", description: "Manage Town Hall custom emojis used in war embeds",
    default_member_permissions: ADMIN_ONLY,
    options: [
      { type: SUB, name: "set", description: "Set the emoji for a TH level", options: [
        { type: INTEGER, name: "th", description: "TH level (e.g. 15)", required: true },
        { type: STRING, name: "emoji", description: "Custom emoji (e.g. <:th15:1234567890>)", required: true },
      ]},
      { type: SUB, name: "list", description: "Show configured TH emojis" },
    ],
  },
];
