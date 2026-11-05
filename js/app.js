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

  // ---------- Icons and mobile tab bar ----------
  const ICON = {
    home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    plus: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
    list: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    shield: '<path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"/>',
    pin: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    card: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M7 15h3"/>',
    sparkles: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>'
  };

  function icon(name, size) {
    return '<svg viewBox="0 0 24 24" width="' + (size || 22) + '" height="' + (size || 22) +
      '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true">' + (ICON[name] || "") + "</svg>";
  }
  window.HCI = icon;

  function mountIcons() {
    document.querySelectorAll("[data-icon]").forEach((e) => { e.innerHTML = icon(e.dataset.icon, 20); });
  }

  let isIn = false;
  let currentRole = "";

  function renderTabbar() {
    const old = document.getElementById("tabbar");
    if (old) old.remove();
    document.body.classList.toggle("has-tabbar", isIn);
    if (!isIn) return;

    const tabs = [["index.html", "home", "Home"], ["booking.html", "plus", "Book"],
      ["my-bookings.html", "list", "Bookings"], ["profile.html", "user", "Me"]];
    if (currentRole === "admin" || currentRole === "staff") {
      tabs.push(["admin.html", "shield", currentRole === "staff" ? "Staff" : "Admin"]);
    }

    const bar = document.createElement("nav");
    bar.id = "tabbar";
    bar.className = "tabbar";
    tabs.forEach(([href, ic, label]) => {
      const a = document.createElement("a");
      a.href = href;
      a.className = "tab" + (href === page ? " active" : "");
      a.innerHTML = icon(ic, 22) + "<span>" + label + "</span>";
      bar.appendChild(a);
    });
    document.body.appendChild(bar);
  }

  function updateNav(signedIn) {
    document.querySelectorAll('[data-auth-link="in"]').forEach(el => el.hidden = !signedIn);
    document.querySelectorAll('[data-auth-link="out"]').forEach(el => el.hidden = signedIn);
    isIn = signedIn;
    if (!signedIn) setRole("");
    else renderTabbar();
  }

  // Role links: "admin" link is for staff and admins, "admin-only" is for admins
  function setRole(role) {
    currentRole = role;
    renderTabbar();
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
    mountIcons();
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

    document.querySelectorAll("#logout-button, .js-logout").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (c) await c.auth.signOut();
        location.href = "index.html";
      });
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();