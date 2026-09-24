import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const emailFor = (username: string) => `${username.toLowerCase()}@warehouse.local`;

const roleFor = (username: string) => {
  const normalized = username.toLowerCase();
  if (normalized === "admin") return "admin";
  if (normalized === "inventario") return "inventory";
  return "operator";
};

// Supabase Auth requires >= 6 chars; app passwords are short PINs.
// Derive a deterministic, long internal password instead.
const authPasswordFor = async (username: string, password: string) => {
  const data = new TextEncoder().encode(`${username.toLowerCase()}:${password}:${SERVICE_ROLE_KEY}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => null);
    const username = typeof body?.username === "string" ? body.username.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!username || username.length > 64 || !password || password.length > 128) {
      return json({ error: "Credenciais inválidas" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: verified, error: verifyError } = await admin.rpc("verify_app_user", {
      _username: username,
      _password: password,
    });

    if (verifyError) {
      console.error("verify_app_user failed", verifyError.message);
      return json({ error: "Erro de autenticação" }, 500);
    }
    if (!verified) return json({ error: "Credenciais inválidas" }, 401);

    const canonicalUsername = verified as string;
    const email = emailFor(canonicalUsername);
    const authPassword = await authPasswordFor(canonicalUsername, password);
    const role = roleFor(canonicalUsername);

    // Ensure a matching auth user exists with the current password.
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: authPassword,
      email_confirm: true,
      user_metadata: { username: canonicalUsername },
      app_metadata: { role },
    });

    let authUserId = created?.user?.id;
    if (createError && !created?.user) {
      // Already exists -> sync password so sign-in succeeds.
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const existing = list?.users?.find((u) => u.email === email);
      if (!existing) {
        console.error("auth user provisioning failed", createError.message);
        return json({ error: "Erro de autenticação" }, 500);
      }
      const { error: updateError } = await admin.auth.admin.updateUserById(existing.id, {
        password: authPassword,
        user_metadata: { username: canonicalUsername },
        app_metadata: { ...existing.app_metadata, role },
      });
      if (updateError) {
        console.error("auth user update failed", updateError.message);
        return json({ error: "Erro de autenticação" }, 500);
      }
      authUserId = existing.id;
    }

    if (!authUserId) {
      return json({ error: "Erro de autenticação" }, 500);
    }

    const { error: roleError } = await admin.from("user_roles").upsert(
      { user_id: authUserId, role },
      { onConflict: "user_id,role" },
    );
    if (roleError) {
      console.error("role assignment failed", roleError.message);
      return json({ error: "Erro de autenticação" }, 500);
    }

    const anon = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({ email, password: authPassword });

    if (signInError || !signIn.session) {
      console.error("sign in failed", signInError?.message);
      return json({ error: "Erro de autenticação" }, 500);
    }

    return json({
      username: canonicalUsername,
      access_token: signIn.session.access_token,
      refresh_token: signIn.session.refresh_token,
    });
  } catch (e) {
    console.error("login error", e instanceof Error ? e.message : e);
    return json({ error: "Erro de autenticação" }, 500);
  }
});
