const bookingForm = document.getElementById("bookingForm");
const messageBox = document.getElementById("messageBox");
const servicesContainer = document.getElementById("servicesContainer");
const offersContainer = document.getElementById("offersContainer");

const branchSelect = document.getElementById("branch");
const preferredDateInput = document.getElementById("preferredDate");
const slotSelect = document.getElementById("slotId");
const serviceSelect = document.getElementById("service");

function showMessage(message, isError = false) {
  if (!messageBox) return;

  messageBox.textContent = message;
  messageBox.style.display = "block";
  messageBox.style.background = isError ? "#fdeaea" : "#f5e8ea";
  messageBox.style.color = isError ? "#b42318" : "#9f6270";

  setTimeout(() => {
    messageBox.style.display = "none";
  }, 3500);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadServices() {
  if (!servicesContainer || !serviceSelect) return;

  try {
    const response = await fetch("/api/services");
    const result = await response.json();

    if (!result.success) {
      servicesContainer.innerHTML = `<p>تعذر تحميل الخدمات</p>`;
      return;
    }

    const services = result.data || [];

    if (services.length === 0) {
      servicesContainer.innerHTML = `<p>لا توجد خدمات متاحة حاليًا</p>`;
      return;
    }

    servicesContainer.innerHTML = services.map((service) => `
      <div class="service-card ${Number(service.is_featured) === 1 ? "featured" : ""}">
        <div class="service-top">
          <span class="service-tag">${escapeHtml(service.tag || "خدمة")}</span>
        </div>
        <h3>${escapeHtml(service.name)}</h3>
        <p>${escapeHtml(service.description)}</p>
        <div class="service-price">${escapeHtml(service.price)}</div>
      </div>
    `).join("");

    serviceSelect.innerHTML = `<option value="">اختاري الخدمة</option>` + services.map((service) => {
      return `<option value="${escapeHtml(service.name)}">${escapeHtml(service.name)}</option>`;
    }).join("");
  } catch (error) {
    console.error("loadServices error:", error);
    servicesContainer.innerHTML = `<p>تعذر الاتصال بالسيرفر</p>`;
  }
}

async function loadOffers() {
  if (!offersContainer) return;

  try {
    const response = await fetch("/api/offers");
    const result = await response.json();

    if (!result.success) {
      offersContainer.innerHTML = `<p>تعذر تحميل العروض</p>`;
      return;
    }

    const offers = result.data || [];

    if (offers.length === 0) {
      offersContainer.innerHTML = `<p>لا توجد عروض متاحة حاليًا</p>`;
      return;
    }

    offersContainer.innerHTML = offers.map((offer) => {
      const features = Array.isArray(offer.features) ? offer.features : [];

      return `
        <div class="offer-card ${Number(offer.is_highlighted) === 1 ? "offer-highlight" : ""}">
          <span class="offer-label">${escapeHtml(offer.label || "Offer")}</span>
          <h3>${escapeHtml(offer.title)}</h3>
          <p>${escapeHtml(offer.description)}</p>
          <h4>${escapeHtml(offer.price)}</h4>
          <ul>
            ${features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join("")}
          </ul>
          <a href="#booking" class="btn ${Number(offer.is_highlighted) === 1 ? "btn-primary" : "btn-soft"}">احجزي الآن</a>
        </div>
      `;
    }).join("");
  } catch (error) {
    console.error("loadOffers error:", error);
    offersContainer.innerHTML = `<p>تعذر الاتصال بالسيرفر</p>`;
  }
}

async function loadAvailableSlots() {
  if (!branchSelect || !preferredDateInput || !slotSelect) return;

  const branch = branchSelect.value;
  const date = preferredDateInput.value;

  slotSelect.innerHTML = `<option value="">اختاري الموعد المتاح</option>`;

  if (!branch || !date) return;

  try {
    const response = await fetch(
      `/api/available-slots?branch=${encodeURIComponent(branch)}&date=${encodeURIComponent(date)}`
    );

    const result = await response.json();

    if (!result.success) {
      slotSelect.innerHTML = `<option value="">لا توجد مواعيد متاحة</option>`;
      return;
    }

    const slots = result.data || [];

    if (slots.length === 0) {
      slotSelect.innerHTML = `<option value="">لا توجد مواعيد متاحة</option>`;
      return;
    }

    slots.forEach((slot) => {
      const option = document.createElement("option");
      option.value = slot.id;
      option.textContent = slot.slot_time;
      slotSelect.appendChild(option);
    });
  } catch (error) {
    console.error("loadAvailableSlots error:", error);
    slotSelect.innerHTML = `<option value="">تعذر تحميل المواعيد</option>`;
  }
}

if (branchSelect) {
  branchSelect.addEventListener("change", loadAvailableSlots);
}

if (preferredDateInput) {
  preferredDateInput.addEventListener("change", loadAvailableSlots);
}

if (bookingForm) {
  bookingForm.addEventListener("submit", async function (e) {
    e.preventDefault();

    const payload = {
      fullName: document.getElementById("fullName").value.trim(),
      phone: document.getElementById("phone").value.trim(),
      age: document.getElementById("age").value.trim(),
      branch: document.getElementById("branch").value,
      slotId: document.getElementById("slotId").value,
      service: document.getElementById("service").value,
      bodyArea: document.getElementById("bodyArea").value.trim(),
      sessionType: document.getElementById("sessionType").value,
      contactMethod: document.getElementById("contactMethod").value,
      medicalNotes: document.getElementById("medicalNotes").value.trim()
    };

    try {
      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (result.success) {
        bookingForm.reset();
        slotSelect.innerHTML = `<option value="">اختاري الموعد المتاح</option>`;
        showMessage("تم إرسال طلب الحجز بنجاح ✅ وسيتم التواصل معك على الرقم أو واتساب");
      } else {
        showMessage(result.message || "حدث خطأ أثناء الحجز", true);
      }
    } catch (error) {
      console.error(error);
      showMessage("تعذر الاتصال بالسيرفر", true);
    }
  });
}

window.addEventListener("DOMContentLoaded", async () => {
  await Promise.all([
    loadServices(),
    loadOffers()
  ]);
});