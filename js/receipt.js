// Printable receipt for one booking: receipt.html?id=<booking id>
document.addEventListener("DOMContentLoaded", async () => {
  const { peso, el, timeLabel, dateLabel, STATUS_LABELS } = HC;

  const message = document.querySelector("#message");
  const receipt = document.querySelector("#receipt");
  const printButton = document.querySelector("#print-button");

  function fail(text) {
    message.textContent = text;
    message.className = "message error no-print";
    message.hidden = false;
  }

  const { data: sessionData } = await supabaseClient.auth.getSession();
  if (!sessionData.session) {
    window.location.replace("signin.html");
    return;
  }

  const id = new URLSearchParams(window.location.search).get("id");
  if (!id) {
    fail("No booking was chosen. Open a receipt from My Bookings.");
    return;
  }

  const { data: booking, error } = await supabaseClient
    .from("bookings")
    .select(`
      id, customer_name, phone, address, preferred_date, preferred_time,
      status, created_at, total, service_price, addons_total, discount, promo_code,
      services ( name, price ),
      cleaners ( name )
    `)
    .eq("id", id)
    .maybeSingle();

  if (error || !booking) {
    fail("Receipt not found.");
    return;
  }

  const pay = await supabaseClient
    .from("payments")
    .select("reference_no, amount, gcash_number, status, method, created_at")
    .eq("booking_id", id)
    .maybeSingle();
  const payment = pay.data;

  const addons = (await supabaseClient
    .from("booking_addons")
    .select("name, price")
    .eq("booking_id", id)).data || [];

  const servicePrice = Number(booking.service_price ?? booking.services?.price ?? 0);
  const addonsSum = addons.reduce((s, a) => s + Number(a.price), 0);
  const discount = Number(booking.discount || 0);
  const total = booking.total != null
    ? Number(booking.total)
    : payment ? Number(payment.amount) : servicePrice + addonsSum - discount;

  const ref = payment ? payment.reference_no : "HC-" + booking.id.slice(0, 8).toUpperCase();
  const set = (sel, text) => { document.querySelector(sel).textContent = text; };

  set("#r-ref", ref);
  set("#r-issued", new Date(payment ? payment.created_at : booking.created_at).toLocaleString("en-PH"));
  set("#r-customer", booking.customer_name);
  set("#r-phone", booking.phone);
  set("#r-when", dateLabel(booking.preferred_date) + " at " + timeLabel(booking.preferred_time));
  set("#r-cleaner", booking.cleaners?.name || "To be assigned");
  set("#r-address", booking.address);
  set("#r-status", STATUS_LABELS[booking.status] || booking.status);

  const lines = document.querySelector("#r-lines");
  const row = (label, amount, cls) => {
    const tr = el("tr", undefined, cls);
    tr.append(el("td", label), el("td", amount, "num"));
    return tr;
  };

  lines.appendChild(row(booking.services?.name || "Cleaning service", peso(servicePrice)));
  addons.forEach((a) => lines.appendChild(row("Add-on: " + a.name, peso(a.price))));
  if (discount > 0) {
    lines.appendChild(row("Promo " + booking.promo_code, "-" + peso(discount)));
  }
  document.querySelector("#r-total").appendChild(row("Total", peso(total), "receipt-total"));

  let paymentText = "No payment recorded";
  if (payment) {
    const how = payment.method === "gcash"
      ? "GCash" + (payment.gcash_number ? " (" + payment.gcash_number + ")" : "")
      : "Cash";
    const state = {
      paid: "paid",
      cash_due: "to be paid in cash on the service day",
      refunded: "refunded",
      cancelled: "cancelled"
    }[payment.status] || payment.status;
    paymentText = how + " - " + state;
  }
  set("#r-payment", paymentText);

  receipt.hidden = false;
  printButton.hidden = false;
  printButton.addEventListener("click", () => window.print());
});