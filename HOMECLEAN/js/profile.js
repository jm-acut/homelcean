document.addEventListener("DOMContentLoaded", async () => {
  const msg = document.getElementById("message");
  const show = (text, type) => {
    msg.textContent = text;
    msg.className = "message " + type;
    msg.hidden = false;
  };

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return; // app.js already redirects to signin.html

  const { data: profile, error } = await supabaseClient
    .from("profiles")
    .select("email, full_name, role, created_at")
    .eq("id", session.user.id)
    .single();

  if (error || !profile) {
    show("Could not load your profile.", "error");
    return;
  }

  // customer -> "Customer", admin -> "Admin"
  document.getElementById("profile-role").textContent =
    profile.role.charAt(0).toUpperCase() + profile.role.slice(1);
  document.getElementById("profile-email").textContent =
    profile.email || session.user.email;
  document.getElementById("profile-created").textContent =
    new Date(profile.created_at).toLocaleDateString();
  document.querySelector('[name="full_name"]').value = profile.full_name || "";

  document.getElementById("profile-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const full_name = e.target.full_name.value.trim();
    const { error } = await supabaseClient
      .from("profiles")
      .update({ full_name })
      .eq("id", session.user.id);
    error ? show("Could not save your name.", "error") : show("Name saved.", "success");
  });
});