// Admin only: one customer's details and full order history (customer.html?id=<user id>)
document.addEventListener("DOMContentLoaded", async () => {
  const { peso, el, timeLabel, dateLabel, stars, STATUS_LABELS } = HC;
  const PAGE = 20;

  const message = document.querySelector("#message");
  const denied = document.querySelector("#denied");
  const content = document.querySelector("#customer-content");
  const statusFilter = document.querySelector("#status-filter");
  const moreButton = document.querySelector("#orders-more");

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

  const { data: me } = await supabaseClient
    .from("profiles")
    .select("role")
    .eq("id", sessionData.session.user.id)
    .maybeSingle();

  if (!me || me.role !== "admin") {
    denied.hidden = false;
    return;
  }

  const id = new URLSearchParams(window.location.search).get("id");
  if (!id) {
    showMessage("No customer was chosen. Open this page from the Users page.", "error");
    return;
  }

  let orders = [];
  let payments = {};
  let ratings = {};
  let visible = PAGE;

  try {
    const users = await supabaseClient.rpc("admin_list_users");
    if (users.error) throw users.error;
    const user = (users.data || []).find((u) => u.user_id === id);
    if (!user) {
      showMessage("Customer not found.", "error");
      return;
    }

    document.querySelector("#customer-name").textContent = user.full_name || "(no name)";
    document.querySelector("#customer-info").textContent =
      user.email + " | " + user.role + " | joined " +
      new Date(user.created_at).toLocaleDateString("en-PH");

    const [b, p, r] = await Promise.all([
      supabaseClient
        .from("bookings")
        .select(`
          id, preferred_date, preferred_time, status, created_at, total,
          services ( name ),
          cleaners ( name )
        `)
        .eq("user_id", id)
        .order("created_at", { ascending: false })
        .limit(1000),
      supabaseClient
        .from("payments")
        .select("booking_id, amount, status, method")
        .eq("user_id", id)
        .limit(1000),
      supabaseClient
        .from("ratings")
        .select("booking_id, rating")
        .eq("user_id", id)
        .limit(1000)
    ]);

    if (b.error) throw b.error;
    orders = b.data || [];
    (p.data || []).forEach((x) => { payments[x.booking_id] = x; });
    (r.data || []).forEach((x) => { ratings[x.booking_id] = x; });
  } catch (error) {
    showMessage("Could not load this customer: " + error.message, "error");
    return;
  }

  content.hidden = false;

  // ---------- Stats ----------
  function day(ts) {
    return new Date(ts).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
  }

  function renderStats() {
    const real = orders.filter((o) => o.status !== "cancelled");
    const spent = Object.values(payments)
      .filter((p) => p.status === "paid")
      .reduce((sum, p) => sum + Number(p.amount), 0);

    const perService = {};
    real.forEach((o) => {
      const name = o.services?.name || "Service";
      perService[name] = (perService[name] || 0) + 1;
    });
    const favorite = Object.entries(perService).sort((a, b) => b[1] - a[1])[0];

    const rated = Object.values(ratings);
    const avgRating = rated.length
      ? (rated.reduce((s, x) => s + x.rating, 0) / rated.length).toFixed(1)
      : "-";

    const items = [
      ["Orders", real.length],
      ["Completed", orders.filter((o) => o.status === "completed").length],
      ["Cancelled", orders.length - real.length],
      ["Total paid", peso(spent)],
      ["Average order", real.length ? peso(real.reduce((s, o) => s + Number(o.total || 0), 0) / real.length) : "-"],
      ["Favorite service", favorite ? favorite[0] + " (" + favorite[1] + ")" : "-"],
      ["First order", orders.length ? day(orders[orders.length - 1].created_at) : "-"],
      ["Last order", orders.length ? day(orders[0].created_at) : "-"],
      ["Ratings given", avgRating === "-" ? "-" : "★ " + avgRating + " (" + rated.length + ")"]
    ];

    const box = document.querySelector("#customer-stats");
    box.replaceChildren();
    items.forEach(([label, value]) => {
      const stat = el("div", undefined, "stat");
      stat.append(el("strong", String(value)), el("span", label));
      box.appendChild(stat);
    });
  }

  // ---------- Orders table ----------
  function td(content, cls) {
    const cell = document.createElement("td");
    if (cls) cell.className = cls;
    if (content instanceof Node) cell.appendChild(content);
    else cell.textContent = content;
    return cell;
  }

  function paymentText(o) {
    const p = payments[o.id];
    if (!p) return "-";
    const how = p.method === "gcash" ? "GCash" : "Cash";
    const state = { paid: "paid", cash_due: "due", refunded: "refunded", cancelled: "cancelled" }[p.status] || p.status;
    return how + " " + state;
  }

  function renderOrders() {
    const body = document.querySelector("#orders-body");
    body.replaceChildren();

    const status = statusFilter.value;
    const filtered = orders.filter((o) => status === "all" || o.status === status);
    const shown = filtered.slice(0, visible);

    if (shown.length === 0) {
      const tr = document.createElement("tr");
      const cell = td("No orders.", "muted");
      cell.colSpan = 9;
      tr.appendChild(cell);
      body.appendChild(tr);
    }

    shown.forEach((o) => {
      const tr = document.createElement("tr");
      const rating = ratings[o.id];

      let receipt = "-";
      if (o.status !== "cancelled") {
        receipt = el("a", "Receipt", "button secondary");
        receipt.href = "receipt.html?id=" + encodeURIComponent(o.id);
      }

      tr.append(
        td(new Date(o.created_at).toLocaleDateString("en-PH")),
        td(dateLabel(o.preferred_date) + " " + timeLabel(o.preferred_time)),
        td(o.services?.name || "-"),
        td(peso(o.total != null ? o.total : (payments[o.id] ? payments[o.id].amount : 0)), "num"),
        td(paymentText(o)),
        td(el("span", STATUS_LABELS[o.status] || o.status, "badge badge-" + o.status)),
        td(o.cleaners?.name || "-"),
        td(rating ? stars(rating.rating) : "-", rating ? "rating-text" : ""),
        td(receipt)
      );
      body.appendChild(tr);
    });

    document.querySelector("#orders-count").textContent =
      "Showing " + shown.length + " of " + filtered.length;
    moreButton.hidden = shown.length >= filtered.length;
  }

  statusFilter.addEventListener("change", () => { visible = PAGE; renderOrders(); });
  moreButton.addEventListener("click", () => { visible += PAGE; renderOrders(); });

  renderStats();
  renderOrders();
});