// Services page: cards from the database with average star ratings, plus add-ons
document.addEventListener("DOMContentLoaded", async () => {
  const { peso, el } = HC;
  const grid = document.querySelector("#service-cards");
  const addonList = document.querySelector("#addons-list");
  if (!grid) return;

  const { data: services, error } = await supabaseClient
    .from("services")
    .select("id, name, description, price")
    .eq("active", true)
    .order("price");

  grid.replaceChildren();

  if (error || !services || services.length === 0) {
    grid.appendChild(el("p", "No services are available right now.", "muted"));
  } else {
    const ratings = {};
    const sums = await supabaseClient.rpc("service_rating_summary");
    (sums.data || []).forEach((r) => { ratings[r.svc_id] = r; });

    services.forEach((service) => {
      const card = el("article", undefined, "card");
      card.appendChild(el("h2", service.name));

      const r = ratings[service.id];
      card.appendChild(el(
        "p",
        r
          ? "★ " + Number(r.avg_rating).toFixed(1) + " (" + r.review_count +
            (Number(r.review_count) === 1 ? " review)" : " reviews)")
          : "No reviews yet",
        r ? "rating-text" : "muted"
      ));

      if (service.description) card.appendChild(el("p", service.description));
      card.appendChild(el("p", "From " + peso(service.price), "price-line"));

      const link = el("a", "Request Service", "button");
      link.href = "booking.html";
      card.appendChild(link);
      grid.appendChild(card);
    });
  }

  if (addonList) {
    const { data: addons } = await supabaseClient
      .from("addons")
      .select("name, price")
      .eq("active", true)
      .order("name");

    (addons || []).forEach((a) => {
      addonList.appendChild(el("li", a.name + " - +" + peso(a.price)));
    });
    if (!addons || addons.length === 0) {
      addonList.appendChild(el("li", "No add-ons yet.", "muted"));
    }
  }
});