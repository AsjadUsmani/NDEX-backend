import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!

export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
})

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string; username: string; display_name: string | null;
          avatar_url: string | null; bio: string | null;
          github_username: string | null; plan: 'free'|'pro'|'team';
          created_at: string; updated_at: string;
        }
        Insert: Omit<Database['public']['Tables']['profiles']['Row'], 'created_at'|'updated_at'>
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>
      }
      repositories: {
        Row: {
          id: string; user_id: string; github_url: string; owner: string;
          repo_name: string; description: string | null; stars: number;
          forks: number; language: string | null; is_private: boolean;
          last_analyzed: string | null; created_at: string;
        }
        Insert: Omit<Database['public']['Tables']['repositories']['Row'], 'id'|'created_at'>
        Update: Partial<Database['public']['Tables']['repositories']['Insert']>
      }
      srs_documents: {
        Row: {
          id: string; user_id: string; repo_id: string | null;
          title: string; version: string; content: Record<string, unknown>;
          status: 'draft'|'generating'|'complete'|'error';
          exported_at: string | null; created_at: string; updated_at: string;
        }
        Insert: Omit<Database['public']['Tables']['srs_documents']['Row'], 'id'|'created_at'|'updated_at'>
        Update: Partial<Database['public']['Tables']['srs_documents']['Insert']>
      }
      activity_log: {
        Row: {
          id: string; user_id: string; action: string;
          resource_type: string | null; resource_id: string | null;
          metadata: Record<string, unknown>; ip_address: string | null;
          created_at: string;
        }
        Insert: Omit<Database['public']['Tables']['activity_log']['Row'], 'id'|'created_at'>
        Update: never
      }
      user_preferences: {
        Row: {
          user_id: string; theme: string; sidebar_collapsed: boolean;
          default_branch: string; github_token_hint: string | null;
          notifications: Record<string, boolean>; updated_at: string;
        }
        Insert: Omit<Database['public']['Tables']['user_preferences']['Row'], 'updated_at'>
        Update: Partial<Database['public']['Tables']['user_preferences']['Insert']>
      }
    }
  }
}
