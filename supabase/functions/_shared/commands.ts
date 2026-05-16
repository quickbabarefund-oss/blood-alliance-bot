// Single source of truth for slash command definitions.
// Used by discord-register-commands (guild) and discord-register-global-commands (global)
// and by lazy on-join sync inside discord-interactions.

const CHANNEL = 7;
const STRING = 3;
const INTEGER = 4;
const USER = 6;
const ROLE = 8;
const SUB = 1;
const BOOLEAN = 5;

// 0 = no one (admins only) — server admins can loosen via Server Settings → Integrations
const ADMIN_ONLY = "0";

export const COMMANDS: any[] = [
  {
    name: "clan", description: "Manage tracked clans",
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
    options: [
      { type: STRING, name: "clan_tag", description: "Clan tag", required: true },
      { type: CHANNEL, name: "channel", description: "Log channel", required: true },
    ],
  },
  {
    name: "setup_war_reminder", description: "Manage war-day reminders",
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
    options: [
      { type: STRING, name: "clan_tag", description: "Clan tag", required: true },
      { type: STRING, name: "outcome", description: "Outcome", required: true, choices: [
        { name: "Win", value: "win" }, { name: "Lose", value: "lose" },
      ]},
      { type: STRING, name: "template", description: "Template. Tokens: {opponent} {opp_tag} {our} {our_tag} {ping}", required: true },
    ],
  },
  {
    name: "war_track_list", description: "List war-tracked clans configured in this server",
  },
  {
    name: "war_track_remove", description: "Stop war tracking for a clan in this server",
    options: [
      { type: STRING, name: "clan_tag", description: "Clan tag to remove", required: true },
    ],
  },
  {
    name: "th_emoji", description: "Manage Town Hall custom emojis used in war embeds",
    options: [
      { type: SUB, name: "set", description: "Set the emoji for a TH level", options: [
        { type: INTEGER, name: "th", description: "TH level (e.g. 15)", required: true },
        { type: STRING, name: "emoji", description: "Custom emoji (e.g. <:th15:1234567890>)", required: true },
      ]},
      { type: SUB, name: "list", description: "Show configured TH emojis" },
    ],
  },
  {
    name: "war_resend_result", description: "Re-evaluate rules and re-post the latest war result for a clan",
    options: [
      { type: STRING, name: "clan_tag", description: "Clan tag", required: true },
    ],
  },
  {
    name: "war_last_result", description: "Show the last ended war's result or rule violations",
    options: [
      { type: STRING, name: "clan_tag", description: "Clan tag", required: true },
      { type: STRING, name: "mode", description: "violations (ephemeral) or full (repost to log channel)", required: false, choices: [
        { name: "violations", value: "violations" },
        { name: "full", value: "full" },
      ]},
    ],
  },
  {
    name: "help", description: "Show all available bot commands and what they do",
  },
  {
    name: "force_reset",
    description: "Force-reset slash commands for this server (wipes guild copies & re-syncs globals)",
    default_member_permissions: ADMIN_ONLY,
  },
  {
    name: "donation_reset",
    description: "Reset this month's donation totals to 0 for one clan or all clans in this server",
    default_member_permissions: ADMIN_ONLY,
    options: [
      { type: STRING, name: "clan_tag", description: "Clan tag (omit to reset ALL tracked clans in this server)" },
    ],
  },
  {
    name: "family_category",
    description: "Manage Family Dashboard categories (e.g. Farming, War, Competitive)",
    default_member_permissions: ADMIN_ONLY,
    options: [
      { type: SUB, name: "add", description: "Create a new category", options: [
        { type: STRING, name: "name", description: "Category name", required: true },
      ]},
      { type: SUB, name: "remove", description: "Delete a category and all its clans", options: [
        { type: STRING, name: "name", description: "Category name", required: true },
      ]},
      { type: SUB, name: "rename", description: "Rename a category", options: [
        { type: STRING, name: "old_name", description: "Current name", required: true },
        { type: STRING, name: "new_name", description: "New name", required: true },
      ]},
      { type: SUB, name: "list", description: "List all categories" },
    ],
  },
  {
    name: "family_clan",
    description: "Add/remove/update clans on the Family Dashboard",
    default_member_permissions: ADMIN_ONLY,
    options: [
      { type: SUB, name: "add", description: "Add a clan to a category", options: [
        { type: STRING, name: "category", description: "Category name", required: true },
        { type: STRING, name: "clan_tag", description: "Clan tag (e.g. #ABC123)", required: true },
      ]},
      { type: SUB, name: "remove", description: "Remove a clan from a category", options: [
        { type: STRING, name: "category", description: "Category name", required: true },
        { type: STRING, name: "clan_tag", description: "Clan tag", required: true },
      ]},
      { type: SUB, name: "move", description: "Move a clan to another category", options: [
        { type: STRING, name: "clan_tag", description: "Clan tag", required: true },
        { type: STRING, name: "to_category", description: "Destination category", required: true },
      ]},
      { type: SUB, name: "list", description: "List all clans grouped by category" },
    ],
  },
  {
    name: "family_clan_dashboard",
    description: "Post / re-bind the Family Clan Dashboard message in this channel",
    default_member_permissions: ADMIN_ONLY,
    options: [
      { type: CHANNEL, name: "channel", description: "Target channel (defaults to current channel)" },
    ],
  },
  {
    name: "family_customize",
    description: "Customize the Family Clan Dashboard look (title, color, footer, line format, etc.)",
    default_member_permissions: ADMIN_ONLY,
    options: [
      { type: STRING, name: "title", description: "Embed title" },
      { type: STRING, name: "description", description: "Embed description (use \\n for new lines, '-' to clear)" },
      { type: STRING, name: "color", description: "Hex color e.g. #5865F2" },
      { type: STRING, name: "footer", description: "Footer text ('-' to clear)" },
      { type: BOOLEAN, name: "show_timestamp", description: "Show 'updated at' timestamp" },
      { type: STRING, name: "thumbnail_url", description: "Thumbnail image URL ('-' to clear)" },
      { type: STRING, name: "image_url", description: "Large banner image URL ('-' to clear)" },
      { type: STRING, name: "category_emoji", description: "Emoji shown before each category name (e.g. 🏰)" },
      { type: STRING, name: "clan_line_format", description: "Per-clan line. Vars: {i} {name} {tag}. Default: `{i}.` **{name}** `{tag}`" },
      { type: BOOLEAN, name: "refresh_names", description: "Re-fetch all clan names from CoC API" },
      { type: BOOLEAN, name: "reset", description: "Reset all customization to defaults" },
    ],
  },
  {
    name: "embed_editor",
    description: "Open the web-based embed builder to customize bot messages",
    default_member_permissions: ADMIN_ONLY,
  },
  {
    name: "player_info",
    description: "Show TH, heroes, donations, war stars and more for a player",
    options: [
      { type: STRING, name: "tag", description: "Player tag (defaults to your linked tag)" },
      { type: USER,   name: "user", description: "Discord user (uses their linked player tag)" },
    ],
  },
  {
    name: "clan_info",
    description: "Show level, league, members, war record and ChocolateClash link for a clan",
    options: [
      { type: STRING, name: "tag", description: "Clan tag — type to search Family clans", autocomplete: true },
      { type: USER,   name: "user", description: "Discord user (uses their linked clan tag)" },
    ],
  },
  {
    name: "current_war",
    description: "Show the live current-war status for a clan",
    options: [
      { type: STRING, name: "tag", description: "Clan tag — type to search Family clans", autocomplete: true },
      { type: USER,   name: "user", description: "Discord user (uses their linked clan tag)" },
    ],
  },
  {
    name: "war_log",
    description: "Show the last 10 regular wars for a clan",
    options: [
      { type: STRING, name: "tag", description: "Clan tag — type to search Family clans", autocomplete: true },
      { type: USER,   name: "user", description: "Discord user (uses their linked clan tag)" },
    ],
  },
  {
    name: "clan_members",
    description: "Show clan members sorted by donations",
    options: [
      { type: STRING, name: "tag", description: "Clan tag — type to search Family clans", autocomplete: true },
      { type: USER,   name: "user", description: "Discord user (uses their linked clan tag)" },
    ],
  },
  {
    name: "cwl",
    description: "Show current Clan War League status / round",
    options: [
      { type: STRING, name: "tag", description: "Clan tag — type to search Family clans", autocomplete: true },
      { type: USER,   name: "user", description: "Discord user (uses their linked clan tag)" },
    ],
  },
  {
    name: "cwl_roster",
    description: "Show full CWL roster (all clans + their members)",
    options: [
      { type: STRING, name: "tag", description: "Clan tag — type to search Family clans", autocomplete: true },
      { type: USER,   name: "user", description: "Discord user (uses their linked clan tag)" },
    ],
  },
  {
    name: "cwl_board",
    description: "Send a CWL leaderboard image with clan rankings & stats",
    options: [
      { type: STRING, name: "tag", description: "Any clan in the CWL group — type to search Family clans", autocomplete: true },
      { type: USER,   name: "user", description: "Discord user (uses their linked clan tag)" },
    ],
  },
  {
    name: "capital_raids",
    description: "Show the most recent Clan Capital raid weekend summary",
    options: [
      { type: STRING, name: "tag", description: "Clan tag — type to search Family clans", autocomplete: true },
      { type: USER,   name: "user", description: "Discord user (uses their linked clan tag)" },
    ],
  },
  {
    name: "compo",
    description: "Show clan composition (Town Hall breakdown)",
    options: [
      { type: STRING, name: "tag", description: "Clan tag — type to search Family clans", autocomplete: true },
      { type: USER,   name: "user", description: "Discord user (uses their linked clan tag)" },
    ],
  },
  {
    name: "player_activity",
    description: "Show a player's recent activity (today / 7d / 30d / month) with last-seen, wars & donations",
    options: [
      { type: STRING, name: "tag",  description: "Player tag — type to search known players", autocomplete: true },
      { type: USER,   name: "user", description: "Discord user (uses their linked player tag)" },
    ],
  },
  {
    name: "player_joins",
    description: "Show a player's join/leave history across Family clans (last 180 days)",
    options: [
      { type: STRING, name: "tag",  description: "Player tag — type to search known players", autocomplete: true },
      { type: USER,   name: "user", description: "Discord user (uses their linked player tag)" },
    ],
  },
];
