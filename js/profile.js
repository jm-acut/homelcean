// Profile: account details, change name, and a summary of my orders
document.addEventListener("DOMContentLoaded", async () => {
  const { peso, el, timeLabel, dateLabel, STATUS_LABELS } = HC;

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

  // customer -> "Customer", staff -> "Staff", admin -> "Admin"
  document.getElementById("profile-role").textContent =
    profile.role.charAt(0).toUpperCase() + profile.role.slice(1);
  document.getElementById("profile-email").textContent =
    profile.email || session.user.email;
  document.getElementById("profile-created").textContent =
    new Date(profile.created_at).toLocaleDateString("en-PH");
  document.getElementById("profile-form").elements.full_name.value = profile.full_name || "";

  document.getElementById("profile-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const full_name = e.target.elements.full_name.value.trim();
    const { error } = await supabaseClient
      .from("profiles")
      .update({ full_name })
      .eq("id", session.user.id);
    error ? show("Could not save your name.", "error") : show("Name saved.", "success");
  });

  // ---------- My activity ----------
  const [b, p] = await Promise.all([
    supabaseClient
      .from("bookings")
      .select("id, preferred_date, preferred_time, status, created_at, total, services ( name )")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(1000),
    supabaseClient
      .from("payments")
      .select("booking_id, amount, status")
      .eq("user_id", session.user.id)
      .limit(1000)
  ]);

  const orders = b.data || [];
  const payments = {};
  (p.data || []).forEach((x) => { payments[x.booking_id] = x; });

  const real = orders.filter((o) => o.status !== "cancelled");
  const spent = Object.values(payments)
    .filter((x) => x.status === "paid")
    .reduce((sum, x) => sum + Number(x.amount), 0);

  const perService = {};
  real.forEach((o) => {
    const name = o.services?.name || "Service";
    perService[name] = (perService[name] || 0) + 1;
  });
  const favorite = Object.entries(perService).sort((a, c) => c[1] - a[1])[0];

  const thisMonth = new Date().toISOString().slice(0, 7);
  const monthCount = real.filter((o) => o.preferred_date.slice(0, 7) === thisMonth).length;

  const items = [
    ["Orders", real.length],
    ["Completed", orders.filter((o) => o.status === "completed").length],
    ["This month", monthCount],
    ["Total paid", peso(spent)],
    ["Favorite service", favorite ? favorite[0] + " (" + favorite[1] + ")" : "-"],
    ["Last order", orders.length
      ? new Date(orders[0].created_at).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" })
      : "-"]
  ];

  const statsBox = document.getElementById("profile-stats");
  statsBox.replaceChildren();
  items.forEach(([label, value]) => {
    const stat = el("div", undefined, "stat");
    stat.append(el("strong", String(value)), el("span", label));
    statsBox.appendChild(stat);
  });

  const body = document.getElementById("recent-body");
  body.replaceChildren();

  if (orders.length === 0) {
    const tr = document.createElement("tr");
    const td = el("td", "No orders yet.", "muted");
    td.colSpan = 5;
    tr.appendChild(td);
    body.appendChild(tr);
  }

  orders.slice(0, 5).forEach((o) => {
    const tr = document.createElement("tr");

    let receipt = el("span", "-");
    if (o.status !== "cancelled") {
      receipt = el("a", "Receipt", "button secondary");
      receipt.href = "receipt.html?id=" + encodeURIComponent(o.id);
    }

    const total = o.total != null ? o.total : (payments[o.id] ? payments[o.id].amount : 0);
    const cells = [
      el("td", dateLabel(o.preferred_date) + " " + timeLabel(o.preferred_time)),
      el("td", o.services?.name || "-"),
      el("td", peso(total), "num"),
      el("td"),
      el("td")
    ];
    cells[3].appendChild(el("span", STATUS_LABELS[o.status] || o.status, "badge badge-" + o.status));
    cells[4].appendChild(receipt);
    tr.append(...cells);
    body.appendChild(tr);
  });
});