// Booking form: service, add-ons, promo code, free time slots, payment, map pin
document.addEventListener("DOMContentLoaded", async () => {
  const form = document.querySelector("#booking-form");
  if (!form) return;

  const { peso, el, showToast, fillTimeSelect, takenSlots, today } = HC;

  const { data: sessionData, error: sessionError } =
    await supabaseClient.auth.getSession();

  if (sessionError || !sessionData.session) {
    window.location.replace("signin.html");
    return;
  }

  const serviceSelect = document.querySelector("#service_id");
  const addonsList = document.querySelector("#addons-list");
  const timeSelect = document.querySelector("#preferred_time");
  const dateInput = document.querySelector("#preferred_date");
  const summary = document.querySelector("#price-summary");
  const promoInput = document.querySelector("#promo-code");
  const promoButton = document.querySelector("#apply-promo");
  const promoMessage = document.querySelector("#promo-message");
  const message = document.querySelector("#message");
  const gcashFields = document.querySelector("#gcash-fields");
  const gcashInput = form.elements.gcash_number;
  const submitButton = form.querySelector('button[type="submit"]');

  let appliedCode = "";   // promo code that is currently applied
  let discount = 0;       // discount for that code

  function displayMessage(text, type = "") {
    message.textContent = text;
    message.className = "message" + (type ? " " + type : "");
    message.hidden = false;
  }

  function setPromoMessage(text, type) {
    promoMessage.textContent = text;
    promoMessage.className = type === "error" ? "message error" : "muted";
    promoMessage.hidden = !text;
  }

  // ---------- Services (with average rating) ----------
  async function loadServices() {
    const { data, error } = await supabaseClient
      .from("services")
      .select("id, name, description, price")
      .eq("active", true)
      .order("name");

    if (error) throw error;

    const ratings = {};
    const sums = await supabaseClient.rpc("service_rating_summary");
    (sums.data || []).forEach((r) => {
      ratings[r.svc_id] = r;
    });

    serviceSelect.replaceChildren();
    const placeholder = el("option", "Choose a service");
    placeholder.value = "";
    serviceSelect.appendChild(placeholder);

    (data || []).forEach((service) => {
      const r = ratings[service.id];
      const option = el(
        "option",
        service.name + " - " + peso(service.price) +
          (r ? " (★ " + Number(r.avg_rating).toFixed(1) + ")" : "")
      );
      option.value = service.id;
      option.dataset.price = service.price;
      serviceSelect.appendChild(option);
    });
  }

  // ---------- Add-ons ----------
  async function loadAddons() {
    const { data, error } = await supabaseClient
      .from("addons")
      .select("id, name, price")
      .eq("active", true)
      .order("name");

    addonsList.replaceChildren();

    if (error || !data || data.length === 0) {
      addonsList.appendChild(el("p", "No add-ons available.", "muted"));
      return;
    }

    data.forEach((addon) => {
      const label = el("label", undefined, "radio");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.name = "addon";
      box.value = addon.id;
      box.dataset.price = addon.price;
      box.addEventListener("change", refreshPrice);
      label.append(box, document.createTextNode(" " + addon.name + " (+" + peso(addon.price) + ")"));
      addonsList.appendChild(label);
    });
  }

  function selectedAddons() {
    return Array.from(form.querySelectorAll('input[name="addon"]:checked'));
  }

  function servicePrice() {
    const opt = serviceSelect.selectedOptions[0];
    return opt && opt.value ? Number(opt.dataset.price) : 0;
  }

  function addonsTotal() {
    return selectedAddons().reduce((sum, b) => sum + Number(b.dataset.price), 0);
  }

  // ---------- Price summary and promo ----------
  function renderSummary() {
    summary.replaceChildren();

    if (!serviceSelect.value) {
      summary.appendChild(el("p", "Choose a service to see the price.", "muted"));
      return;
    }

    const line = (label, value, cls) => {
      const row = el("div", undefined, "summary-row" + (cls ? " " + cls : ""));
      row.append(el("span", label), el("span", value));
      summary.appendChild(row);
    };

    line("Service", peso(servicePrice()));
    if (addonsTotal() > 0) line("Add-ons", peso(addonsTotal()));
    if (discount > 0) line("Promo " + appliedCode, "-" + peso(discount), "summary-discount");
    line("Total", peso(Math.max(servicePrice() + addonsTotal() - discount, 0)), "summary-total");
  }

  async function refreshPrice() {
    const subtotal = servicePrice() + addonsTotal();

    if (appliedCode && subtotal > 0) {
      const { data, error } = await supabaseClient.rpc("check_promo", {
        p_code: appliedCode,
        p_subtotal: subtotal
      });
      if (error) {
        setPromoMessage(error.message, "error");
        appliedCode = "";
        discount = 0;
      } else {
        discount = Number(data.discount);
        setPromoMessage("Promo " + data.code + " applied: -" + peso(discount), "ok");
      }
    } else if (!subtotal) {
      discount = 0;
    }

    renderSummary();
  }

  async function applyPromo() {
    const code = promoInput.value.trim().toUpperCase();

    if (!code) {
      appliedCode = "";
      discount = 0;
      setPromoMessage("", "ok");
      renderSummary();
      return;
    }

    if (!serviceSelect.value) {
      setPromoMessage("Choose a service first.", "error");
      return;
    }

    appliedCode = code;
    await refreshPrice();
  }

  promoButton.addEventListener("click", applyPromo);
  promoInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      applyPromo();
    }
  });
  serviceSelect.addEventListener("change", refreshPrice);

  // ---------- Free time slots ----------
  async function refreshSlots() {
    const taken = await takenSlots(dateInput.value);
    fillTimeSelect(timeSelect, taken, true);
  }

  dateInput.min = today();
  dateInput.addEventListener("change", refreshSlots);
  fillTimeSelect(timeSelect, [], false);

  // ---------- Payment choice ----------
  function updatePaymentUI() {
    const isGcash = form.elements.payment_method.value === "gcash";
    gcashFields.hidden = !isGcash;
    gcashInput.required = isGcash;
    submitButton.textContent = isGcash ? "Pay with GCash & Book" : "Book (Pay Cash Later)";
    submitButton.classList.toggle("gcash-btn", isGcash);
  }

  form
    .querySelectorAll('input[name="payment_method"]')
    .forEach((r) => r.addEventListener("change", updatePaymentUI));

  // ---------- Start ----------
  try {
    await loadServices();
  } catch (error) {
    displayMessage("Could not load services: " + error.message, "error");
  }
  await loadAddons();
  updatePaymentUI();
  renderSummary();

  // ---------- Submit ----------
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submitButton.disabled = true;

    try {
      const customerName = form.elements.customer_name.value.trim();
      const phone = form.elements.phone.value.trim();
      const address = form.elements.address.value.trim();
      const date = form.elements.preferred_date.value;
      const time = form.elements.preferred_time.value;
      const notes = form.elements.notes.value.trim();
      const serviceId = serviceSelect.value;
      const method = form.elements.payment_method.value;
      const gcashNumber = gcashInput.value.trim();

      if (!serviceId || !customerName || !phone || !address || !date || !time) {
        throw new Error("Please complete all required fields.");
      }
      if (!/^09[0-9]{9}$/.test(phone)) {
        throw new Error("Enter a valid Philippine mobile number.");
      }
      if (method === "gcash" && !/^09[0-9]{9}$/.test(gcashNumber)) {
        throw new Error("Enter a valid GCash number like 09171234567.");
      }

      const lat = parseFloat(form.elements.latitude.value);
      const lng = parseFloat(form.elements.longitude.value);
      if (Number.isNaN(lat) || Number.isNaN(lng)) {
        throw new Error("Please choose your cleaning location on the map.");
      }
      if (date < today()) {
        throw new Error("Choose today or a future date.");
      }

      displayMessage(
        method === "gcash"
          ? "Processing GCash payment and saving booking..."
          : "Saving booking..."
      );

      const { data, error } = await supabaseClient.rpc("create_booking_with_payment", {
        p_service_id: serviceId,
        p_customer_name: customerName,
        p_phone: phone,
        p_address: address,
        p_date: date,
        p_time: time,
        p_notes: notes,
        p_method: method,
        p_gcash: method === "gcash" ? gcashNumber : "",
        p_lat: lat,
        p_lng: lng,
        p_addon_ids: selectedAddons().map((b) => b.value),
        p_promo: appliedCode
      });

      if (error) throw error;

      form.reset();
      if (window.homecleanMap) window.homecleanMap.clear();
      appliedCode = "";
      discount = 0;
      setPromoMessage("", "ok");
      updatePaymentUI();
      renderSummary();
      await refreshSlots();

      const text =
        method === "gcash"
          ? "Booking saved and GCash payment of " + peso(data.amount) +
            " sent from " + data.gcash_number + ". Ref: " + data.reference_no +
            ". You have 5 minutes to cancel (cancelling refunds the payment)."
          : "Booking saved. Please pay " + peso(data.amount) +
            " in cash on the service day. Ref: " + data.reference_no +
            ". You have 5 minutes to cancel.";

      displayMessage(text, "success");

      const link = el("a", " View receipt");
      link.href = "receipt.html?id=" + encodeURIComponent(data.booking_id);
      message.appendChild(link);

      showToast(
        method === "gcash"
          ? "GCash payment of " + peso(data.amount) + " sent from " +
            data.gcash_number + ". Ref: " + data.reference_no
          : "Booking saved. Pay " + peso(data.amount) + " in cash on the service day."
      );
    } catch (error) {
      displayMessage("Booking failed: " + error.message, "error");
      await refreshSlots();
    } finally {
      submitButton.disabled = false;
    }
  });
});