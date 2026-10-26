// Admin dashboard: all bookings, status, cleaners, ratings, sales, chart
document.addEventListener("DOMContentLoaded", async () => {
  const { peso, el, showToast, timeLabel, dateLabel, stars, STATUS_LABELS } = HC;

  const content = document.querySelector("#admin-content");
  const denied = document.querySelector("#denied");
  const message = document.querySelector("#message");
  const statusFilter = document.querySelector("#status-filter");
  const searchInput = document.querySelector("#search");

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

  const { data: profile } = await supabaseClient
    .from("profiles")
    .select("role")
    .eq("id", sessionData.session.user.id)
    .maybeSingle();

  if (!profile || (profile.role !== "admin" && profile.role !== "staff")) {
    denied.hidden = false;
    return;
  }

  // Admins see everything. Staff see bookings, cleaner assignment and ratings only.
  const isAdmin = profile.role === "admin";
  document.querySelector("#page-title").textContent =
    isAdmin ? "Admin Dashboard" : "Staff Dashboard";
  document.querySelectorAll("[data-admin-only]").forEach((e) => {
    e.hidden = !isAdmin;
  });
  content.hidden = false;

  // ---------- State ----------
  let bookings = [];
  let payments = {};     // by booking id
  let ratings = [];
  let ratingByBooking = {};
  let cleaners = [];
  let addons = [];
  let promos = [];

  async function loadAll() {
    const [b, p, r, c, a, pc] = await Promise.all([
      supabaseClient
        .from("bookings")
        .select(`
          id, user_id, customer_name, phone, preferred_date, preferred_time, status,
          created_at, total, cleaner_id,
          services ( name ),
          cleaners ( name )
        `)
        .order("created_at", { ascending: false })
        .limit(1000),
      supabaseClient
        .from("payments")
        .select("booking_id, method, amount, status, reference_no")
        .limit(1000),
      supabaseClient
        .from("ratings")
        .select("booking_id, rating, comment, created_at, services ( name )")
        .order("created_at", { ascending: false })
        .limit(1000),
      supabaseClient.from("cleaners").select("id, name, active").order("name"),
      supabaseClient.from("addons").select("id, name, price, active").order("name"),
      supabaseClient
        .from("promo_codes")
        .select("code, percent_off, amount_off, active, used_count, max_uses")
        .order("code")
    ]);

    if (b.error) throw b.error;

    bookings = b.data || [];
    payments = {};
    (p.data || []).forEach((x) => { payments[x.booking_id] = x; });
    ratings = r.data || [];
    ratingByBooking = {};
    ratings.forEach((x) => { ratingByBooking[x.booking_id] = x; });
    cleaners = c.data || [];
    addons = a.data || [];
    promos = pc.data || [];
  }

  // ---------- Stats ----------
  function renderStats() {
    const count = (s) => bookings.filter((b) => b.status === s).length;
    const sales = Object.values(payments)
      .filter((p) => p.status === "paid")
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const cashDue = bookings
      .filter((b) => b.status !== "cancelled" && payments[b.id] && payments[b.id].status === "cash_due")
      .reduce((sum, b) => sum + Number(payments[b.id].amount), 0);
    const avg = ratings.length
      ? (ratings.reduce((s, r) => s + r.rating, 0) / ratings.length).toFixed(1)
      : "-";

    const items = [
      ...(isAdmin ? [["Total sales", peso(sales)], ["Cash to collect", peso(cashDue)]] : []),
      ["Bookings", bookings.length],
      ["Pending", count("pending")],
      ["Accepted", count("accepted")],
      ["Completed", count("completed")],
      ["Cancelled", count("cancelled")],
      ["Average rating", avg === "-" ? "-" : "★ " + avg + " (" + ratings.length + ")"]
    ];

    const box = document.querySelector("#admin-stats");
    box.replaceChildren();
    items.forEach(([label, value]) => {
      const stat = el("div", undefined, "stat");
      stat.append(el("strong", String(value)), el("span", label));
      box.appendChild(stat);
    });
  }

  // ---------- Chart: bookings per month ----------
  function renderChart() {
    const key = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    const now = new Date();
    const months = [];

    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        key: key(d),
        label: d.toLocaleString("en-PH", { month: "short" }),
        count: 0,
        sales: 0
      });
    }

    bookings.forEach((b) => {
      if (b.status === "cancelled") return;
      const m = months.find((x) => x.key === key(new Date(b.created_at)));
      if (!m) return;
      m.count += 1;
      const p = payments[b.id];
      if (p && p.status === "paid") m.sales += Number(p.amount);
    });

    const max = Math.max(1, ...months.map((m) => m.count));
    const chart = document.querySelector("#month-chart");
    chart.replaceChildren();

    months.forEach((m) => {
      const col = el("div", undefined, "bar-col");
      const bar = el("div", undefined, "bar");
      bar.style.height = m.count ? Math.max(6, Math.round((m.count / max) * 150)) + "px" : "2px";
      col.append(
        el("span", String(m.count), "bar-value"),
        bar,
        el("span", m.label, "bar-label"),
        el("span", isAdmin ? peso(m.sales) : "", "bar-sales")
      );
      chart.appendChild(col);
    });
  }

  // ---------- Bookings table ----------
  function td(content, cls) {
    const cell = document.createElement("td");
    if (cls) cell.className = cls;
    if (content instanceof Node) cell.appendChild(content);
    else cell.textContent = content;
    return cell;
  }

  // Admins can open the customer's full order history
  function customerCell(b) {
    const text = b.customer_name + " (" + b.phone + ")";
    if (!isAdmin) return text;
    const link = el("a", text);
    link.href = "customer.html?id=" + encodeURIComponent(b.user_id);
    return link;
  }

  function paymentText(b) {
    const p = payments[b.id];
    if (!p) return "-";
    const how = p.method === "gcash" ? "GCash" : "Cash";
    const state = {
      paid: "paid",
      cash_due: "due",
      refunded: "refunded",
      cancelled: "cancelled"
    }[p.status] || p.status;
    return how + " " + state;
  }

  async function runAction(promise, okText) {
    const { error } = await promise;
    if (error) {
      showMessage(error.message, "error");
      return false;
    }
    showMessage("", "");
    if (okText) showToast(okText);
    await reloadAll();
    return true;
  }

  function setStatus(b, status, button) {
    if (status === "cancelled" && !confirm("Cancel this booking? A GCash payment will be refunded.")) {
      return;
    }
    button.disabled = true;
    runAction(
      supabaseClient.rpc("admin_set_booking_status", {
        p_booking_id: b.id,
        p_status: status
      }),
      "Booking marked as " + status + "."
    ).then((ok) => { if (!ok) button.disabled = false; });
  }

  function cleanerSelect(b) {
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Cleaner");

    const none = el("option", "Unassigned");
    none.value = "";
    select.appendChild(none);

    cleaners
      .filter((c) => c.active || c.id === b.cleaner_id)
      .forEach((c) => {
        const o = el("option", c.name + (c.active ? "" : " (inactive)"));
        o.value = c.id;
        select.appendChild(o);
      });

    select.value = b.cleaner_id || "";
    select.disabled = b.status === "cancelled" || b.status === "completed";

    select.addEventListener("change", () => {
      select.disabled = true;
      runAction(
        supabaseClient.rpc("admin_assign_cleaner", {
          p_booking_id: b.id,
          p_cleaner_id: select.value || null
        }),
        "Cleaner updated."
      ).then((ok) => { if (!ok) { select.value = b.cleaner_id || ""; select.disabled = false; } });
    });

    return select;
  }

  function renderTable() {
    const body = document.querySelector("#bookings-body");
    body.replaceChildren();

    const status = statusFilter.value;
    const q = searchInput.value.trim().toLowerCase();

    const shown = bookings.filter((b) => {
      if (status !== "all" && b.status !== status) return false;
      if (!q) return true;
      const p = payments[b.id];
      return [b.customer_name, b.phone, b.services?.name, p && p.reference_no]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });

    if (shown.length === 0) {
      const tr = document.createElement("tr");
      const cell = td("No bookings match.", "muted");
      cell.colSpan = 9;
      tr.appendChild(cell);
      body.appendChild(tr);
      return;
    }

    shown.forEach((b) => {
      const tr = document.createElement("tr");
      const r = ratingByBooking[b.id];

      const actions = el("div", undefined, "row-actions");
      if (b.status === "pending") {
        const accept = el("button", "Accept");
        accept.type = "button";
        accept.addEventListener("click", () => setStatus(b, "accepted", accept));
        actions.appendChild(accept);
      }
      if (b.status === "accepted") {
        const done = el("button", "Mark done");
        done.type = "button";
        done.addEventListener("click", () => setStatus(b, "completed", done));
        actions.appendChild(done);
      }
      if (b.status === "pending" || b.status === "accepted") {
        const cancel = el("button", "Cancel", "danger");
        cancel.type = "button";
        cancel.addEventListener("click", () => setStatus(b, "cancelled", cancel));
        actions.appendChild(cancel);
      }
      if (b.status !== "cancelled") {
        const receipt = el("a", "Receipt", "button secondary");
        receipt.href = "receipt.html?id=" + encodeURIComponent(b.id);
        actions.appendChild(receipt);
      }

      tr.append(
        td(dateLabel(b.preferred_date) + " " + timeLabel(b.preferred_time)),
        td(customerCell(b)),
        td(b.services?.name || "-"),
        td(peso(b.total != null ? b.total : (payments[b.id] ? payments[b.id].amount : 0)), "num"),
        td(paymentText(b)),
        td(el("span", STATUS_LABELS[b.status] || b.status, "badge badge-" + b.status)),
        td(cleanerSelect(b)),
        td(r ? stars(r.rating) : "-", r ? "rating-text" : ""),
        td(actions)
      );
      body.appendChild(tr);
    });
  }

  // ---------- Cleaners, ratings, add-ons, promos ----------
  function renderCleaners() {
    const list = document.querySelector("#cleaner-list");
    list.replaceChildren();
    if (cleaners.length === 0) list.appendChild(el("li", "No cleaners yet.", "muted"));

    cleaners.forEach((c) => {
      const li = el("li");
      const toggle = el("button", c.active ? "Deactivate" : "Activate", "secondary small");
      toggle.type = "button";
      toggle.addEventListener("click", () => {
        toggle.disabled = true;
        runAction(
          supabaseClient.from("cleaners").update({ active: !c.active }).eq("id", c.id)
        ).then((ok) => { if (!ok) toggle.disabled = false; });
      });
      li.append(el("span", c.name + (c.active ? "" : " (inactive)")), toggle);
      list.appendChild(li);
    });
  }

  function renderRatings() {
    const summary = document.querySelector("#rating-summary");
    const list = document.querySelector("#ratings-list");
    summary.replaceChildren();
    list.replaceChildren();

    if (ratings.length === 0) {
      list.appendChild(el("p", "No ratings yet.", "muted"));
      return;
    }

    const perService = {};
    ratings.forEach((r) => {
      const name = r.services?.name || "Service";
      const s = (perService[name] = perService[name] || { sum: 0, n: 0 });
      s.sum += r.rating;
      s.n += 1;
    });
    Object.entries(perService).forEach(([name, s]) => {
      summary.appendChild(el("p", name + ": ★ " + (s.sum / s.n).toFixed(1) + " (" + s.n + ")"));
    });

    const nameOf = {};
    bookings.forEach((b) => { nameOf[b.id] = b.customer_name; });

    ratings.slice(0, 8).forEach((r) => {
      const item = el("div", undefined, "rating-item");
      item.append(
        el("strong", stars(r.rating), "rating-text"),
        el("span", " " + (r.services?.name || "Service") + " - " + (nameOf[r.booking_id] || "Customer")),
        el("p", r.comment || "No comment", "muted")
      );
      list.appendChild(item);
    });
  }

  function renderAddons() {
    const list = document.querySelector("#addon-list");
    list.replaceChildren();
    if (addons.length === 0) list.appendChild(el("li", "No add-ons yet.", "muted"));

    addons.forEach((a) => {
      const li = el("li");
      const toggle = el("button", a.active ? "Hide" : "Show", "secondary small");
      toggle.type = "button";
      toggle.addEventListener("click", () => {
        toggle.disabled = true;
        runAction(
          supabaseClient.from("addons").update({ active: !a.active }).eq("id", a.id)
        ).then((ok) => { if (!ok) toggle.disabled = false; });
      });
      li.append(el("span", a.name + " - " + peso(a.price) + (a.active ? "" : " (hidden)")), toggle);
      list.appendChild(li);
    });
  }

  function renderPromos() {
    const list = document.querySelector("#promo-list");
    list.replaceChildren();
    if (promos.length === 0) list.appendChild(el("li", "No promo codes yet.", "muted"));

    promos.forEach((p) => {
      const li = el("li");
      const value = p.percent_off ? p.percent_off + "% off" : peso(p.amount_off) + " off";
      const uses = p.used_count + (p.max_uses ? "/" + p.max_uses : "") + " used";
      const toggle = el("button", p.active ? "Turn off" : "Turn on", "secondary small");
      toggle.type = "button";
      toggle.addEventListener("click", () => {
        toggle.disabled = true;
        runAction(
          supabaseClient.from("promo_codes").update({ active: !p.active }).eq("code", p.code)
        ).then((ok) => { if (!ok) toggle.disabled = false; });
      });
      li.append(
        el("span", p.code + " - " + value + " (" + uses + ")" + (p.active ? "" : " (off)")),
        toggle
      );
      list.appendChild(li);
    });
  }

  function renderAll() {
    renderStats();
    renderChart();
    renderTable();
    renderCleaners();
    renderRatings();
    renderAddons();
    renderPromos();
  }

  async function reloadAll() {
    await loadAll();
    renderAll();
  }

  // ---------- Forms ----------
  document.querySelector("#cleaner-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const ok = await runAction(
      supabaseClient.from("cleaners").insert({ name: form.elements.name.value.trim() }),
      "Cleaner added."
    );
    if (ok) form.reset();
  });

  document.querySelector("#addon-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const ok = await runAction(
      supabaseClient.from("addons").insert({
        name: form.elements.name.value.trim(),
        price: Number(form.elements.price.value)
      }),
      "Add-on added."
    );
    if (ok) form.reset();
  });

  document.querySelector("#promo-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const row = { code: form.elements.code.value.trim().toUpperCase() };
    const value = Number(form.elements.value.value);

    if (form.elements.kind.value === "percent") {
      if (value < 1 || value > 100) {
        showMessage("A percent discount must be between 1 and 100.", "error");
        return;
      }
      row.percent_off = value;
    } else {
      row.amount_off = value;
    }

    const ok = await runAction(
      supabaseClient.from("promo_codes").insert(row),
      "Promo code added."
    );
    if (ok) form.reset();
  });

  statusFilter.addEventListener("change", renderTable);
  searchInput.addEventListener("input", renderTable);

  try {
    await reloadAll();
  } catch (error) {
    showMessage("Could not load the dashboard: " + error.message, "error");
  }
});