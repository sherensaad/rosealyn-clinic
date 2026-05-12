/* ============================================
   ROSALYN Beauty Clinic — script.js
   ============================================ */

const bookingForm = document.getElementById("bookingForm");
const messageBox = document.getElementById("messageBox");
const servicesContainer = document.getElementById("servicesContainer");
const offersContainer = document.getElementById("offersContainer");

const branchSelect = document.getElementById("branch");
const preferredDateInput = document.getElementById("preferredDate");
const slotSelect = document.getElementById("slotId");
const serviceSelect = document.getElementById("service");
const submitBtn = document.getElementById("submitBtn");

/* ===== MOBILE NAVIGATION ===== */

const navToggle = document.getElementById("navToggle");
const navDrawer = document.getElementById("navDrawer");
const navOverlay = document.getElementById("navOverlay");
const navClose = document.getElementById("navClose");

function openDrawer() {
  navDrawer.classList.add("open");
  navToggle.setAttribute("aria-expanded", "true");
  document.body.style.overflow = "hidden";
}

function closeDrawer() {
  navDrawer.classList.remove("open");
  navToggle.setAttribute("aria-expanded", "false");
  document.body.style.overflow = "";
}

if (navToggle)
  navToggle.addEventListener("click", openDrawer);

if (navClose)
  navClose.addEventListener("click", closeDrawer);

if (navOverlay)
  navOverlay.addEventListener("click", closeDrawer);

document.querySelectorAll(".nav-drawer-panel a").forEach(link => {
  link.addEventListener("click", closeDrawer);
});

document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeDrawer();
});

/* ===== HELPERS ===== */

function showMessage(message, isError = false) {

  if (!messageBox) return;

  messageBox.textContent = message;

  messageBox.style.display = "block";

  messageBox.style.background =
    isError ? "#fdeaea" : "#e9f9ef";

  messageBox.style.color =
    isError ? "#b42318" : "#128c4b";

  messageBox.style.padding = "16px";
  messageBox.style.borderRadius = "16px";
  messageBox.style.marginTop = "20px";
  messageBox.style.fontWeight = "bold";
  messageBox.style.textAlign = "center";

  setTimeout(() => {
    messageBox.style.display = "none";
  }, 5000);
}

function escapeHtml(value) {

  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ===== LOAD SERVICES ===== */

async function loadServices() {

  if (!servicesContainer || !serviceSelect) return;

  try {

    const response = await fetch("/api/services");

    const result = await response.json();

    if (!result.success) {

      servicesContainer.innerHTML =
        `<p class="loading-box">تعذر تحميل الخدمات</p>`;

      return;
    }

    const services = result.data || [];

    if (services.length === 0) {

      servicesContainer.innerHTML =
        `<p class="loading-box">لا توجد خدمات متاحة حاليًا</p>`;

      return;
    }

    servicesContainer.innerHTML = services.map(service => `

      <div class="service-card ${Number(service.is_featured) === 1 ? "featured" : ""}">

        <div class="service-top">
          <span class="service-tag">
            ${escapeHtml(service.tag || "خدمة")}
          </span>
        </div>

        <h3>${escapeHtml(service.name)}</h3>

        <p>${escapeHtml(service.description)}</p>

        <div class="service-price">
          ${escapeHtml(service.price)}
        </div>

      </div>

    `).join("");

    serviceSelect.innerHTML =
      `<option value="">اختاري الخدمة</option>` +

      services.map(service => `

        <option value="${escapeHtml(service.name)}">
          ${escapeHtml(service.name)}
        </option>

      `).join("");

  } catch (error) {

    console.error("loadServices error:", error);

    servicesContainer.innerHTML =
      `<p class="loading-box">تعذر الاتصال بالسيرفر</p>`;
  }
}

/* ===== LOAD OFFERS ===== */

async function loadOffers() {

  if (!offersContainer) return;

  try {

    const response = await fetch("/api/offers");

    const result = await response.json();

    if (!result.success) {

      offersContainer.innerHTML =
        `<p class="loading-box">تعذر تحميل العروض</p>`;

      return;
    }

    const offers = result.data || [];

    if (offers.length === 0) {

      offersContainer.innerHTML =
        `<p class="loading-box">لا توجد عروض متاحة حاليًا</p>`;

      return;
    }

    offersContainer.innerHTML = offers.map(offer => {

      const features =
        Array.isArray(offer.features)
          ? offer.features
          : [];

      return `

        <div class="offer-card ${Number(offer.is_highlighted) === 1 ? "offer-highlight" : ""}">

          <span class="offer-label">
            ${escapeHtml(offer.label || "Offer")}
          </span>

          <h3>${escapeHtml(offer.title)}</h3>

          <p>${escapeHtml(offer.description)}</p>

          <h4>${escapeHtml(offer.price)}</h4>

          <ul>
            ${features.map(f => `<li>${escapeHtml(f)}</li>`).join("")}
          </ul>

          <a href="#booking" class="btn ${Number(offer.is_highlighted) === 1 ? "btn-primary" : "btn-soft"}">
            احجزي الآن
          </a>

        </div>

      `;
    }).join("");

  } catch (error) {

    console.error("loadOffers error:", error);

    offersContainer.innerHTML =
      `<p class="loading-box">تعذر الاتصال بالسيرفر</p>`;
  }
}

/* ===== LOAD AVAILABLE SLOTS ===== */

async function loadAvailableSlots() {

  if (!branchSelect || !preferredDateInput || !slotSelect)
    return;

  const branch = branchSelect.value;

  const date = preferredDateInput.value;

  slotSelect.innerHTML =
    `<option value="">اختاري الموعد المتاح</option>`;

  if (!branch || !date) return;

  try {

    const response = await fetch(

      `/api/available-slots?branch=${encodeURIComponent(branch)}&date=${encodeURIComponent(date)}`
    );

    const result = await response.json();

    if (!result.success || (result.data || []).length === 0) {

      slotSelect.innerHTML =
        `<option value="">لا توجد مواعيد متاحة</option>`;

      return;
    }

    slotSelect.innerHTML =
      `<option value="">اختاري الموعد المتاح</option>`;

    (result.data || []).forEach(slot => {

      const option = document.createElement("option");

      option.value = slot.id;

      option.textContent = slot.slot_time;

      slotSelect.appendChild(option);
    });

  } catch (error) {

    console.error("loadAvailableSlots error:", error);

    slotSelect.innerHTML =
      `<option value="">تعذر تحميل المواعيد</option>`;
  }
}

if (branchSelect)
  branchSelect.addEventListener("change", loadAvailableSlots);

if (preferredDateInput)
  preferredDateInput.addEventListener("change", loadAvailableSlots);

/* ===== BOOKING FORM SUBMIT ===== */

if (bookingForm) {

  bookingForm.addEventListener("submit", async function (e) {

    e.preventDefault();

    const selectedDate =
      document.getElementById("preferredDate").value;

    if (!selectedDate || selectedDate.trim() === "") {

      showMessage("من فضلك اختاري اليوم", true);

      return;
    }

    const selectedBranch =
      document.getElementById("branch").value;

    if (!selectedBranch) {

      showMessage("من فضلك اختاري الفرع", true);

      return;
    }

    const selectedService =
      document.getElementById("service").value;

    if (!selectedService) {

      showMessage("من فضلك اختاري الخدمة", true);

      return;
    }

    const selectedSlot =
      document.getElementById("slotId").value;

    if (!selectedSlot) {

      showMessage("من فضلك اختاري موعد متاح", true);

      return;
    }

    if (submitBtn) {

      submitBtn.disabled = true;

      submitBtn.textContent =
        "جارٍ إرسال الحجز...";
    }

    const payload = {

      fullName:
        document.getElementById("fullName").value.trim(),

      phone:
        document.getElementById("phone").value.trim(),

      age:
        document.getElementById("age").value.trim(),

      branch:
        selectedBranch,

      preferredDate:
        selectedDate,

      slotId:
        selectedSlot,

      service:
        selectedService,

      bodyArea:
        document.getElementById("bodyArea").value.trim(),

      sessionType:
        document.getElementById("sessionType").value,

      contactMethod:
        document.getElementById("contactMethod").value,

      medicalNotes:
        document.getElementById("medicalNotes").value.trim()
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

        slotSelect.innerHTML =
          `<option value="">اختاري الموعد المتاح</option>`;

        showMessage(
          "✅ تم إرسال طلب الحجز بنجاح وسيتم التواصل معك لتأكيد المعاد",
          false
        );

      } else {

        showMessage(
          result.message || "حدث خطأ أثناء الحجز",
          true
        );
      }

    } catch (error) {

      console.error(error);

      showMessage(
        "تعذر الاتصال بالسيرفر",
        true
      );

    } finally {

      if (submitBtn) {

        submitBtn.disabled = false;

        submitBtn.textContent =
          "تأكيد الحجز";
      }
    }
  });
}

/* ===== INIT ===== */

window.addEventListener("DOMContentLoaded", async () => {

  await Promise.all([
    loadServices(),
    loadOffers()
  ]);
});
