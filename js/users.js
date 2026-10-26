// Admin only: see every user and change their role (customer / staff / admin)
document.addEventListener("DOMContentLoaded", async () => {
  const { peso, el, showToast } = HC;
  const PAGE = 20;

  const message = document.querySelector("#message");
  const denied = document.querySelector("#denied");
  const content = document.querySelector("#users-content");
  const roleFilter = document.querySelector("#role-filter");
  const searchInput = document.querySelector("#search");
  const moreButton = document.querySelector("#users-more");

  function showMessage(text, type) {
    message.textContent = text;
    message.className = "message" + (type ? " " + type : "");
    message.hidden = !text;
  }

  const { data: sessionData } = await supabaseClient.auth.getSession();
  if (!sessionData.session) {
    window.location.replace("signin.html");
    return;
  }
  const me = sessionData.session.user.id;

  const { data: profile } = await supabaseClient
    .from("profiles")
    .select("role")
    .eq("id", me)
    .maybeSingle();

  if (!profile || profile.role !== "admin") {
    denied.hidden = false;
    return;
  }
  content.hidden = false;

  let users = [];
  let visible = PAGE;

  async function loadUsers() {
    const { data, error } = await supabaseClient.rpc("admin_list_users");
    if (error) throw error;
    users = data || [];
  }

  function roleLabel(r) {
    return r.charAt(0).toUpperCase() + r.slice(1);
  }

  function renderStats() {
    const count = (r) => users.filter((u) => u.role === r).length;
    const box = document.querySelector("#user-stats");
    box.replaceChildren();
    [
      ["All users", users.length],
      ["Customers", count("customer")],
      ["Staff", count("staff")],
      ["Admins", count("admin")]
    ].forEach(([label, value]) => {
      const stat = el("div", undefined, "stat");
      stat.append(el("strong", String(value)), el("span", label));
      box.appendChild(stat);
    });
  }

  function td(content, cls) {
    const cell = document.createElement("td");
    if (cls) cell.className = cls;
    if (content instanceof Node) cell.appendChild(content);
    else cell.textContent = content;
    return cell;
  }

  function roleSelect(u) {
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Role");

    ["customer", "staff", "admin"].forEach((r) => {
      const o = el("option", roleLabel(r));
      o.value = r;
      select.appendChild(o);
    });
    select.value = u.role;

    if (u.user_id === me) {
      select.disabled = true;
      select.title = "You cannot change your own role";
      return select;
    }

    select.addEventListener("change", async () => {
      const newRole = select.value;
      const who = u.full_name || u.email;

      if (!confirm("Change " + who + " from " + roleLabel(u.role) + " to " + roleLabel(newRole) + "?")) {
        select.value = u.role;
        return;
      }

      select.disabled = true;
      const { error } = await supabaseClient.rpc("admin_set_user_role", {
        p_user_id: u.user_id,
        p_role: newRole
      });

      if (error) {
        showMessage(error.message, "error");
        select.value = u.role;
        select.disabled = false;
        return;
      }

      showMessage("", "");
      showToast(who + " is now " + roleLabel(newRole) + ".");
      await reload();
    });

    return select;
  }

  function renderTable() {
    const body = document.querySelector("#users-body");
    body.replaceChildren();

    const role = roleFilter.value;
    const q = searchInput.value.trim().toLowerCase();

    const filtered = users.filter((u) => {
      if (role !== "all" && u.role !== role) return false;
      if (!q) return true;
      return [u.full_name, u.email].filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
    });

    const shown = filtered.slice(0, visible);

    if (shown.length === 0) {
      const tr = document.createElement("tr");
      const cell = td("No users match.", "muted");
      cell.colSpan = 8;
      tr.appendChild(cell);
      body.appendChild(tr);
    }

    shown.forEach((u) => {
      const tr = document.createElement("tr");

      const details = el("a", "View orders", "button secondary");
      details.href = "customer.html?id=" + encodeURIComponent(u.user_id);

      tr.append(
        td((u.full_name || "(no name)") + (u.user_id === me ? " (you)" : "")),
        td(u.email || "-"),
        td(roleSelect(u)),
        td(String(u.orders), "num"),
        td(peso(u.spent), "num"),
        td(u.last_order ? new Date(u.last_order).toLocaleDateString("en-PH") : "-"),
        td(new Date(u.created_at).toLocaleDateString("en-PH")),
        td(details)
      );
      body.appendChild(tr);
    });

    document.querySelector("#users-count").textContent =
      "Showing " + shown.length + " of " + filtered.length;
    moreButton.hidden = shown.length >= filtered.length;
  }

  async function reload() {
    await loadUsers();
    renderStats();
    renderTable();
  }

  roleFilter.addEventListener("change", () => { visible = PAGE; renderTable(); });
  searchInput.addEventListener("input", () => { visible = PAGE; renderTable(); });
  moreButton.addEventListener("click", () => { visible += PAGE; renderTable(); });

  try {
    await reload();
  } catch (error) {
    showMessage("Could not load users: " + error.message, "error");
  }
});