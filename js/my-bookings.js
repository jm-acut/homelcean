// My Bookings: history with search, date filter, paging, monthly summary, CSV, cancel, reschedule, rate, receipt
document.addEventListener("DOMContentLoaded", async () => {
  const historyList = document.querySelector("#booking-list");
  if (!historyList) return;

  const {
    peso, el, showToast, timeLabel, dateLabel, stars,
    fillTimeSelect, takenSlots, today, STATUS_LABELS
  } = HC;

  const { data: sessionData, error: sessionError } =
    await supabaseClient.auth.getSession();

  if (sessionError || !sessionData.session) {
    window.location.replace("signin.html");
    return;
  }

  const userId = sessionData.session.user.id;
  const message = document.querySelector("#message");
  const statsBox = document.querySelector("#booking-stats");
  const filterSelect = document.querySelector("#status-filter");
  const searchInput = document.querySelector("#search");
  const fromInput = document.querySelector("#from-date");
  const toInput = document.querySelector("#to-date");
  const sortSelect = document.querySelector("#sort-by");
  const moreButton = document.querySelector("#list-more");
  const PAGE = 10;
  let visible = PAGE;

  // Data loaded from Supabase
  let bookings = [];
  let payments = {};
  let ratings = {};

  function displayMessage(text, type = "") {
    message.textContent = text;
    message.className = "message" + (type ? " " + type : "");
    message.hidden = false;
  }

  function totalOf(b) {
    if (b.total != null) return Number(b.total);
    if (payments[b.id]) return Number(payments[b.id].amount);
    return Number(b.services?.price || 0);
  }

  // ---------- Loading ----------
  async function loadData() {
    await supabaseClient.rpc("accept_due_bookings");

    const { data, error } = await supabaseClient
      .from("bookings")
      .select(`
        id, customer_name, phone, address, preferred_date, preferred_time,
        notes, status, created_at, latitude, longitude,
        total, service_price, addons_total, discount, promo_code,
        services ( name, price ),
        cleaners ( name ),
        booking_addons ( name, price )
      `)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1000);

    if (error) throw error;
    bookings = data || [];

    const pay = await supabaseClient
      .from("payments")
      .select("booking_id, reference_no, amount, gcash_number, status, method")
      .eq("user_id", userId)
      .limit(1000);
    payments = {};
    (pay.data || []).forEach((p) => { payments[p.booking_id] = p; });

    const rate = await supabaseClient
      .from("ratings")
      .select("booking_id, rating, comment")
      .eq("user_id", userId)
      .limit(1000);
    ratings = {};
    (rate.data || []).forEach((r) => { ratings[r.booking_id] = r; });
  }

  async function loadNotifications() {
    let box = document.querySelector("#notifications");
    if (!box) {
      box = el("section", undefined, "notifications");
      box.id = "notifications";
      historyList.before(box);
    }

    const { data, error } = await supabaseClient
      .from("notifications")
      .select("id, message, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(5);

    if (error || !data) return;

    box.replaceChildren();
    if (data.length === 0) return;

    box.appendChild(el("h2", "Notifications"));
    data.forEach((n) => {
      box.appendChild(
        el("p", new Date(n.created_at).toLocaleString("en-PH") + " - " + n.message, "notification")
      );
    });
  }

  // ---------- Stats and monthly summary ----------
  function renderStats() {
    const real = bookings.filter((b) => b.status !== "cancelled");
    const spent = Object.values(payments)
      .filter((p) => p.status === "paid")
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const average = real.length
      ? real.reduce((sum, b) => sum + totalOf(b), 0) / real.length
      : 0;

    const items = [
      ["Total bookings", bookings.length],
      ["Upcoming", bookings.filter((b) => b.status === "pending" || b.status === "accepted").length],
      ["Completed", bookings.filter((b) => b.status === "completed").length],
      ["Cancelled", bookings.length - real.length],
      ["Total paid", peso(spent)],
      ["Average order", real.length ? peso(average) : "-"]
    ];

    statsBox.replaceChildren();
    items.forEach(([label, value]) => {
      const box = el("div", undefined, "stat");
      box.append(el("strong", String(value)), el("span", label));
      statsBox.appendChild(box);
    });
  }

  function renderMonthly() {
    const body = document.querySelector("#month-body");
    body.replaceChildren();

    const months = {};
    bookings.forEach((b) => {
      if (b.status === "cancelled") return;
      const key = b.preferred_date.slice(0, 7);
      const m = (months[key] = months[key] || { count: 0, paid: 0 });
      m.count += 1;
      const p = payments[b.id];
      if (p && p.status === "paid") m.paid += Number(p.amount);
    });

    const keys = Object.keys(months).sort().reverse().slice(0, 12);
    if (keys.length === 0) {
      const tr = document.createElement("tr");
      const td = el("td", "No bookings yet.", "muted");
      td.colSpan = 3;
      tr.appendChild(td);
      body.appendChild(tr);
      return;
    }

    keys.forEach((key) => {
      const label = new Date(key + "-01T00:00:00").toLocaleDateString("en-PH", {
        year: "numeric",
        month: "long"
      });
      const tr = document.createElement("tr");
      tr.append(
        el("td", label),
        el("td", String(months[key].count), "num"),
        el("td", peso(months[key].paid), "num")
      );
      body.appendChild(tr);
    });
  }

  // ---------- Actions ----------
  async function cancelBooking(booking, button) {
    if (!confirm("Are you sure you want to cancel this booking?")) return;
    button.disabled = true;

    const { data, error } = await supabaseClient.rpc("cancel_booking", {
      p_booking_id: booking.id
    });

    if (error) {
      displayMessage(error.message, "error");
      button.disabled = false;
      return;
    }
    if (!data) {
      displayMessage(
        "Cancellation time has expired, or this booking is no longer pending.",
        "error"
      );
      button.disabled = false;
      return;
    }

    displayMessage("Booking cancelled successfully.", "success");
    await refresh();
  }

  function openModal(build) {
    const overlay = el("div", undefined, "modal-overlay");
    const box = el("form", undefined, "modal-box");
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });

    build(box, close);
    return close;
  }

  function addCloseButton(box, close) {
    const closeBtn = el("button", "Close", "secondary");
    closeBtn.type = "button";
    closeBtn.addEventListener("click", close);
    box.appendChild(closeBtn);
  }

  // ----- Reschedule -----
  function openRescheduleModal(booking) {
    openModal((box, close) => {
      box.appendChild(el("h2", "Reschedule booking"));
      box.appendChild(el("p", (booking.services?.name || "Cleaning service") +
        " - now " + dateLabel(booking.preferred_date) + " at " + timeLabel(booking.preferred_time)));

      const dateLabelEl = el("label", "New date");
      const dateInput = document.createElement("input");
      dateInput.type = "date";
      dateInput.required = true;
      dateInput.min = today();
      dateInput.value = booking.preferred_date;
      dateLabelEl.appendChild(dateInput);

      const timeLabelEl = el("label", "New time");
      const timeSelect = document.createElement("select");
      timeSelect.required = true;
      timeLabelEl.appendChild(timeSelect);

      const err = el("p", "", "message error");
      err.hidden = true;

      const saveBtn = el("button", "Save new schedule");
      saveBtn.type = "submit";

      async function refreshSlots() {
        const taken = await takenSlots(dateInput.value, booking.id);
        fillTimeSelect(timeSelect, taken, false);
        const current = String(booking.preferred_time).slice(0, 5);
        if (dateInput.value === booking.preferred_date) timeSelect.value = current;
      }

      dateInput.addEventListener("change", refreshSlots);
      refreshSlots();

      box.append(dateLabelEl, timeLabelEl, err, saveBtn);
      addCloseButton(box, close);

      box.addEventListener("submit", async (e) => {
        e.preventDefault();
        err.hidden = true;
        saveBtn.disabled = true;

        const { error } = await supabaseClient.rpc("reschedule_booking", {
          p_booking_id: booking.id,
          p_date: dateInput.value,
          p_time: timeSelect.value
        });

        if (error) {
          err.textContent = error.message;
          err.hidden = false;
          saveBtn.disabled = false;
          return;
        }

        close();
        showToast("Booking rescheduled to " + dateLabel(dateInput.value) +
          " at " + timeLabel(timeSelect.value) + ".");
        await refresh();
      });
    });
  }

  // ----- Rating -----
  function openRatingModal(booking) {
    openModal((box, close) => {
      let rating = 0;

      box.appendChild(el("h2", "Rate your cleaning"));
      box.appendChild(el("p", booking.services?.name || "Cleaning service"));

      const starRow = el("div", undefined, "stars");
      const starButtons = [];
      const hint = el("p", "Tap a star", "muted");

      function paint() {
        starButtons.forEach((b, i) => b.classList.toggle("on", i < rating));
        hint.textContent = rating ? rating + " out of 5" : "Tap a star";
      }

      for (let i = 1; i <= 5; i++) {
        const star = el("button", "★", "star");
        star.type = "button";
        star.setAttribute("aria-label", i + (i === 1 ? " star" : " stars"));
        star.addEventListener("click", () => { rating = i; paint(); });
        starButtons.push(star);
        starRow.appendChild(star);
      }

      const label = el("label", "Comment (optional)");
      const comment = document.createElement("textarea");
      comment.rows = 3;
      comment.maxLength = 500;
      comment.placeholder = "How was the cleaning?";
      label.appendChild(comment);

      const err = el("p", "", "message error");
      err.hidden = true;
      const submitBtn = el("button", "Submit Rating");
      submitBtn.type = "submit";

      box.append(starRow, hint, label, err, submitBtn);
      addCloseButton(box, close);

      box.addEventListener("submit", async (e) => {
        e.preventDefault();
        err.hidden = true;

        if (rating < 1) {
          err.textContent = "Please choose a star rating.";
          err.hidden = false;
          return;
        }

        submitBtn.disabled = true;
        const { error } = await supabaseClient.rpc("rate_booking", {
          p_booking_id: booking.id,
          p_rating: rating,
          p_comment: comment.value.trim()
        });

        if (error) {
          err.textContent = error.message;
          err.hidden = false;
          submitBtn.disabled = false;
          return;
        }

        close();
        showToast("Thank you! You rated this service " + rating + " out of 5 stars.");
        await refresh();
        await loadNotifications();
      });
    });
  }

  // ---------- Filtering ----------
  function filteredBookings() {
    const status = filterSelect.value;
    const q = searchInput.value.trim().toLowerCase();
    const from = fromInput.value;
    const to = toInput.value;

    const list = bookings.filter((b) => {
      if (status !== "all" && b.status !== status) return false;
      if (from && b.preferred_date < from) return false;
      if (to && b.preferred_date > to) return false;
      if (q) {
        const haystack = [
          b.services?.name,
          b.address,
          b.customer_name,
          b.notes,
          b.cleaners?.name,
          payments[b.id] && payments[b.id].reference_no,
          (b.booking_addons || []).map((a) => a.name).join(" ")
        ].filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    const sort = sortSelect.value;
    if (sort === "oldest") list.reverse();
    if (sort === "soonest") {
      list.sort((a, b) =>
        (a.preferred_date + a.preferred_time).localeCompare(b.preferred_date + b.preferred_time));
    }
    return list;
  }

  // ---------- Rendering ----------
  function renderBookings() {
    historyList.replaceChildren();

    if (window.homecleanMap) window.homecleanMap.showBookings(bookings);

    const filtered = filteredBookings();
    const shown = filtered.slice(0, visible);

    document.querySelector("#list-count").textContent =
      "Showing " + shown.length + " of " + filtered.length + " bookings";
    moreButton.hidden = shown.length >= filtered.length;

    if (shown.length === 0) {
      historyList.appendChild(el(
        "p",
        bookings.length === 0
          ? "You have no saved booking requests yet."
          : "No bookings match these filters."
      ));
      return;
    }

    shown.forEach((booking) => {
      const card = el("article", undefined, "booking");

      const head = el("div", undefined, "booking-head");
      head.append(
        el("h3", booking.services?.name || "Cleaning service"),
        el("span", STATUS_LABELS[booking.status] || booking.status, "badge badge-" + booking.status)
      );
      card.appendChild(head);

      card.appendChild(el("p",
        dateLabel(booking.preferred_date) + " at " + timeLabel(booking.preferred_time)));
      card.appendChild(el("p", "Customer: " + booking.customer_name));
      card.appendChild(el("p", "Address: " + booking.address));

      if (booking.latitude != null && booking.longitude != null) {
        const mapLine = el("p");
        const link = el("a", "View location on map");
        link.href =
          "https://www.openstreetmap.org/?mlat=" + booking.latitude +
          "&mlon=" + booking.longitude +
          "#map=17/" + booking.latitude + "/" + booking.longitude;
        link.target = "_blank";
        link.rel = "noopener";
        mapLine.appendChild(link);
        card.appendChild(mapLine);
      }

      const addons = booking.booking_addons || [];
      if (addons.length) {
        card.appendChild(el("p", "Add-ons: " + addons.map((a) => a.name).join(", ")));
      }

      let priceText = "Total: " + peso(totalOf(booking));
      if (Number(booking.discount) > 0) {
        priceText += " (promo " + booking.promo_code + ": -" + peso(booking.discount) + ")";
      }
      card.appendChild(el("p", priceText, "price-line"));

      card.appendChild(el("p",
        "Cleaner: " + (booking.cleaners?.name || "to be assigned")));

      if (booking.notes) card.appendChild(el("p", "Notes: " + booking.notes));

      // Cancel window
      if (booking.status === "pending") {
        const deadline = new Date(booking.created_at).getTime() + 5 * 60 * 1000;
        const remaining = deadline - Date.now();

        if (remaining > 0) {
          const minutes = Math.floor(remaining / 60000);
          const seconds = Math.floor((remaining % 60000) / 1000);
          card.appendChild(el("p",
            "Time left to cancel: " + minutes + "m " + seconds + "s", "booking-countdown"));
        } else {
          card.appendChild(el("p",
            "Cancellation window ended. Waiting for acceptance."));
        }
      }

      // Payment
      const paid = payments[booking.id];
      if (paid) {
        if (paid.method === "cash") {
          if (paid.status === "paid") {
            card.appendChild(el("p",
              "Paid " + peso(paid.amount) + " in cash | Ref: " + paid.reference_no, "paid-badge"));
          } else if (paid.status === "cash_due") {
            card.appendChild(el("p",
              "Payment: " + peso(paid.amount) + " in cash on the service day | Ref: " +
              paid.reference_no, "cash-note"));
          }
        } else if (paid.status === "refunded") {
          card.appendChild(el("p",
            "GCash payment of " + peso(paid.amount) + " was refunded (demo) | Ref: " +
            paid.reference_no, "muted"));
        } else {
          card.appendChild(el("p",
            "Paid " + peso(paid.amount) + " via GCash (" + paid.gcash_number + ") | Ref: " +
            paid.reference_no, "paid-badge"));
        }
      }

      // Rating
      const rated = ratings[booking.id];
      if (rated) {
        card.appendChild(el("p",
          "Your rating: " + stars(rated.rating) + " (" + rated.rating + "/5)" +
          (rated.comment ? " - " + rated.comment : ""), "rating-text"));
      }

      // Buttons
      const actions = el("div", undefined, "booking-actions");

      if (booking.status === "pending" &&
          new Date(booking.created_at).getTime() + 5 * 60 * 1000 > Date.now()) {
        const cancelButton = el("button", "Cancel Request");
        cancelButton.type = "button";
        cancelButton.addEventListener("click", () => cancelBooking(booking, cancelButton));
        actions.appendChild(cancelButton);
      }

      if (booking.status === "pending" || booking.status === "accepted") {
        const resBtn = el("button", "Reschedule", "secondary");
        resBtn.type = "button";
        resBtn.addEventListener("click", () => openRescheduleModal(booking));
        actions.appendChild(resBtn);
      }

      if ((booking.status === "accepted" || booking.status === "completed") && !rated) {
        const rateBtn = el("button",
          booking.status === "completed" ? "Rate this service" : "Job done? Rate this service",
          "rate-btn");
        rateBtn.type = "button";
        rateBtn.addEventListener("click", () => openRatingModal(booking));
        actions.appendChild(rateBtn);
      }

      if (booking.status !== "cancelled") {
        const receipt = el("a", "View receipt", "button secondary");
        receipt.href = "receipt.html?id=" + encodeURIComponent(booking.id);
        actions.appendChild(receipt);
      }

      if (actions.children.length) card.appendChild(actions);
      historyList.appendChild(card);
    });
  }

  async function refresh() {
    await loadData();
    renderStats();
    renderMonthly();
    renderBookings();
  }

  // ---------- CSV download ----------
  function csvCell(value) {
    let text = String(value == null ? "" : value);
    if (/^[=+\-@]/.test(text)) text = "'" + text;   // stop spreadsheet formulas
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function downloadCsv() {
    const rows = [[
      "Booked on", "Service date", "Time", "Service", "Add-ons", "Total",
      "Payment method", "Payment status", "Reference", "Status", "Cleaner", "Address"
    ]];

    filteredBookings().forEach((b) => {
      const p = payments[b.id] || {};
      rows.push([
        new Date(b.created_at).toLocaleDateString("en-PH"),
        b.preferred_date,
        timeLabel(b.preferred_time),
        b.services?.name || "",
        (b.booking_addons || []).map((a) => a.name).join("; "),
        totalOf(b).toFixed(2),
        p.method || "",
        p.status || "",
        p.reference_no || "",
        b.status,
        b.cleaners?.name || "",
        b.address
      ]);
    });

    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "homeclean-bookings.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  // ---------- Controls ----------
  function resetPaging() {
    visible = PAGE;
    renderBookings();
  }

  filterSelect.addEventListener("change", resetPaging);
  searchInput.addEventListener("input", resetPaging);
  fromInput.addEventListener("change", resetPaging);
  toInput.addEventListener("change", resetPaging);
  sortSelect.addEventListener("change", resetPaging);
  moreButton.addEventListener("click", () => { visible += PAGE; renderBookings(); });

  document.querySelector("#clear-filters").addEventListener("click", () => {
    filterSelect.value = "all";
    searchInput.value = "";
    fromInput.value = "";
    toInput.value = "";
    sortSelect.value = "newest";
    resetPaging();
  });

  document.querySelector("#export-csv").addEventListener("click", downloadCsv);
  document.querySelector("#print-history").addEventListener("click", () => window.print());

  // Print every booking that matches the filters, not just the first page
  window.addEventListener("beforeprint", () => { visible = Infinity; renderBookings(); });
  window.addEventListener("afterprint", () => { visible = PAGE; renderBookings(); });

  try {
    await refresh();
    await loadNotifications();

    window.setInterval(() => {
      refresh().catch((error) => console.error("Could not refresh bookings:", error));
    }, 10000);
  } catch (error) {
    displayMessage("Could not load bookings: " + error.message, "error");
  }
});