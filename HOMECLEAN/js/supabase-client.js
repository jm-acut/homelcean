const SUPABASE_URL =
  "https://mspyhzvqfxdvdkluvnjb.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_EYTqxNq6ZJ0dX8FQSpYZOw_g5jdkY4F";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);