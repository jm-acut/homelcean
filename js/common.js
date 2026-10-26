// Shared helpers used by several pages
window.HC = (function () {
  const TIME_SLOTS = [
    ["08:00", "8:00 AM"],
    ["10:00", "10:00 AM"],
    ["13:00", "1:00 PM"],
    ["15:00", "3:00 PM"]
  ];

  function peso(value) {
    return "₱" + Number(value || 0).toLocaleString("en-PH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function el(tag, text, cls) {
    const e = document.createElement(tag);
    if (text !== undefined && text !== null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }

  function showToast(text) {
    const toast = el("div", text, "toast");
    toast.setAttribute("role", "status");
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 8000);
  }

  function timeLabel(t) {
    const key = String(t || "").slice(0, 5);
    const found = TIME_SLOTS.find((s) => s[0] === key);
    return found ? found[1] : key;
  }

  function dateLabel(d) {
    if (!d) return "";
    return new Date(d + "T00:00:00").toLocaleDateString("en-PH", {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  }

  function stars(n) {
    return "★".repeat(n) + "☆".repeat(5 - n);
  }

  function today() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
  }

  const STATUS_LABELS = {
    pending: "Pending",
    accepted: "Request accepted",
    completed: "Job completed",
    cancelled: "Cancelled"
  };

  // Fill a <select> with the time slots; slots in "taken" are disabled
  function fillTimeSelect(select, taken, keepValue) {
    const current = keepValue ? select.value : "";
    select.replaceChildren();
    select.appendChild(el("option", "Choose a time")).value = "";
    TIME_SLOTS.forEach(([value, label]) => {
      const isTaken = taken.includes(value);
      const o = el("option", label + (isTaken ? " (taken)" : ""));
      o.value = value;
      o.disabled = isTaken;
      select.appendChild(o);
    });
    if (current && !taken.includes(current)) select.value = current;
  }

  async function takenSlots(date, excludeId) {
    if (!date) return [];
    const args = { p_date: date };
    if (excludeId) args.p_exclude = excludeId;
    const { data, error } = await supabaseClient.rpc("taken_slots", args);
    return error || !Array.isArray(data) ? [] : data;
  }

  return {
    TIME_SLOTS, STATUS_LABELS, peso, el, showToast,
    timeLabel, dateLabel, stars, today, fillTimeSelect, takenSlots
  };
})();