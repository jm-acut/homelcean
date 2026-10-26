document.addEventListener("DOMContentLoaded", async () => {
  const form = document.querySelector("#booking-form");
  const serviceSelect = document.querySelector("#service_id");
  const message = document.querySelector("#message");
  const historyList = document.querySelector("#booking-list");

  if (!form && !historyList) return;

  const { data: sessionData, error: sessionError } =
    await supabaseClient.auth.getSession();

  if (sessionError || !sessionData.session) {
    window.location.replace("signin.html");
    return;
  }

  const user = sessionData.session.user;
  const userId = user.id;

  function displayMessage(text, type = "") {
    if (!message) return;

    message.textContent = text;
    message.className = "message" + (type ? " " + type : "");
    message.hidden = false;
  }

  function peso(value) {
    return "₱" + Number(value || 0).toLocaleString("en-PH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function showToast(text) {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.setAttribute("role", "status");
    toast.textContent = text;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 8000);
  }

  async function loadServices() {
    if (!serviceSelect) return;

    const { data, error } = await supabaseClient
      .from("services")
      .select("id, name, description, price")
      .eq("active", true)
      .order("name");

    if (error) throw error;

    serviceSelect.replaceChildren();

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose a service";
    serviceSelect.appendChild(placeholder);

    (data || []).forEach((service) => {
      const option = document.createElement("option");
      option.value = service.id;
      option.textContent = service.name + " - " + peso(service.price);
      option.dataset.price = service.price;
      serviceSelect.appendChild(option);
    });
  }

  async function cancelBooking(booking, button) {
    if (!confirm("Are you sure you want to cancel this booking?")) {
      return;
    }

    button.disabled = true;

    try {
      const cutoff = new Date(
        Date.now() - 5 * 60 * 1000
      ).toISOString();

      const { data, error } = await supabaseClient
        .from("bookings")
        .update({ status: "cancelled" })
        .eq("id", booking.id)
        .eq("user_id", userId)
        .eq("status", "pending")
        .gt("created_at", cutoff)
        .select("id");

      if (error) throw error;

      if (!data || data.length === 0) {
        throw new Error(
          "Cancellation time has expired, or this booking is no longer pending."
        );
      }

      displayMessage("Booking cancelled successfully.", "success");
      await loadBookings();
      await loadNotifications();
    } catch (error) {
      displayMessage(error.message, "error");
      button.disabled = false;
    }
  }

  // ---------- GCash payment (demo) ----------
  function openPaymentModal(booking) {
    const price = booking.services?.price ?? 0;

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";

    const box = document.createElement("form");
    box.className = "modal-box";

    const title = document.createElement("h2");
    title.textContent = "Pay with GCash";

    const summary = document.createElement("p");
    summary.textContent =
      (booking.services?.name || "Cleaning service") + " - " + peso(price);

    const label = document.createElement("label");
    label.textContent = "GCash Mobile Number";
    const input = document.createElement("input");
    input.type = "tel";
    input.placeholder = "09171234567";
    input.maxLength = 11;
    input.required = true;
    input.autocomplete = "off";
    label.appendChild(input);

    const err = document.createElement("p");
    err.className = "message error";
    err.hidden = true;

    const payBtn = document.createElement("button");
    payBtn.type = "submit";
    payBtn.className = "gcash-btn";
    payBtn.textContent = "Pay " + peso(price);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "secondary";
    closeBtn.textContent = "Close";

    const demo = document.createElement("p");
    demo.className = "muted";
    demo.textContent =
      "Demo only. No real money is charged. Never enter your real MPIN or OTP.";

    box.append(title, summary, label, err, payBtn, closeBtn, demo);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    input.focus();

    const close = () => overlay.remove();
    closeBtn.addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });

    box.addEventListener("submit", async (e) => {
      e.preventDefault();
      err.hidden = true;

      const number = input.value.trim();
      if (!/^09[0-9]{9}$/.test(number)) {
        err.textContent = "Enter a valid GCash number like 09171234567.";
        err.hidden = false;
        return;
      }

      payBtn.disabled = true;
      payBtn.textContent = "Processing...";

      const { data, error } = await supabaseClient.rpc("pay_with_gcash", {
        p_booking_id: booking.id,
        p_number: number
      });

      if (error) {
        err.textContent = error.message;
        err.hidden = false;
        payBtn.disabled = false;
        payBtn.textContent = "Pay " + peso(price);
        return;
      }

      close();
      showToast(
        "GCash payment of " + peso(data.amount) +
        " sent from " + data.gcash_number +
        ". Ref: " + data.reference_no
      );

      await loadBookings();
      await loadNotifications();
    });
  }

  // ---------- Rating (1 to 5 stars) ----------
  function openRatingModal(booking) {
    let rating = 0;

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";

    const box = document.createElement("form");
    box.className = "modal-box";

    const title = document.createElement("h2");
    title.textContent = "Rate your cleaning";

    const summary = document.createElement("p");
    summary.textContent = booking.services?.name || "Cleaning service";

    const stars = document.createElement("div");
    stars.className = "stars";
    const starButtons = [];

    const hint = document.createElement("p");
    hint.className = "muted";
    hint.textContent = "Tap a star";

    function paint() {
      starButtons.forEach((b, i) => b.classList.toggle("on", i < rating));
      hint.textContent = rating ? rating + " out of 5" : "Tap a star";
    }

    for (let i = 1; i <= 5; i++) {
      const star = document.createElement("button");
      star.type = "button";
      star.className = "star";
      star.textContent = "★";
      star.setAttribute("aria-label", i + (i === 1 ? " star" : " stars"));
      star.addEventListener("click", () => {
        rating = i;
        paint();
      });
      starButtons.push(star);
      stars.appendChild(star);
    }

    const label = document.createElement("label");
    label.textContent = "Comment (optional)";
    const comment = document.createElement("textarea");
    comment.rows = 3;
    comment.maxLength = 500;
    comment.placeholder = "How was the cleaning?";
    label.appendChild(comment);

    const err = document.createElement("p");
    err.className = "message error";
    err.hidden = true;

    const submitBtn = document.createElement("button");
    submitBtn.type = "submit";
    submitBtn.textContent = "Submit Rating";

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "secondary";
    closeBtn.textContent = "Close";

    box.append(title, summary, stars, hint, label, err, submitBtn, closeBtn);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    closeBtn.addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });

    box.addEventListener("submit", async (e) => {
      e.preventDefault();
      err.hidden = true;

      if (rating < 1) {
        err.textContent = "Please choose a star rating.";
        err.hidden = false;
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = "Saving...";

      const { error } = await supabaseClient.rpc("rate_booking", {
        p_booking_id: booking.id,
        p_rating: rating,
        p_comment: comment.value.trim()
      });

      if (error) {
        err.textContent = error.message;
        err.hidden = false;
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit Rating";
        return;
      }

      close();
      showToast("Thank you! You rated this service " + rating + " out of 5 stars.");

      await loadBookings();
      await loadNotifications();
    });
  }

  async function loadNotifications() {
    if (!historyList) return;

    let box = document.querySelector("#notifications");
    if (!box) {
      box = document.createElement("section");
      box.id = "notifications";
      box.className = "notifications";
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

    const heading = document.createElement("h2");
    heading.textContent = "Notifications";
    box.appendChild(heading);

    data.forEach((n) => {
      const p = document.createElement("p");
      p.className = "notification";
      p.textContent =
        new Date(n.created_at).toLocaleString("en-PH") + " - " + n.message;
      box.appendChild(p);
    });
  }

  async function loadBookings() {
    if (!historyList) return;

    // Accept every pending booking whose 5-minute cancel window has ended
    await supabaseClient.rpc("accept_due_bookings");

    const { data, error } = await supabaseClient
      .from("bookings")
      .select(`
        id,
        user_id,
        customer_name,
        phone,
        address,
        preferred_date,
        preferred_time,
        notes,
        status,
        created_at,
        latitude,
        longitude,
        services ( name, price )
      `)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    // Payments for this user, keyed by booking id
    const { data: payRows } = await supabaseClient
      .from("payments")
      .select("booking_id, reference_no, amount, gcash_number, status, method")
      .eq("user_id", userId);

    const payments = {};
    (payRows || []).forEach((p) => {
      payments[p.booking_id] = p;
    });

    // Ratings for this user, keyed by booking id
    const { data: ratingRows } = await supabaseClient
      .from("ratings")
      .select("booking_id, rating, comment")
      .eq("user_id", userId);

    const ratings = {};
    (ratingRows || []).forEach((r) => {
      ratings[r.booking_id] = r;
    });

    historyList.replaceChildren();

    if (window.homecleanMap) window.homecleanMap.showBookings(data || []);

    if (!data || data.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = "You have no saved booking requests yet.";
      historyList.appendChild(empty);
      return;
    }

    data.forEach((booking) => {
      const card = document.createElement("article");
      card.className = "booking";

      const title = document.createElement("h3");
      title.textContent =
        booking.services?.name || "Cleaning service";

      const details = document.createElement("p");
      details.textContent =
        "Customer: " + booking.customer_name +
        " | Date: " + booking.preferred_date +
        " | Time: " + booking.preferred_time;

      const address = document.createElement("p");
      address.textContent = "Address: " + booking.address;

      const status = document.createElement("p");
      const statusLabels = {
        pending: "Pending",
        accepted: "Request accepted",
        cancelled: "Cancelled"
      };
      const rated = ratings[booking.id];
      status.textContent =
        "Status: " +
        (rated && booking.status === "accepted"
          ? "Job completed"
          : statusLabels[booking.status] || booking.status);

      const notes = document.createElement("p");
      notes.textContent = "Notes: " + (booking.notes || "None");

      card.append(title, details, address, status, notes);

      if (booking.latitude != null && booking.longitude != null) {
        const mapLine = document.createElement("p");
        const link = document.createElement("a");
        link.href =
          "https://www.openstreetmap.org/?mlat=" + booking.latitude +
          "&mlon=" + booking.longitude +
          "#map=17/" + booking.latitude + "/" + booking.longitude;
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = "View location on map";
        mapLine.appendChild(link);
        card.appendChild(mapLine);
      }

      if (booking.status === "pending") {
        const createdAt = new Date(booking.created_at).getTime();
        const deadline = createdAt + 5 * 60 * 1000;
        const remaining = deadline - Date.now();

        if (remaining > 0) {
          const countdown = document.createElement("p");
          countdown.className = "booking-countdown";

          const minutes = Math.floor(remaining / 60000);
          const seconds = Math.floor((remaining % 60000) / 1000);

          countdown.textContent =
            "Time left to cancel: " +
            minutes + "m " + seconds + "s";

          const cancelButton = document.createElement("button");
          cancelButton.type = "button";
          cancelButton.textContent = "Cancel Request";

          cancelButton.addEventListener("click", () => {
            cancelBooking(booking, cancelButton);
          });

          card.append(countdown, cancelButton);
        } else {
          const waiting = document.createElement("p");
          waiting.textContent =
            "Cancellation window ended. Waiting for automatic acceptance.";

          card.appendChild(waiting);
        }
      }

      const paid = payments[booking.id];

      if (paid && paid.method === "cash") {
        if (booking.status !== "cancelled") {
          const cashText = document.createElement("p");
          cashText.className = "cash-note";
          cashText.textContent =
            "Payment: " + peso(paid.amount) +
            " in cash on the service day | Ref: " + paid.reference_no;
          card.appendChild(cashText);
        }
      } else if (paid) {
        const paidText = document.createElement("p");

        if (paid.status === "refunded") {
          paidText.className = "muted";
          paidText.textContent =
            "GCash payment of " + peso(paid.amount) +
            " was refunded (demo) | Ref: " + paid.reference_no;
        } else {
          paidText.className = "paid-badge";
          paidText.textContent =
            "Paid " + peso(paid.amount) +
            " via GCash (" + paid.gcash_number + ")" +
            " | Ref: " + paid.reference_no;
        }

        card.appendChild(paidText);
      } else if (booking.status === "accepted") {
        // Older bookings made before payment was added to the form
        const due = document.createElement("p");
        due.textContent =
          "Amount due: " + peso(booking.services?.price);

        const payButton = document.createElement("button");
        payButton.type = "button";
        payButton.className = "gcash-btn";
        payButton.textContent = "Pay with GCash";
        payButton.addEventListener("click", () => {
          openPaymentModal(booking);
        });

        card.append(due, payButton);
      }

      if (booking.status === "accepted") {
        if (rated) {
          const ratedText = document.createElement("p");
          ratedText.className = "rating-text";
          ratedText.textContent =
            "Your rating: " + "★".repeat(rated.rating) +
            "☆".repeat(5 - rated.rating) +
            " (" + rated.rating + "/5)" +
            (rated.comment ? " - " + rated.comment : "");
          card.appendChild(ratedText);
        } else {
          const rateButton = document.createElement("button");
          rateButton.type = "button";
          rateButton.className = "rate-btn";
          rateButton.textContent = "Job done? Rate this service";
          rateButton.addEventListener("click", () => {
            openRatingModal(booking);
          });
          card.appendChild(rateButton);
        }
      }

      historyList.appendChild(card);
    });
  }

  if (form) {
    try {
      await loadServices();
    } catch (error) {
      displayMessage("Could not load services: " + error.message, "error");
    }

    const amountDue = document.querySelector("#amount-due");

    function updateAmountDue() {
      if (!amountDue) return;
      const opt = serviceSelect.selectedOptions[0];
      amountDue.textContent =
        opt && opt.value
          ? "Amount to pay: " + peso(opt.dataset.price)
          : "Choose a service to see the amount.";
    }

    serviceSelect.addEventListener("change", updateAmountDue);

    const gcashFields = document.querySelector("#gcash-fields");
    const gcashInput = form.elements.gcash_number;
    const submitButton = form.querySelector('button[type="submit"]');

    function updatePaymentUI() {
      const isGcash = form.elements.payment_method.value === "gcash";
      if (gcashFields) gcashFields.hidden = !isGcash;
      gcashInput.required = isGcash;
      if (submitButton) {
        submitButton.textContent = isGcash
          ? "Pay with GCash & Book"
          : "Book (Pay Cash Later)";
        submitButton.classList.toggle("gcash-btn", isGcash);
      }
    }

    form
      .querySelectorAll('input[name="payment_method"]')
      .forEach((r) => r.addEventListener("change", updatePaymentUI));

    updatePaymentUI();

    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      const button = form.querySelector('button[type="submit"]');
      if (button) button.disabled = true;

      try {
        const { data: authData, error: authError } =
          await supabaseClient.auth.getUser();

        if (authError || !authData.user) {
          throw new Error("Please sign in again.");
        }

        const customerName = form.elements.customer_name.value.trim();
        const phone = form.elements.phone.value.trim();
        const address = form.elements.address.value.trim();
        const date = form.elements.preferred_date.value;
        const time = form.elements.preferred_time.value;
        const notes = form.elements.notes.value.trim();
        const serviceId = serviceSelect.value;

        if (
          !serviceId ||
          !customerName ||
          !phone ||
          !address ||
          !date ||
          !time
        ) {
          throw new Error("Please complete all required fields.");
        }

        if (!/^09[0-9]{9}$/.test(phone)) {
          throw new Error("Enter a valid Philippine mobile number.");
        }

        const method = form.elements.payment_method.value;
        const gcashNumber = form.elements.gcash_number.value.trim();
        if (method === "gcash" && !/^09[0-9]{9}$/.test(gcashNumber)) {
          throw new Error("Enter a valid GCash number like 09171234567.");
        }

        const lat = parseFloat(form.elements.latitude.value);
        const lng = parseFloat(form.elements.longitude.value);
        if (Number.isNaN(lat) || Number.isNaN(lng)) {
          throw new Error("Please choose your cleaning location on the map.");
        }

        const today = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Manila",
          year: "numeric",
          month: "2-digit",
          day: "2-digit"
        }).format(new Date());

        if (date < today) {
          throw new Error("Choose today or a future date.");
        }

        displayMessage(
          method === "gcash"
            ? "Processing GCash payment and saving booking..."
            : "Saving booking..."
        );

        const { data, error } = await supabaseClient.rpc(
          "create_booking_with_payment",
          {
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
            p_lng: lng
          }
        );

        if (error) throw error;

        form.reset();
        if (window.homecleanMap) window.homecleanMap.clear();
        updateAmountDue();
        updatePaymentUI();

        if (method === "gcash") {
          displayMessage(
            "Booking saved and GCash payment of " + peso(data.amount) +
            " sent from " + data.gcash_number +
            ". Ref: " + data.reference_no +
            ". You have 5 minutes to cancel (cancelling refunds the payment).",
            "success"
          );

          showToast(
            "GCash payment of " + peso(data.amount) +
            " sent from " + data.gcash_number +
            ". Ref: " + data.reference_no
          );
        } else {
          const text =
            "Booking saved. Please pay " + peso(data.amount) +
            " in cash on the service day. You have 5 minutes to cancel.";
          displayMessage(text, "success");
          showToast(text);
        }

        if (historyList) await loadBookings();
      } catch (error) {
        displayMessage(
          "Booking failed: " + error.message,
          "error"
        );
      } finally {
        if (button) button.disabled = false;
      }
    });
  }

  if (historyList) {
    try {
      await loadBookings();
      await loadNotifications();

      window.setInterval(() => {
        loadBookings().catch((error) => {
          console.error("Could not refresh bookings:", error);
        });
      }, 5000);
    } catch (error) {
      displayMessage(
        "Could not load bookings: " + error.message,
        "error"
      );
    }
  }
});