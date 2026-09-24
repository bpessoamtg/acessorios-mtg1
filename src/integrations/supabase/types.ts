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
      admin_notifications: {
        Row: {
          created_at: string
          id: string
          lida: boolean
          message: string
          movimento_id: string | null
          utilizador: string
        }
        Insert: {
          created_at?: string
          id?: string
          lida?: boolean
          message: string
          movimento_id?: string | null
          utilizador: string
        }
        Update: {
          created_at?: string
          id?: string
          lida?: boolean
          message?: string
          movimento_id?: string | null
          utilizador?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_notifications_movimento_id_fkey"
            columns: ["movimento_id"]
            isOneToOne: false
            referencedRelation: "movements"
            referencedColumns: ["id"]
          },
        ]
      }
      app_users: {
        Row: {
          created_at: string
          id: string
          password_hash: string
          username: string
        }
        Insert: {
          created_at?: string
          id?: string
          password_hash: string
          username: string
        }
        Update: {
          created_at?: string
          id?: string
          password_hash?: string
          username?: string
        }
        Relationships: []
      }
      inventory_audit: {
        Row: {
          created_at: string
          id: string
          real_cesta: string
          real_fiada: string
          real_modelo: string
          real_qty: string
          stock_item_id: string | null
          system_cesta: string
          system_fiada: string
          system_modelo: string
          system_qty: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          real_cesta?: string
          real_fiada?: string
          real_modelo?: string
          real_qty?: string
          stock_item_id?: string | null
          system_cesta?: string
          system_fiada?: string
          system_modelo?: string
          system_qty?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          real_cesta?: string
          real_fiada?: string
          real_modelo?: string
          real_qty?: string
          stock_item_id?: string | null
          system_cesta?: string
          system_fiada?: string
          system_modelo?: string
          system_qty?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_audit_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
        ]
      }
      model_sap_lookup: {
        Row: {
          cod_sap: string
          id: string
          modelo: string
        }
        Insert: {
          cod_sap: string
          id?: string
          modelo: string
        }
        Update: {
          cod_sap?: string
          id?: string
          modelo?: string
        }
        Relationships: []
      }
      movements: {
        Row: {
          cesta_destino: string | null
          cesta_origem: string | null
          cod_sap: string | null
          created_at: string
          fiada_destino: string | null
          fiada_origem: string | null
          id: string
          modelo: string
          notas: string | null
          quantidade: number
          tipo: string
          utilizador: string
        }
        Insert: {
          cesta_destino?: string | null
          cesta_origem?: string | null
          cod_sap?: string | null
          created_at?: string
          fiada_destino?: string | null
          fiada_origem?: string | null
          id?: string
          modelo: string
          notas?: string | null
          quantidade: number
          tipo: string
          utilizador: string
        }
        Update: {
          cesta_destino?: string | null
          cesta_origem?: string | null
          cod_sap?: string | null
          created_at?: string
          fiada_destino?: string | null
          fiada_origem?: string | null
          id?: string
          modelo?: string
          notas?: string | null
          quantidade?: number
          tipo?: string
          utilizador?: string
        }
        Relationships: []
      }
      stock_items: {
        Row: {
          cesta: string
          cod_sap: string | null
          created_at: string
          fiada: string | null
          id: string
          modelo: string
          quantidade: number
          updated_at: string
        }
        Insert: {
          cesta: string
          cod_sap?: string | null
          created_at?: string
          fiada?: string | null
          id?: string
          modelo: string
          quantidade?: number
          updated_at?: string
        }
        Update: {
          cesta?: string
          cod_sap?: string | null
          created_at?: string
          fiada?: string | null
          id?: string
          modelo?: string
          quantidade?: number
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      verify_app_user: {
        Args: { _password: string; _username: string }
        Returns: string
      }
    }
    Enums: {
      app_role: "admin" | "inventory" | "operator"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "inventory", "operator"],
    },
  },
} as const
