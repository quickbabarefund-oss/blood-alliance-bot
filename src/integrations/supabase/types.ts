export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      blacklist: {
        Row: {
          added_at: string
          added_by: string | null
          player_tag: string
          reason: string | null
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          player_tag: string
          reason?: string | null
        }
        Update: {
          added_at?: string
          added_by?: string | null
          player_tag?: string
          reason?: string | null
        }
        Relationships: []
      }
      clan_member_events: {
        Row: {
          clan_tag: string
          event: string
          id: number
          occurred_at: string
          player_name: string | null
          player_tag: string
        }
        Insert: {
          clan_tag: string
          event: string
          id?: number
          occurred_at?: string
          player_name?: string | null
          player_tag: string
        }
        Update: {
          clan_tag?: string
          event?: string
          id?: number
          occurred_at?: string
          player_name?: string | null
          player_tag?: string
        }
        Relationships: []
      }
      clans: {
        Row: {
          active: boolean
          added_at: string
          badge_url: string | null
          guild_id: string
          last_polled_at: string | null
          leaderboard_channel_id: string | null
          leaderboard_message_id: string | null
          member_count: number
          name: string
          tag: string
        }
        Insert: {
          active?: boolean
          added_at?: string
          badge_url?: string | null
          guild_id: string
          last_polled_at?: string | null
          leaderboard_channel_id?: string | null
          leaderboard_message_id?: string | null
          member_count?: number
          name?: string
          tag: string
        }
        Update: {
          active?: boolean
          added_at?: string
          badge_url?: string | null
          guild_id?: string
          last_polled_at?: string | null
          leaderboard_channel_id?: string | null
          leaderboard_message_id?: string | null
          member_count?: number
          name?: string
          tag?: string
        }
        Relationships: []
      }
      coc_links: {
        Row: {
          player_tag: string
          refreshed_at: string
          user_id: string
        }
        Insert: {
          player_tag: string
          refreshed_at?: string
          user_id: string
        }
        Update: {
          player_tag?: string
          refreshed_at?: string
          user_id?: string
        }
        Relationships: []
      }
      command_permissions: {
        Row: {
          added_at: string
          command: string
          guild_id: string
          role_id: string
        }
        Insert: {
          added_at?: string
          command: string
          guild_id: string
          role_id: string
        }
        Update: {
          added_at?: string
          command?: string
          guild_id?: string
          role_id?: string
        }
        Relationships: []
      }
      discord_config: {
        Row: {
          global_channel_id: string | null
          global_message_id: string | null
          guild_id: string
          key: string
          updated_at: string
        }
        Insert: {
          global_channel_id?: string | null
          global_message_id?: string | null
          guild_id: string
          key: string
          updated_at?: string
        }
        Update: {
          global_channel_id?: string | null
          global_message_id?: string | null
          guild_id?: string
          key?: string
          updated_at?: string
        }
        Relationships: []
      }
      donation_snapshots: {
        Row: {
          attack_wins: number
          captured_at: string
          clan_tag: string
          defense_wins: number
          donations: number
          donations_received: number
          id: number
          player_tag: string
        }
        Insert: {
          attack_wins?: number
          captured_at?: string
          clan_tag: string
          defense_wins?: number
          donations?: number
          donations_received?: number
          id?: number
          player_tag: string
        }
        Update: {
          attack_wins?: number
          captured_at?: string
          clan_tag?: string
          defense_wins?: number
          donations?: number
          donations_received?: number
          id?: number
          player_tag?: string
        }
        Relationships: []
      }
      embed_edit_tokens: {
        Row: {
          created_at: string
          expires_at: string
          guild_id: string
          issued_by: string | null
          token: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          guild_id: string
          issued_by?: string | null
          token: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          guild_id?: string
          issued_by?: string | null
          token?: string
        }
        Relationships: []
      }
      embed_templates: {
        Row: {
          color: number | null
          content: string | null
          description: string | null
          enabled: boolean
          fields: Json
          footer_text: string | null
          guild_id: string
          id: number
          image_url: string | null
          show_timestamp: boolean
          slot: string
          thumbnail_url: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          color?: number | null
          content?: string | null
          description?: string | null
          enabled?: boolean
          fields?: Json
          footer_text?: string | null
          guild_id: string
          id?: number
          image_url?: string | null
          show_timestamp?: boolean
          slot: string
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          color?: number | null
          content?: string | null
          description?: string | null
          enabled?: boolean
          fields?: Json
          footer_text?: string | null
          guild_id?: string
          id?: number
          image_url?: string | null
          show_timestamp?: boolean
          slot?: string
          thumbnail_url?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      family_categories: {
        Row: {
          created_at: string
          guild_id: string
          id: number
          name: string
          position: number
        }
        Insert: {
          created_at?: string
          guild_id: string
          id?: number
          name: string
          position?: number
        }
        Update: {
          created_at?: string
          guild_id?: string
          id?: number
          name?: string
          position?: number
        }
        Relationships: []
      }
      family_clans: {
        Row: {
          added_at: string
          category_id: number
          clan_name: string
          clan_tag: string
          guild_id: string
          id: number
          position: number
        }
        Insert: {
          added_at?: string
          category_id: number
          clan_name?: string
          clan_tag: string
          guild_id: string
          id?: number
          position?: number
        }
        Update: {
          added_at?: string
          category_id?: number
          clan_name?: string
          clan_tag?: string
          guild_id?: string
          id?: number
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "family_clans_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "family_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      family_dashboards: {
        Row: {
          category_emoji: string
          channel_id: string
          clan_line_format: string
          color: number
          description: string | null
          footer_text: string | null
          guild_id: string
          image_url: string | null
          message_id: string | null
          show_timestamp: boolean
          spacing_lines: number
          thumbnail_url: string | null
          title: string
          updated_at: string
        }
        Insert: {
          category_emoji?: string
          channel_id: string
          clan_line_format?: string
          color?: number
          description?: string | null
          footer_text?: string | null
          guild_id: string
          image_url?: string | null
          message_id?: string | null
          show_timestamp?: boolean
          spacing_lines?: number
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
        }
        Update: {
          category_emoji?: string
          channel_id?: string
          clan_line_format?: string
          color?: number
          description?: string | null
          footer_text?: string | null
          guild_id?: string
          image_url?: string | null
          message_id?: string | null
          show_timestamp?: boolean
          spacing_lines?: number
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      guilds: {
        Row: {
          commands_synced_at: string | null
          guild_id: string
          joined_at: string
          name: string | null
        }
        Insert: {
          commands_synced_at?: string | null
          guild_id: string
          joined_at?: string
          name?: string | null
        }
        Update: {
          commands_synced_at?: string | null
          guild_id?: string
          joined_at?: string
          name?: string | null
        }
        Relationships: []
      }
      monthly_aggregates: {
        Row: {
          clan_tag: string
          donations: number
          donations_received: number
          id: number
          month_key: string
          player_name: string
          player_tag: string
          updated_at: string
        }
        Insert: {
          clan_tag: string
          donations?: number
          donations_received?: number
          id?: number
          month_key: string
          player_name?: string
          player_tag: string
          updated_at?: string
        }
        Update: {
          clan_tag?: string
          donations?: number
          donations_received?: number
          id?: number
          month_key?: string
          player_name?: string
          player_tag?: string
          updated_at?: string
        }
        Relationships: []
      }
      player_activity_events: {
        Row: {
          clan_tag: string | null
          id: number
          kind: string
          occurred_at: string
          player_tag: string
        }
        Insert: {
          clan_tag?: string | null
          id?: number
          kind: string
          occurred_at?: string
          player_tag: string
        }
        Update: {
          clan_tag?: string | null
          id?: number
          kind?: string
          occurred_at?: string
          player_tag?: string
        }
        Relationships: []
      }
      players: {
        Row: {
          created_at: string
          current_clan_tag: string | null
          last_seen_at: string
          name: string
          role: string | null
          tag: string
          town_hall: number | null
        }
        Insert: {
          created_at?: string
          current_clan_tag?: string | null
          last_seen_at?: string
          name?: string
          role?: string | null
          tag: string
          town_hall?: number | null
        }
        Update: {
          created_at?: string
          current_clan_tag?: string | null
          last_seen_at?: string
          name?: string
          role?: string | null
          tag?: string
          town_hall?: number | null
        }
        Relationships: []
      }
      poll_runs: {
        Row: {
          clan_tag: string | null
          finished_at: string | null
          id: number
          message: string | null
          started_at: string
          status: string
        }
        Insert: {
          clan_tag?: string | null
          finished_at?: string | null
          id?: number
          message?: string | null
          started_at?: string
          status: string
        }
        Update: {
          clan_tag?: string | null
          finished_at?: string | null
          id?: number
          message?: string | null
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      th_emojis: {
        Row: {
          emoji: string
          th_level: number
          updated_at: string
        }
        Insert: {
          emoji: string
          th_level: number
          updated_at?: string
        }
        Update: {
          emoji?: string
          th_level?: number
          updated_at?: string
        }
        Relationships: []
      }
      war_attacks: {
        Row: {
          attack_order: number
          attacker_map_pos: number | null
          attacker_name: string | null
          attacker_tag: string
          attacker_th: number | null
          defender_map_pos: number | null
          defender_tag: string | null
          destruction: number | null
          recorded_at: string
          stars: number | null
          war_id: number
        }
        Insert: {
          attack_order: number
          attacker_map_pos?: number | null
          attacker_name?: string | null
          attacker_tag: string
          attacker_th?: number | null
          defender_map_pos?: number | null
          defender_tag?: string | null
          destruction?: number | null
          recorded_at?: string
          stars?: number | null
          war_id: number
        }
        Update: {
          attack_order?: number
          attacker_map_pos?: number | null
          attacker_name?: string | null
          attacker_tag?: string
          attacker_th?: number | null
          defender_map_pos?: number | null
          defender_tag?: string | null
          destruction?: number | null
          recorded_at?: string
          stars?: number | null
          war_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "war_attacks_war_id_fkey"
            columns: ["war_id"]
            isOneToOne: false
            referencedRelation: "wars"
            referencedColumns: ["id"]
          },
        ]
      }
      war_reminders: {
        Row: {
          active: boolean
          anchor: string
          clan_tag: string
          created_at: string
          guild_id: string
          id: number
          minutes: number
        }
        Insert: {
          active?: boolean
          anchor: string
          clan_tag: string
          created_at?: string
          guild_id: string
          id?: number
          minutes: number
        }
        Update: {
          active?: boolean
          anchor?: string
          clan_tag?: string
          created_at?: string
          guild_id?: string
          id?: number
          minutes?: number
        }
        Relationships: []
      }
      war_rule_breaks: {
        Row: {
          detail: string | null
          detected_at: string
          id: number
          player_name: string | null
          player_tag: string
          rule: string
          war_id: number
        }
        Insert: {
          detail?: string | null
          detected_at?: string
          id?: number
          player_name?: string | null
          player_tag: string
          rule: string
          war_id: number
        }
        Update: {
          detail?: string | null
          detected_at?: string
          id?: number
          player_name?: string | null
          player_tag?: string
          rule?: string
          war_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "war_rule_breaks_war_id_fkey"
            columns: ["war_id"]
            isOneToOne: false
            referencedRelation: "wars"
            referencedColumns: ["id"]
          },
        ]
      }
      war_track_config: {
        Row: {
          clan_tag: string
          created_at: string
          guild_id: string
          log_channel_id: string | null
          lose_announcement: string | null
          mail_channel_id: string | null
          mail_ping_role_id: string | null
          rep_channel_id: string | null
          rep_role_id: string | null
          updated_at: string
          win_announcement: string | null
        }
        Insert: {
          clan_tag: string
          created_at?: string
          guild_id: string
          log_channel_id?: string | null
          lose_announcement?: string | null
          mail_channel_id?: string | null
          mail_ping_role_id?: string | null
          rep_channel_id?: string | null
          rep_role_id?: string | null
          updated_at?: string
          win_announcement?: string | null
        }
        Update: {
          clan_tag?: string
          created_at?: string
          guild_id?: string
          log_channel_id?: string | null
          lose_announcement?: string | null
          mail_channel_id?: string | null
          mail_ping_role_id?: string | null
          rep_channel_id?: string | null
          rep_role_id?: string | null
          updated_at?: string
          win_announcement?: string | null
        }
        Relationships: []
      }
      wars: {
        Row: {
          clan_badge_url: string | null
          clan_name: string | null
          clan_tag: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision: string | null
          end_time: string | null
          fired_reminders: number[]
          guild_id: string
          id: number
          match_type: string | null
          opp_destruction: number | null
          opp_stars: number | null
          opponent_badge_url: string | null
          opponent_name: string | null
          opponent_tag: string
          our_destruction: number | null
          our_stars: number | null
          raw_roster: Json | null
          rep_message_id: string | null
          result: string | null
          result_message_id: string | null
          result_posted: boolean
          start_time: string | null
          state: string
          team_size: number | null
          updated_at: string
          war_started_msg_sent: boolean
        }
        Insert: {
          clan_badge_url?: string | null
          clan_name?: string | null
          clan_tag: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string | null
          end_time?: string | null
          fired_reminders?: number[]
          guild_id: string
          id?: number
          match_type?: string | null
          opp_destruction?: number | null
          opp_stars?: number | null
          opponent_badge_url?: string | null
          opponent_name?: string | null
          opponent_tag: string
          our_destruction?: number | null
          our_stars?: number | null
          raw_roster?: Json | null
          rep_message_id?: string | null
          result?: string | null
          result_message_id?: string | null
          result_posted?: boolean
          start_time?: string | null
          state: string
          team_size?: number | null
          updated_at?: string
          war_started_msg_sent?: boolean
        }
        Update: {
          clan_badge_url?: string | null
          clan_name?: string | null
          clan_tag?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string | null
          end_time?: string | null
          fired_reminders?: number[]
          guild_id?: string
          id?: number
          match_type?: string | null
          opp_destruction?: number | null
          opp_stars?: number | null
          opponent_badge_url?: string | null
          opponent_name?: string | null
          opponent_tag?: string
          our_destruction?: number | null
          our_stars?: number | null
          raw_roster?: Json | null
          rep_message_id?: string | null
          result?: string | null
          result_message_id?: string | null
          result_posted?: boolean
          start_time?: string | null
          state?: string
          team_size?: number | null
          updated_at?: string
          war_started_msg_sent?: boolean
        }
        Relationships: []
      }
      whitelist: {
        Row: {
          added_at: string
          added_by: string | null
          player_tag: string
          reason: string | null
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          player_tag: string
          reason?: string | null
        }
        Update: {
          added_at?: string
          added_by?: string | null
          player_tag?: string
          reason?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      prune_old_snapshots: { Args: never; Returns: undefined }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
