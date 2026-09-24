CREATE OR REPLACE FUNCTION public.verify_app_user(_username text, _password text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT u.username
  FROM public.app_users u
  WHERE lower(u.username) = lower(_username)
    AND u.password_hash = extensions.crypt(_password, u.password_hash)
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.verify_app_user(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_app_user(text, text) TO service_role;