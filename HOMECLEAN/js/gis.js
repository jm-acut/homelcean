// GIS features: location picker, service-area map, bookings map (Leaflet + OpenStreetMap)
(function () {
  // HomeClean demo office (shown on the maps). There is no service-area limit.
  const BASE = { lat: 8.4542, lng: 124.6319 };

  function distanceKm(lat1, lng1, lat2, lng2) {
    const rad = (d) => (d * Math.PI) / 180;
    const a =
      Math.sin(rad(lat2 - lat1) / 2) ** 2 +
      Math.cos(rad(lat1)) * Math.cos(rad(lat2)) *
      Math.sin(rad(lng2 - lng1) / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(a));
  }

  function makeMap(id) {
    const map = L.map(id).setView([BASE.lat, BASE.lng], 11);

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);

    L.marker([BASE.lat, BASE.lng])
      .addTo(map)
      .bindPopup("HomeClean office (demo)");

    return map;
  }

  // ---------- 1. Location picker on booking.html ----------
  let pickerMap = null;
  let pin = null;

  function initPicker() {
    const el = document.getElementById("booking-map");
    const form = document.getElementById("booking-form");
    if (!el || !form || !window.L) return;

    const status = document.getElementById("map-status");
    const locateButton = document.getElementById("locate-me");
    pickerMap = makeMap("booking-map");

    function setPin(lat, lng) {
      const d = distanceKm(lat, lng, BASE.lat, BASE.lng);

      form.elements.latitude.value = lat.toFixed(6);
      form.elements.longitude.value = lng.toFixed(6);

      if (!pin) {
        pin = L.marker([lat, lng], { draggable: true }).addTo(pickerMap);
        pin.on("dragend", () => {
          const p = pin.getLatLng();
          setPin(p.lat, p.lng);
        });
      } else {
        pin.setLatLng([lat, lng]);
      }

      status.textContent =
        "Selected: " + lat.toFixed(5) + ", " + lng.toFixed(5) +
        " (" + d.toFixed(1) + " km from our office)";
      status.className = "muted";
    }

    pickerMap.on("click", (e) => setPin(e.latlng.lat, e.latlng.lng));

    if (locateButton) {
      locateButton.addEventListener("click", () => {
        if (!navigator.geolocation) {
          status.textContent = "Your browser does not support location.";
          return;
        }
        status.textContent = "Finding your location...";
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            setPin(pos.coords.latitude, pos.coords.longitude);
            pickerMap.setView([pos.coords.latitude, pos.coords.longitude], 15);
          },
          () => {
            status.textContent =
              "Could not get your location. Click the map to place the pin instead.";
          }
        );
      });
    }
  }

  function clear() {
    const form = document.getElementById("booking-form");
    const status = document.getElementById("map-status");
    if (pin && pickerMap) {
      pickerMap.removeLayer(pin);
      pin = null;
      pickerMap.setView([BASE.lat, BASE.lng], 11);
    }
    if (form && form.elements.latitude) {
      form.elements.latitude.value = "";
      form.elements.longitude.value = "";
    }
    if (status) {
      status.textContent = "No location selected yet.";
      status.className = "muted";
    }
  }

  // ---------- 2. Office map on services.html ----------
  function initCoverage() {
    const el = document.getElementById("coverage-map");
    if (!el || !window.L) return;
    makeMap("coverage-map");
  }

  // ---------- 3. Map of my bookings on my-bookings.html ----------
  let bookingsMap = null;
  let bookingsLayer = null;
  let fitted = false;
  let lastKey = "";

  function showBookings(list) {
    const el = document.getElementById("bookings-map");
    if (!el || !window.L) return;

    // Skip redrawing when nothing changed (keeps open popups from closing)
    const key = JSON.stringify(
      list.map((b) => [b.id, b.latitude, b.longitude, b.status])
    );
    if (bookingsMap && key === lastKey) return;
    lastKey = key;

    if (!bookingsMap) {
      bookingsMap = makeMap("bookings-map");
      bookingsLayer = L.layerGroup().addTo(bookingsMap);
    }

    bookingsLayer.clearLayers();
    const points = [];

    list.forEach((b) => {
      if (b.latitude == null || b.longitude == null || b.status === "cancelled") return;

      const marker = L.marker([b.latitude, b.longitude]).addTo(bookingsLayer);
      const info = document.createElement("div");
      info.textContent =
        ((b.services && b.services.name) || "Cleaning service") +
        " - " + b.preferred_date;
      marker.bindPopup(info);
      points.push([b.latitude, b.longitude]);
    });

    if (points.length && !fitted) {
      bookingsMap.fitBounds(L.latLngBounds(points).pad(0.3), { maxZoom: 15 });
      fitted = true;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    initPicker();
    initCoverage();
  });

  window.homecleanMap = { clear, showBookings, BASE };
})();