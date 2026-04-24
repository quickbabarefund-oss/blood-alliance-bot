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
      clans: {
        Row: {
          active: boolean
          added_at: string
          badge_url: string | null
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
          last_polled_at?: string | null
          leaderboard_channel_id?: string | null
          leaderboard_message_id?: string | null
          member_count?: number
          name?: string
          tag?: string
        }
        Relationships: []
      }
      discord_config: {
        Row: {
          global_channel_id: string | null
          global_message_id: string | null
          key: string
          updated_at: string
        }
        Insert: {
          global_channel_id?: string | null
          global_message_id?: string | null
          key: string
          updated_at?: string
        }
        Update: {
          global_channel_id?: string | null
          global_message_id?: string | null
          key?: string
          updated_at?: string
        }
        Relationships: []
      }
      donation_snapshots: {
        Row: {
          captured_at: string
          clan_tag: string
          donations: number
          donations_received: number
          id: number
          player_tag: string
        }
        Insert: {
          captured_at?: string
          clan_tag: string
          donations?: number
          donations_received?: number
          id?: number
          player_tag: string
        }
        Update: {
          captured_at?: string
          clan_tag?: string
          donations?: number
          donations_received?: number
          id?: number
          player_tag?: string
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
        Relationships: [
          {
            foreignKeyName: "players_current_clan_tag_fkey"
            columns: ["current_clan_tag"]
            isOneToOne: false
            referencedRelation: "clans"
            referencedColumns: ["tag"]
          },
        ]
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
