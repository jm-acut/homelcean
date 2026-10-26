(function () {
  if (window.__appLoaded) return;
  window.__appLoaded = true;

  const page = location.pathname.split("/").pop() || "index.html";
  const authPages = ["signin.html", "signup.html"];

  // Find the Supabase client no matter what it is named
  function getClient() {
    const candidates = [
      () => window.sb, () => supabaseClient, () => supabaseDb,
      () => db, () => client, () => _supabase, () => supabase
    ];
    for (const get of candidates) {
      try {
        const c = get();
        if (c && c.auth && c.auth.getSession) return c;
      } catch (e) {}
    }
    return null;
  }

  // Backup check: look for the saved login in the browser
  function hasStoredSession() {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (/^sb-.*-auth-token$/.test(k)) {
        try {
          const v = JSON.parse(localStorage.getItem(k));
          if (v && (v.access_token || v.currentSession)) return true;
        } catch (e) {}
      }
    }
    return false;
  }

  function updateNav(signedIn) {
    document.querySelectorAll('[data-auth-link="in"]').forEach(el => el.hidden = !signedIn);
    document.querySelectorAll('[data-auth-link="out"]').forEach(el => el.hidden = signedIn);
    if (!signedIn) setRole("");
  }

  // Role links: "admin" link is for staff and admins, "admin-only" is for admins
  function setRole(role) {
    const staffOrAdmin = role === "admin" || role === "staff";
    document.querySelectorAll('[data-role-link="admin"]').forEach(el => {
      el.hidden = !staffOrAdmin;
      el.textContent = role === "staff" ? "Staff" : "Admin";
    });
    document.querySelectorAll('[data-role-link="admin-only"]').forEach(el => {
      el.hidden = role !== "admin";
    });
  }

  async function checkRole(c, session) {
    if (!session) {
      setRole("");
      return;
    }
    try {
      const { data } = await c
        .from("profiles")
        .select("role")
        .eq("id", session.user.id)
        .maybeSingle();
      setRole(data ? data.role : "");
    } catch (e) {
      setRole("");
    }
  }

  async function init() {
    // Instant update from the saved login (no waiting)
    updateNav(hasStoredSession());

    const c = getClient();
    let signedIn = hasStoredSession();

    if (c) {
      const { data } = await c.auth.getSession();
      signedIn = !!data.session;
      updateNav(signedIn);
      checkRole(c, data.session);

      c.auth.onAuthStateChange((event, s) => {
        updateNav(!!s);
        checkRole(c, s);
        if (event === "SIGNED_IN" && authPages.includes(page)) {
          location.replace("index.html");
        }
      });
    }

    // Signed in but on sign in / sign up page -> go Home
    if (signedIn && authPages.includes(page)) {
      location.replace("index.html");
      return;
    }

    // Private pages need a login
    if (document.body.dataset.private === "true" && !signedIn) {
      location.replace("signin.html");
      return;
    }

    const logout = document.getElementById("logout-button");
    if (logout) {
      logout.addEventListener("click", async () => {
        if (c) await c.auth.signOut();
        location.href = "index.html";
      });
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();