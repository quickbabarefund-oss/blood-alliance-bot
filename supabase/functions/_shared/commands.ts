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
      { type: CHANNEL, name: "mail_channel", description: "Channel for mail-room announcements (optional)" },
      { type: ROLE, name: "mail_ping_role", description: "Role to ping in mail-room announcements (optional)" },
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
    name: "command_toggle",
    description: "Enable/disable bot commands in this server (bot owner only)",
    default_member_permissions: ADMIN_ONLY,
    options: [
      { type: SUB, name: "disable", description: "Disable a command in this server", options: [
        { type: STRING, name: "command", description: "Command name (e.g. top)", required: true },
      ]},
      { type: SUB, name: "enable", description: "Re-enable a previously disabled command", options: [
        { type: STRING, name: "command", description: "Command name", required: true },
      ]},
      { type: SUB, name: "list", description: "List disabled commands in this server" },
    ],
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
    description: "Manage Family Dashboard categories (e.g. FWA, WAR, CWL)",
    default_member_permissions: ADMIN_ONLY,
    options: [
      { type: SUB, name: "add", description: "Create a new category (becomes a button on the dashboard)", options: [
        { type: STRING, name: "name", description: "Category name (also the button label by default)", required: true },
        { type: STRING, name: "emoji", description: "Emoji shown on the button (e.g. 🏆 ⚔️ 👑)" },
        { type: STRING, name: "button_label", description: "Override the button text (defaults to name)" },
        { type: INTEGER, name: "button_style", description: "Button color", choices: [
          { name: "Blurple (Primary)", value: 1 },
          { name: "Grey (Secondary)", value: 2 },
          { name: "Green (Success)", value: 3 },
          { name: "Red (Danger)", value: 4 },
        ]},
        { type: STRING, name: "line_format", description: "Per-clan line format. Vars: {i} {name} {tag}" },
        { type: INTEGER, name: "position", description: "Sort order on dashboard (lower = first)" },
      ]},
      { type: SUB, name: "edit", description: "Update an existing category's button look", options: [
        { type: STRING, name: "name", description: "Existing category name", required: true },
        { type: STRING, name: "new_name", description: "Rename the category" },
        { type: STRING, name: "emoji", description: "Emoji ('-' to clear)" },
        { type: STRING, name: "button_label", description: "Override button label ('-' to clear)" },
        { type: INTEGER, name: "button_style", description: "Button color", choices: [
          { name: "Blurple (Primary)", value: 1 },
          { name: "Grey (Secondary)", value: 2 },
          { name: "Green (Success)", value: 3 },
          { name: "Red (Danger)", value: 4 },
        ]},
        { type: STRING, name: "line_format", description: "Per-clan line format ('-' to clear)" },
        { type: INTEGER, name: "position", description: "Sort order (lower = first)" },
      ]},
      { type: SUB, name: "remove", description: "Delete a category and all its clans", options: [
        { type: STRING, name: "name", description: "Category name", required: true },
      ]},
      { type: SUB, name: "rename", description: "Rename a category (use /family_category edit for full control)", options: [
        { type: STRING, name: "old_name", description: "Current name", required: true },
        { type: STRING, name: "new_name", description: "New name", required: true },
      ]},
      { type: SUB, name: "reorder", description: "Reorder category buttons interactively" },
      { type: SUB, name: "list", description: "List all categories with their button styling" },
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
    name: "family_info",
    description: "Manage info buttons on the Family Dashboard (e.g. 'What is FWA?')",
    default_member_permissions: ADMIN_ONLY,
    options: [
      { type: SUB, name: "add", description: "Add a new info button + message", options: [
        { type: STRING, name: "name", description: "Friendly name / button label (e.g. What is FWA?)", required: true },
        { type: STRING, name: "title", description: "Embed title", required: true },
        { type: STRING, name: "message", description: "Embed body (\\n for new lines)", required: true },
        { type: STRING, name: "key", description: "Optional unique key (auto-generated from name if omitted)" },
        { type: STRING, name: "label", description: "Override button label (defaults to name)" },
        { type: STRING, name: "emoji", description: "Button emoji (e.g. ❗ 🎓)" },
        { type: INTEGER, name: "button_style", description: "Button color", choices: [
          { name: "Blurple (Primary)", value: 1 },
          { name: "Grey (Secondary)", value: 2 },
          { name: "Green (Success)", value: 3 },
          { name: "Red (Danger)", value: 4 },
        ]},
        { type: STRING, name: "color", description: "Embed hex color (e.g. #F1B93B)" },
        { type: STRING, name: "image_url", description: "Large image URL" },
        { type: STRING, name: "thumbnail_url", description: "Thumbnail URL" },
        { type: INTEGER, name: "position", description: "Sort order on dashboard (lower = first)" },
      ]},
      { type: SUB, name: "edit", description: "Update an existing info entry", options: [
        { type: STRING, name: "key", description: "Existing key", required: true },
        { type: STRING, name: "label", description: "Button label ('-' to clear)" },
        { type: STRING, name: "title", description: "Embed title ('-' to clear)" },
        { type: STRING, name: "message", description: "Embed body ('-' to clear)" },
        { type: STRING, name: "emoji", description: "Button emoji ('-' to clear)" },
        { type: INTEGER, name: "button_style", description: "Button color", choices: [
          { name: "Blurple (Primary)", value: 1 },
          { name: "Grey (Secondary)", value: 2 },
          { name: "Green (Success)", value: 3 },
          { name: "Red (Danger)", value: 4 },
        ]},
        { type: STRING, name: "color", description: "Embed hex color ('-' to clear)" },
        { type: STRING, name: "image_url", description: "Image URL ('-' to clear)" },
        { type: STRING, name: "thumbnail_url", description: "Thumbnail URL ('-' to clear)" },
        { type: INTEGER, name: "position", description: "Sort order on dashboard" },
      ]},
      { type: SUB, name: "remove", description: "Delete an info entry", options: [
        { type: STRING, name: "key", description: "Key to remove", required: true },
      ]},
      { type: SUB, name: "reorder", description: "Reorder info buttons interactively" },
      { type: SUB, name: "list", description: "List all info entries" },
    ],
  },
  {
    name: "family_dashboard_layout",
    description: "Control the Clan Statistics button position & visibility on the Family Dashboard",
    default_member_permissions: ADMIN_ONLY,
    options: [
      { type: INTEGER, name: "stats_position", description: "Where the 📊 Clan Statistics button sits (lower = first). 9999 = last." },
      { type: BOOLEAN, name: "stats_enabled", description: "Show / hide the Clan Statistics button" },
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
    name: "war_decision",
    description: "Manually set the strategy for the active war (WIN / LOSE / MISS).",
    options: [
      { type: STRING, name: "clan_tag", description: "Clan tag (e.g. #ABC123)", required: true, autocomplete: true },
      { type: STRING, name: "decision", description: "Choose the strategy", required: true, choices: [
        { name: "WIN — go for it",  value: "win" },
        { name: "LOSE — friendly", value: "lose" },
        { name: "MISS — don't attack", value: "miss" },
      ] },
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
  {
    name: "discord_link",
    description: "Show Discord links for clan members — pick clan(s) from a menu",
  },
  {
    name: "myr",
    description: "Show CWL registration details for you or another user",
    options: [
      { type: USER, name: "user", description: "Discord user (defaults to you)" },
    ],
  },
  {
    name: "war_tracker",
    description: "Open the live War Tracker dashboard for a clan",
    options: [
      { type: STRING, name: "clan", description: "Clan tag (defaults to first tracked clan)", autocomplete: true },
    ],
  },
  {
    name: "war",
    description: "Live war summary for a clan (alias of /current_war)",
    options: [
      { type: STRING, name: "tag", description: "Clan tag — type to search Family/recent clans", autocomplete: true },
      { type: USER,   name: "user", description: "Discord user (uses their linked clan tag)" },
    ],
  },
  {
    name: "warlog",
    description: "Last 10 regular wars for a clan (alias of /war_log)",
    options: [
      { type: STRING, name: "tag", description: "Clan tag — type to search Family/recent clans", autocomplete: true },
      { type: USER,   name: "user", description: "Discord user (uses their linked clan tag)" },
    ],
  },
  {
    name: "remaining",
    description: "Show remaining or missed war hits of a clan",
    options: [
      { type: STRING, name: "tag", description: "Clan tag — type to search Family/recent clans", autocomplete: true },
      { type: USER,   name: "user", description: "Discord user (uses their linked clan tag)" },
    ],
  },
  {
    name: "lineup",
    description: "Displays war line-up of a clan with mirror opponents",
    options: [
      { type: STRING, name: "tag", description: "Clan tag — type to search Family/recent clans", autocomplete: true },
      { type: USER,   name: "user", description: "Discord user (uses their linked clan tag)" },
    ],
  },
  {
    name: "cwl_round",
    description: "CWL summary for the current round",
    options: [
      { type: STRING, name: "tag", description: "Clan tag — type to search Family/recent clans", autocomplete: true },
      { type: USER,   name: "user", description: "Discord user (uses their linked clan tag)" },
    ],
  },
  {
    name: "current_cwl_war",
    description: "Live CWL war detail for the current round",
    options: [
      { type: STRING, name: "tag", description: "Clan tag — type to search Family/recent clans", autocomplete: true },
      { type: USER,   name: "user", description: "Discord user (uses their linked clan tag)" },
    ],
  },
  {
    name: "caller",
    description: "Assign or clear target bases for the current war",
    options: [
      { type: SUB, name: "assign", description: "Set a target for a player in the current war", options: [
        { type: STRING,  name: "player",   description: "Attacker player tag (e.g. #ABC123)", required: true },
        { type: INTEGER, name: "position", description: "Opponent map position (1..teamSize)", required: true },
        { type: STRING,  name: "tag",      description: "Clan tag — type to search Family/recent clans", autocomplete: true },
        { type: USER,    name: "user",     description: "Discord user (uses their linked clan tag)" },
      ]},
      { type: SUB, name: "clear", description: "Clear a player's target in the current war", options: [
        { type: STRING, name: "player", description: "Attacker player tag (e.g. #ABC123)", required: true },
        { type: STRING, name: "tag",    description: "Clan tag — type to search Family/recent clans", autocomplete: true },
        { type: USER,   name: "user",   description: "Discord user (uses their linked clan tag)" },
      ]},
    ],
  },
];

