/* ============================
   ROSALYN ADMIN — admin.js
   Full System v3 (مع Google Sheets + WhatsApp Reminders)
============================ */

// ---- GLOBALS ----
let clients = [];
let finances = [];
let services = [];
let offers = [];
let slots = [];
let currentBranch = '';
let currentAdminUser = '';
let currentReminderTemplate = '';

// ---- WhatsApp Helpers (defined early so all functions can use them) ----
const WA_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0;">
  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
</svg>`;

function buildWhatsAppLink(client, template) {
  const name    = client.full_name || '';
  const service = client.service   || '';
  const area    = client.body_area || '';
  const date    = client.preferred_date ? String(client.preferred_date).slice(0, 10) : '';
  let phone     = (client.phone || '').replace(/\D/g, '');

  if (phone.startsWith('0'))       phone = '2' + phone;
  else if (!phone.startsWith('20')) phone = '20' + phone;

  const msg = (template || currentReminderTemplate || 'السلام عليكم {name} 🌸\nنذكركي بموعد جلستك القادمة في ROSALYN Clinic ✨\nخدمة: {service}\nمنطقة: {area}\n📅 التاريخ: {date}\nبنتشوق نشوفك 💕')
    .replace(/{name}/g,    name)
    .replace(/{service}/g, service)
    .replace(/{area}/g,    area)
    .replace(/{date}/g,    date);

  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}

// ---- UTILS ----
function escapeHtml(v) {
  return String(v || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(d) {
  if (!d) return '-';
  return String(d).slice(0, 10);
}

function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast' + (isError ? ' error' : '');
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = 'toast hide'; }, 3000);
}

function statusBadge(status) {
  const map = {
    'طلب جديد':   'status-new',
    'تم التأكيد': 'status-confirmed',
    'مكتمل':      'status-done',
    'ملغي':       'status-cancelled',
    'غياب':       'status-absent',
  };
  const cls = map[status] || 'status-new';
  return `<span class="status-badge ${cls}">${escapeHtml(status || 'طلب جديد')}</span>`;
}

// ---- TABS ----
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    const target = document.getElementById('tab-' + btn.dataset.tab);
    if (target) target.classList.add('active');

    if (btn.dataset.tab === 'schedule') renderSchedule();
    if (btn.dataset.tab === 'clients') renderClientsDirectory();
    if (btn.dataset.tab === 'overview') renderOverview();
    if (btn.dataset.tab === 'reminders') { loadManualBookings(); }
  });
});

// ---- AUTH ----
const loginPage = document.getElementById('loginPage');
const adminPage = document.getElementById('adminPage');

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('adminUsername').value.trim();
  const password = document.getElementById('adminPassword').value.trim();
  const branch   = document.getElementById('loginBranch').value;
  const msgEl    = document.getElementById('loginMsg');

  if (!branch) { msgEl.style.display='block'; msgEl.textContent='اختاري الفرع'; return; }

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password, branch })
    });
    const result = await res.json();

    if (!result.success) {
      msgEl.style.display = 'block';
      msgEl.textContent = result.message || 'بيانات خاطئة';
      return;
    }

    currentBranch = result.branch || branch;
    currentAdminUser = username;
    loginPage.classList.add('hidden');
    adminPage.classList.remove('hidden');
    document.getElementById('branchBadge').textContent = currentBranch;
    document.getElementById('adminUserLabel').textContent = `أهلاً ${username}`;
    await loadAll();
  } catch (err) {
    msgEl.style.display = 'block';
    msgEl.textContent = 'تعذر الاتصال';
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  try { await fetch('/api/admin/logout', { method: 'POST', credentials: 'include' }); } catch (_) {}
  adminPage.classList.add('hidden');
  loginPage.classList.remove('hidden');
  clients = finances = services = offers = slots = [];
});

// ---- LOAD ALL DATA ----
async function loadAll() {
  await Promise.all([
    fetchBookings(),
    fetchFinances(),
    fetchServices(),
    fetchOffers(),
    fetchSlots()
  ]);
  renderOverview();
}

// ============================================================
// BOOKINGS
// ============================================================
async function fetchBookings() {
  try {
    const res = await fetch('/api/bookings', { credentials: 'include' });
    const r = await res.json();
    if (r.success) { clients = r.data || []; renderClients(); }
  } catch (e) { console.error(e); }
}

function getFilteredClients() {
  const search = (document.getElementById('bookingSearch')?.value || '').toLowerCase();
  const status = document.getElementById('bookingStatusFilter')?.value || '';
  const date   = document.getElementById('bookingDateFilter')?.value || '';

  return clients.filter(c => {
    const matchSearch = !search ||
      (c.full_name || '').toLowerCase().includes(search) ||
      (c.phone || '').includes(search);
    const matchStatus = !status || c.status === status;
    const matchDate   = !date || c.preferred_date === date;
    return matchSearch && matchStatus && matchDate;
  });
}

function renderClients() {
  const tbody = document.getElementById('clientsTableBody');
  if (!tbody) return;
  const data = getFilteredClients();

  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="14" style="color:var(--text-muted);padding:20px;">لا توجد حجوزات</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(c => `
    <tr>
      <td style="font-size:11px; color:var(--text-muted);">${c.id}</td>
      <td style="font-weight:700;">${escapeHtml(c.full_name || '-')}</td>
      <td dir="ltr">${escapeHtml(c.phone || '-')}</td>
      <td>${escapeHtml(c.age || '-')}</td>
      <td>${escapeHtml(c.service || '-')}</td>
      <td>${escapeHtml(c.body_area || '-')}</td>
      <td>${formatDate(c.preferred_date)}</td>
      <td>${escapeHtml(c.preferred_time || '-')}</td>
      <td>${escapeHtml(c.session_type || '-')}</td>
      <td>${escapeHtml(c.contact_method || '-')}</td>
      <td>
        <select onchange="updateStatus(${c.id}, this.value)" style="font-size:12px;">
          ${['طلب جديد','تم التأكيد','مكتمل','غياب','ملغي'].map(s =>
            `<option value="${s}" ${c.status === s ? 'selected' : ''}>${s}</option>`
          ).join('')}
        </select>
      </td>
      <td class="notes-cell" title="${escapeHtml(c.medical_notes || '')}">${escapeHtml(c.medical_notes || '-')}</td>
      <td>
        <a href="${buildWhatsAppLink(c, currentReminderTemplate)}" target="_blank" rel="noopener"
           class="btn btn-success"
           style="display:inline-flex;align-items:center;gap:5px;padding:5px 10px;font-size:12px;text-decoration:none;">
          ${WA_ICON} واتساب
        </a>
      </td>
      <td><button class="btn btn-soft" style="padding:5px 10px; font-size:12px;" onclick="openProfile('${escapeHtml(c.full_name || '')}','${escapeHtml(c.phone || '')}')">ملف</button></td>
      <td><button class="btn btn-danger" style="padding:5px 10px; font-size:12px;" onclick="deleteClient(${c.id})">حذف</button></td>
    </tr>
  `).join('');
}

// Filters
['bookingSearch','bookingStatusFilter','bookingDateFilter'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', renderClients);
  document.getElementById(id)?.addEventListener('change', renderClients);
});

document.getElementById('clearBookingFilters')?.addEventListener('click', () => {
  document.getElementById('bookingSearch').value = '';
  document.getElementById('bookingStatusFilter').value = '';
  document.getElementById('bookingDateFilter').value = '';
  renderClients();
});

async function updateStatus(id, status) {
  try {
    const res = await fetch(`/api/bookings/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ status })
    });
    const r = await res.json();
    if (r.success) { toast('تم تحديث الحالة'); await fetchBookings(); renderOverview(); }
    else toast(r.message || 'فشل', true);
  } catch (e) { toast('خطأ', true); }
}

async function deleteClient(id) {
  if (!confirm('هل أنتِ متأكدة من حذف هذا الحجز؟')) return;
  try {
    const res = await fetch(`/api/bookings/${id}`, { method: 'DELETE', credentials: 'include' });
    const r = await res.json();
    if (r.success) { toast('تم الحذف'); await fetchBookings(); renderOverview(); }
    else toast(r.message || 'فشل', true);
  } catch (e) { toast('خطأ', true); }
}

// ============================================================
// SCHEDULE
// ============================================================
const scheduleDateInput = document.getElementById('scheduleDate');
if (scheduleDateInput) {
  const today = new Date().toISOString().split('T')[0];
  scheduleDateInput.value = today;
  scheduleDateInput.addEventListener('change', renderSchedule);
}

function normalizeTime(v) {
  if (!v) return '';
  const parts = String(v).split(':');
  return `${String(parts[0]).padStart(2,'0')}:${String(parts[1] || '00').padStart(2,'0')}`;
}

function generateTimeSlots() {
  const times = [];
  let t = 9 * 60;
  while (t <= 22 * 60) {
    const h = String(Math.floor(t / 60)).padStart(2, '0');
    const m = String(t % 60).padStart(2, '0');
    times.push(`${h}:${m}`);
    t += 30;
  }
  return times;
}

function renderSchedule() {
  const tbody = document.getElementById('scheduleBody');
  const countEl = document.getElementById('scheduleSlotCount');
  if (!tbody) return;

  const date = scheduleDateInput?.value;
  if (!date) {
    tbody.innerHTML = `<tr><td colspan="8" style="color:var(--text-muted);padding:20px;">اختاري التاريخ</td></tr>`;
    return;
  }

  const timeSlots = generateTimeSlots();
  const dayClients = clients.filter(c => c.preferred_date === date);

  const timeMap = {};
  dayClients.forEach(c => {
    const t = normalizeTime(c.preferred_time);
    if (!timeMap[t]) timeMap[t] = [];
    timeMap[t].push(c);
  });

  const bookedTimes = new Set(dayClients.map(c => normalizeTime(c.preferred_time)));
  const availTimes  = slots.filter(s => s.slot_date === date && !s.is_booked).map(s => normalizeTime(s.slot_time));

  const allTimes = [...new Set([...bookedTimes, ...availTimes].concat(timeSlots))].sort();

  let bookedCount = 0;
  tbody.innerHTML = allTimes.map(time => {
    const bookings = timeMap[time] || [];
    if (bookings.length > 0) {
      bookedCount += bookings.length;
      return bookings.map(b => `
        <tr class="schedule-booked">
          <td style="font-weight:800;">${time}</td>
          <td style="font-weight:700;">${escapeHtml(b.full_name)}</td>
          <td dir="ltr">${escapeHtml(b.phone)}</td>
          <td>${escapeHtml(b.service)}</td>
          <td>${escapeHtml(b.body_area || '-')}</td>
          <td>${escapeHtml(b.session_type || '-')}</td>
          <td>${statusBadge(b.status)}</td>
          <td class="notes-cell" title="${escapeHtml(b.medical_notes || '')}">${escapeHtml(b.medical_notes || '-')}</td>
        </tr>
      `).join('');
    } else if (availTimes.includes(time)) {
      return `
        <tr class="schedule-free">
          <td style="font-weight:800;">${time}</td>
          <td colspan="7" style="color:#4f9e6f; font-size:12px;">متاح</td>
        </tr>
      `;
    }
    return '';
  }).join('');

  if (countEl) countEl.textContent = `${bookedCount} حجز في هذا اليوم`;
}

// ============================================================
// FINANCES
// ============================================================
const totalAmountInput     = document.getElementById('totalAmount');
const paidAmountInput      = document.getElementById('paidAmount');
const remainingAmountInput = document.getElementById('remainingAmount');

function calcRemaining() {
  const total   = Number(totalAmountInput?.value || 0);
  const paid    = Number(paidAmountInput?.value || 0);
  if (remainingAmountInput) remainingAmountInput.value = Math.max(total - paid, 0);
}

totalAmountInput?.addEventListener('input', calcRemaining);
paidAmountInput?.addEventListener('input', calcRemaining);

async function fetchFinances() {
  try {
    const res = await fetch('/api/finances', { credentials: 'include' });
    const r = await res.json();
    if (r.success) { finances = r.data || []; renderFinances(); updateFinanceSummary(); }
  } catch (e) { console.error(e); }
}

function getFilteredFinances() {
  const search = (document.getElementById('financeSearch')?.value || '').toLowerCase();
  const date   = document.getElementById('financeDateFilter')?.value || '';
  return finances.filter(f => {
    const matchSearch = !search ||
      (f.client_name || '').toLowerCase().includes(search) ||
      (f.service_area || '').toLowerCase().includes(search);
    const matchDate = !date || (f.finance_date || '').slice(0, 10) === date;
    return matchSearch && matchDate;
  });
}

function updateFinanceSummary() {
  const data = getFilteredFinances();
  const total     = data.reduce((s, f) => s + Number(f.total_amount || 0), 0);
  const paid      = data.reduce((s, f) => s + Number(f.paid_amount || 0), 0);
  const remaining = data.reduce((s, f) => s + Number(f.remaining_amount || 0), 0);
  const fmt = n => n.toLocaleString('ar-EG');
  document.getElementById('sumTotal').textContent     = fmt(total);
  document.getElementById('sumPaid').textContent      = fmt(paid);
  document.getElementById('sumRemaining').textContent = fmt(remaining);
}

function renderFinances() {
  const tbody = document.getElementById('financeTableBody');
  if (!tbody) return;
  const data = getFilteredFinances();
  updateFinanceSummary();

  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="color:var(--text-muted);padding:20px;">لا توجد حسابات</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(f => `
    <tr>
      <td>${formatDate(f.finance_date)}</td>
      <td style="font-weight:700;">${escapeHtml(f.client_name)}</td>
      <td>${escapeHtml(f.service_area || '-')}</td>
      <td style="color:#e65100; font-weight:700;">${Number(f.total_amount).toLocaleString('ar-EG')}</td>
      <td style="color:#2e7d32; font-weight:700;">${Number(f.paid_amount).toLocaleString('ar-EG')}</td>
      <td style="color:#c62828; font-weight:700;">${Number(f.remaining_amount).toLocaleString('ar-EG')}</td>
      <td><span class="pay-badge">${escapeHtml(f.payment_method || 'كاش')}</span></td>
      <td class="notes-cell" title="${escapeHtml(f.notes || '')}">${escapeHtml(f.notes || '-')}</td>
      <td><button class="btn btn-danger" style="padding:5px 10px; font-size:12px;" onclick="deleteFinance(${f.id})">حذف</button></td>
    </tr>
  `).join('');
}

['financeSearch','financeDateFilter'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', renderFinances);
  document.getElementById(id)?.addEventListener('change', renderFinances);
});

document.getElementById('clearFinanceFilters')?.addEventListener('click', () => {
  document.getElementById('financeSearch').value = '';
  document.getElementById('financeDateFilter').value = '';
  renderFinances();
});

document.getElementById('financeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    financeDate:    document.getElementById('financeDate').value,
    clientName:     document.getElementById('financeClientName').value.trim(),
    serviceArea:    document.getElementById('financeService').value.trim(),
    totalAmount:    document.getElementById('totalAmount').value,
    paidAmount:     document.getElementById('paidAmount').value,
    remainingAmount: document.getElementById('remainingAmount').value,
    paymentMethod:  document.getElementById('paymentMethod').value,
    notes:          document.getElementById('financeNotes').value.trim()
  };
  try {
    const res = await fetch('/api/finances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    });
    const r = await res.json();
    if (r.success) {
      toast('تم حفظ الحساب ✅');
      e.target.reset();
      await fetchFinances();
    } else toast(r.message || 'فشل', true);
  } catch (err) { toast('خطأ', true); }
});

async function deleteFinance(id) {
  if (!confirm('هل أنتِ متأكدة من حذف هذا الحساب؟')) return;
  try {
    const res = await fetch(`/api/finances/${id}`, { method: 'DELETE', credentials: 'include' });
    const r = await res.json();
    if (r.success) { toast('تم الحذف'); await fetchFinances(); }
    else toast(r.message || 'فشل', true);
  } catch (e) { toast('خطأ', true); }
}

// ============================================================
// SLOTS
// ============================================================
async function fetchSlots() {
  try {
    const res = await fetch('/api/admin/slots', { credentials: 'include' });
    const r = await res.json();
    if (r.success) { slots = r.data || []; renderSlots(); }
  } catch (e) { console.error(e); }
}

function getFilteredSlots() {
  const dateF   = document.getElementById('slotDateFilter')?.value || '';
  const statusF = document.getElementById('slotStatusFilter')?.value;
  return slots.filter(s => {
    const matchDate   = !dateF || s.slot_date === dateF;
    const matchStatus = statusF === '' || statusF === undefined ? true : String(s.is_booked) === statusF;
    return matchDate && matchStatus;
  });
}

function renderSlots() {
  const tbody = document.getElementById('slotsTableBody');
  if (!tbody) return;
  const data = getFilteredSlots();

  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:var(--text-muted);padding:20px;">لا توجد مواعيد</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(s => {
    const booked = Number(s.is_booked) === 1;
    const booking = booked && s.booking_id ? clients.find(c => c.id === s.booking_id) : null;
    return `
      <tr>
        <td>${formatDate(s.slot_date)}</td>
        <td style="font-weight:700;">${escapeHtml(s.slot_time)}</td>
        <td>${booked
          ? `<span class="status-badge status-confirmed">محجوز</span>`
          : `<span class="status-badge status-done">متاح</span>`
        }</td>
        <td>${booking ? escapeHtml(booking.full_name) : (booked ? 'محجوز' : '-')}</td>
        <td>${booked
          ? `<span style="color:var(--text-muted); font-size:12px;">-</span>`
          : `<button class="btn btn-danger" style="padding:5px 10px; font-size:12px;" onclick="deleteSlot(${s.id})">حذف</button>`
        }</td>
      </tr>
    `;
  }).join('');
}

['slotDateFilter','slotStatusFilter'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', renderSlots);
  document.getElementById(id)?.addEventListener('input', renderSlots);
});

document.getElementById('slotForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    slotDate: document.getElementById('slotDate').value,
    slotTime: document.getElementById('slotTime').value
  };
  try {
    const res = await fetch('/api/admin/slots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    });
    const r = await res.json();
    if (r.success) { toast('تمت الإضافة ✅'); e.target.reset(); await fetchSlots(); }
    else toast(r.message || 'فشل', true);
  } catch (e) { toast('خطأ', true); }
});

async function deleteSlot(id) {
  if (!confirm('هل أنتِ متأكدة من حذف هذا الموعد؟')) return;
  try {
    const res = await fetch(`/api/admin/slots/${id}`, { method: 'DELETE', credentials: 'include' });
    const r = await res.json();
    if (r.success) { toast('تم الحذف'); await fetchSlots(); }
    else toast(r.message || 'فشل', true);
  } catch (e) { toast('خطأ', true); }
}

// ============================================================
// CLIENT PROFILE MODAL
// ============================================================
const clientModal      = document.getElementById('clientModal');
const closeModalBtn    = document.getElementById('closeClientModal');

closeModalBtn?.addEventListener('click', () => clientModal.classList.add('hidden'));
clientModal?.addEventListener('click', e => { if (e.target === clientModal) clientModal.classList.add('hidden'); });

function openProfile(name, phone) {
  if (!clientModal) return;

  const sessions = clients.filter(c =>
    (c.full_name || '').trim() === name.trim() ||
    (c.phone || '').trim() === phone.trim()
  );

  const clientFinances = finances.filter(f =>
    (f.client_name || '').trim() === name.trim()
  );

  const totalPaid      = clientFinances.reduce((s, f) => s + Number(f.paid_amount || 0), 0);
  const totalRemaining = clientFinances.reduce((s, f) => s + Number(f.remaining_amount || 0), 0);
  const lastVisit      = sessions.reduce((latest, c) => {
    return (!latest || (c.preferred_date || '') > latest) ? (c.preferred_date || '') : latest;
  }, '');

  document.getElementById('clientProfileName').textContent = `ملف العميلة: ${name}`;

  const gridEl = document.getElementById('profileGridCards');
  if (gridEl) {
    gridEl.innerHTML = `
      <div class="profile-box"><div class="box-label">رقم الهاتف</div><div class="box-value" dir="ltr">${escapeHtml(phone)}</div></div>
      <div class="profile-box"><div class="box-label">عدد الجلسات</div><div class="box-value">${sessions.length}</div></div>
      <div class="profile-box"><div class="box-label">إجمالي المدفوع</div><div class="box-value" style="color:var(--green);">${totalPaid.toLocaleString('ar-EG')}</div></div>
      <div class="profile-box"><div class="box-label">إجمالي المتبقي</div><div class="box-value" style="color:var(--red);">${totalRemaining.toLocaleString('ar-EG')}</div></div>
      <div class="profile-box"><div class="box-label">آخر زيارة</div><div class="box-value">${formatDate(lastVisit)}</div></div>
    `;
  }

  const sessBody = document.getElementById('clientSessionsBody');
  if (sessBody) {
    if (sessions.length === 0) {
      sessBody.innerHTML = `<tr><td colspan="7" style="color:var(--text-muted);">لا توجد جلسات</td></tr>`;
    } else {
      sessBody.innerHTML = sessions.map(s => `
        <tr>
          <td>${formatDate(s.preferred_date)}</td>
          <td>${escapeHtml(s.preferred_time || '-')}</td>
          <td>${escapeHtml(s.service || '-')}</td>
          <td>${escapeHtml(s.body_area || '-')}</td>
          <td>${escapeHtml(s.session_type || '-')}</td>
          <td>${statusBadge(s.status)}</td>
          <td class="notes-cell" title="${escapeHtml(s.medical_notes || '')}">${escapeHtml(s.medical_notes || '-')}</td>
        </tr>
      `).join('');
    }
  }

  const finBody = document.getElementById('clientFinanceBody');
  if (finBody) {
    if (clientFinances.length === 0) {
      finBody.innerHTML = `<tr><td colspan="7" style="color:var(--text-muted);">لا توجد حسابات</td></tr>`;
    } else {
      finBody.innerHTML = clientFinances.map(f => `
        <tr>
          <td>${formatDate(f.finance_date)}</td>
          <td>${escapeHtml(f.service_area || '-')}</td>
          <td style="color:#e65100; font-weight:700;">${Number(f.total_amount).toLocaleString('ar-EG')}</td>
          <td style="color:#2e7d32; font-weight:700;">${Number(f.paid_amount).toLocaleString('ar-EG')}</td>
          <td style="color:#c62828; font-weight:700;">${Number(f.remaining_amount).toLocaleString('ar-EG')}</td>
          <td><span class="pay-badge">${escapeHtml(f.payment_method || '-')}</span></td>
          <td class="notes-cell" title="${escapeHtml(f.notes || '')}">${escapeHtml(f.notes || '-')}</td>
        </tr>
      `).join('');
    }
  }

  clientModal.classList.remove('hidden');
}

// ============================================================
// CLIENTS DIRECTORY
// ============================================================
function renderClientsDirectory() {
  const tbody = document.getElementById('clientsDirectoryBody');
  if (!tbody) return;

  const search = (document.getElementById('clientSearch')?.value || '').toLowerCase();

  const map = {};
  clients.forEach(c => {
    const key = (c.phone || '').trim() || (c.full_name || '').trim();
    if (!map[key]) {
      map[key] = { name: c.full_name, phone: c.phone, sessions: [], lastVisit: '' };
    }
    map[key].sessions.push(c);
    if ((c.preferred_date || '') > map[key].lastVisit) {
      map[key].lastVisit = c.preferred_date || '';
    }
  });

  const finMap = {};
  finances.forEach(f => {
    const name = (f.client_name || '').trim();
    if (!finMap[name]) finMap[name] = { paid: 0, remaining: 0 };
    finMap[name].paid      += Number(f.paid_amount || 0);
    finMap[name].remaining += Number(f.remaining_amount || 0);
  });

  let entries = Object.values(map);

  if (search) {
    entries = entries.filter(e =>
      (e.name || '').toLowerCase().includes(search) ||
      (e.phone || '').includes(search)
    );
  }

  if (entries.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:var(--text-muted);padding:20px;">لا توجد عملاء</td></tr>`;
    return;
  }

  tbody.innerHTML = entries.map(e => {
    const fn = finMap[(e.name || '').trim()] || { paid: 0, remaining: 0 };
    return `
      <tr>
        <td style="font-weight:800;">${escapeHtml(e.name)}</td>
        <td dir="ltr">${escapeHtml(e.phone)}</td>
        <td>${e.sessions.length}</td>
        <td style="color:#2e7d32; font-weight:700;">${fn.paid.toLocaleString('ar-EG')}</td>
        <td style="color:#c62828; font-weight:700;">${fn.remaining.toLocaleString('ar-EG')}</td>
        <td>${formatDate(e.lastVisit)}</td>
        <td><button class="btn btn-soft" style="padding:5px 12px; font-size:12px;"
          onclick="openProfile('${escapeHtml(e.name)}','${escapeHtml(e.phone)}')">عرض الملف</button></td>
      </tr>
    `;
  }).join('');
}

document.getElementById('clientSearch')?.addEventListener('input', renderClientsDirectory);

// ============================================================
// OVERVIEW
// ============================================================
function renderOverview() {
  const today = new Date().toISOString().split('T')[0];

  document.getElementById('ovBookings').textContent = clients.length;
  document.getElementById('ovToday').textContent    = clients.filter(c => c.preferred_date === today).length;

  const total     = finances.reduce((s, f) => s + Number(f.total_amount || 0), 0);
  const remaining = finances.reduce((s, f) => s + Number(f.remaining_amount || 0), 0);
  document.getElementById('ovTotal').textContent     = total.toLocaleString('ar-EG');
  document.getElementById('ovRemaining').textContent = remaining.toLocaleString('ar-EG');

  const tbody = document.getElementById('overviewRecentBody');
  if (tbody) {
    const recent = [...clients].slice(0, 10);
    tbody.innerHTML = recent.map(c => `
      <tr>
        <td style="font-weight:700;">${escapeHtml(c.full_name)}</td>
        <td dir="ltr">${escapeHtml(c.phone)}</td>
        <td>${escapeHtml(c.service)}</td>
        <td>${escapeHtml(c.body_area || '-')}</td>
        <td>${formatDate(c.preferred_date)}</td>
        <td>${escapeHtml(c.preferred_time || '-')}</td>
        <td>${statusBadge(c.status)}</td>
      </tr>
    `).join('');
  }
}

// ============================================================
// SERVICES
// ============================================================
async function fetchServices() {
  try {
    const res = await fetch('/api/admin/services', { credentials: 'include' });
    const r = await res.json();
    if (r.success) { services = r.data || []; renderServices(); }
  } catch (e) { console.error(e); }
}

function renderServices() {
  const tbody = document.getElementById('servicesTableBody');
  if (!tbody) return;
  if (services.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:var(--text-muted);padding:20px;">لا توجد خدمات</td></tr>`;
    return;
  }
  tbody.innerHTML = services.map(s => `
    <tr>
      <td><input type="text" id="sn-${s.id}" value="${escapeHtml(s.name)}" style="min-width:130px;"></td>
      <td><textarea id="sd-${s.id}" rows="2" style="min-width:180px;">${escapeHtml(s.description)}</textarea></td>
      <td><input type="text" id="sp-${s.id}" value="${escapeHtml(s.price)}" style="min-width:100px;"></td>
      <td><input type="text" id="st-${s.id}" value="${escapeHtml(s.tag || '')}" style="min-width:90px;"></td>
      <td><input type="number" id="so-${s.id}" value="${Number(s.sort_order || 0)}" style="width:65px;"></td>
      <td><label class="check-wrap" style="justify-content:center;"><input type="checkbox" id="sf-${s.id}" ${Number(s.is_featured) === 1 ? 'checked' : ''}> مميز</label></td>
      <td style="display:flex; gap:6px; justify-content:center;">
        <button class="btn btn-success" style="padding:6px 12px; font-size:12px;" onclick="updateService(${s.id})">حفظ</button>
        <button class="btn btn-danger" style="padding:6px 12px; font-size:12px;" onclick="deleteService(${s.id})">حذف</button>
      </td>
    </tr>
  `).join('');
}

document.getElementById('serviceForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    name: document.getElementById('serviceName').value.trim(),
    description: document.getElementById('serviceDescription').value.trim(),
    price: document.getElementById('servicePrice').value.trim(),
    tag: document.getElementById('serviceTag').value.trim(),
    sortOrder: Number(document.getElementById('serviceSortOrder').value || 0),
    isFeatured: document.getElementById('serviceIsFeatured').checked
  };
  try {
    const res = await fetch('/api/admin/services', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'include', body: JSON.stringify(payload)
    });
    const r = await res.json();
    if (r.success) { toast('تمت الإضافة ✅'); e.target.reset(); await fetchServices(); }
    else toast(r.message || 'فشل', true);
  } catch (e) { toast('خطأ', true); }
});

async function updateService(id) {
  const payload = {
    name: document.getElementById(`sn-${id}`).value.trim(),
    description: document.getElementById(`sd-${id}`).value.trim(),
    price: document.getElementById(`sp-${id}`).value.trim(),
    tag: document.getElementById(`st-${id}`).value.trim(),
    sortOrder: Number(document.getElementById(`so-${id}`).value || 0),
    isFeatured: document.getElementById(`sf-${id}`).checked
  };
  try {
    const res = await fetch(`/api/admin/services/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      credentials: 'include', body: JSON.stringify(payload)
    });
    const r = await res.json();
    if (r.success) { toast('تم التحديث ✅'); await fetchServices(); }
    else toast(r.message || 'فشل', true);
  } catch (e) { toast('خطأ', true); }
}

async function deleteService(id) {
  if (!confirm('هل أنتِ متأكدة من حذف هذه الخدمة؟')) return;
  try {
    const res = await fetch(`/api/admin/services/${id}`, { method: 'DELETE', credentials: 'include' });
    const r = await res.json();
    if (r.success) { toast('تم الحذف'); await fetchServices(); }
    else toast(r.message || 'فشل', true);
  } catch (e) { toast('خطأ', true); }
}

// ============================================================
// OFFERS
// ============================================================
async function fetchOffers() {
  try {
    const res = await fetch('/api/admin/offers', { credentials: 'include' });
    const r = await res.json();
    if (r.success) { offers = r.data || []; renderOffers(); }
  } catch (e) { console.error(e); }
}

function renderOffers() {
  const tbody = document.getElementById('offersTableBody');
  if (!tbody) return;
  if (offers.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="color:var(--text-muted);padding:20px;">لا توجد عروض</td></tr>`;
    return;
  }
  tbody.innerHTML = offers.map(o => {
    const ft = Array.isArray(o.features) ? o.features.join(' | ') : (o.features || '');
    return `
      <tr>
        <td><input type="text" id="ot-${o.id}" value="${escapeHtml(o.title)}" style="min-width:130px;"></td>
        <td><textarea id="od-${o.id}" rows="2" style="min-width:180px;">${escapeHtml(o.description)}</textarea></td>
        <td><input type="text" id="op-${o.id}" value="${escapeHtml(o.price)}" style="min-width:100px;"></td>
        <td><input type="text" id="ol-${o.id}" value="${escapeHtml(o.label || '')}" style="min-width:90px;"></td>
        <td><input type="text" id="of-${o.id}" value="${escapeHtml(ft)}" style="min-width:160px;"></td>
        <td><input type="number" id="oo-${o.id}" value="${Number(o.sort_order || 0)}" style="width:65px;"></td>
        <td><label class="check-wrap" style="justify-content:center;"><input type="checkbox" id="oh-${o.id}" ${Number(o.is_highlighted) === 1 ? 'checked' : ''}> مميز</label></td>
        <td style="display:flex; gap:6px; justify-content:center;">
          <button class="btn btn-success" style="padding:6px 12px; font-size:12px;" onclick="updateOffer(${o.id})">حفظ</button>
          <button class="btn btn-danger" style="padding:6px 12px; font-size:12px;" onclick="deleteOffer(${o.id})">حذف</button>
        </td>
      </tr>
    `;
  }).join('');
}

document.getElementById('offerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const featRaw = document.getElementById('offerFeatures').value.trim();
  const payload = {
    title: document.getElementById('offerTitle').value.trim(),
    description: document.getElementById('offerDescription').value.trim(),
    price: document.getElementById('offerPrice').value.trim(),
    label: document.getElementById('offerLabel').value.trim(),
    features: featRaw ? featRaw.split('|').map(x => x.trim()).filter(Boolean) : [],
    sortOrder: Number(document.getElementById('offerSortOrder').value || 0),
    isHighlighted: document.getElementById('offerIsHighlighted').checked
  };
  try {
    const res = await fetch('/api/admin/offers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'include', body: JSON.stringify(payload)
    });
    const r = await res.json();
    if (r.success) { toast('تمت الإضافة ✅'); e.target.reset(); await fetchOffers(); }
    else toast(r.message || 'فشل', true);
  } catch (e) { toast('خطأ', true); }
});

async function updateOffer(id) {
  const featRaw = document.getElementById(`of-${id}`).value.trim();
  const payload = {
    title: document.getElementById(`ot-${id}`).value.trim(),
    description: document.getElementById(`od-${id}`).value.trim(),
    price: document.getElementById(`op-${id}`).value.trim(),
    label: document.getElementById(`ol-${id}`).value.trim(),
    features: featRaw ? featRaw.split('|').map(x => x.trim()).filter(Boolean) : [],
    sortOrder: Number(document.getElementById(`oo-${id}`).value || 0),
    isHighlighted: document.getElementById(`oh-${id}`).checked
  };
  try {
    const res = await fetch(`/api/admin/offers/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      credentials: 'include', body: JSON.stringify(payload)
    });
    const r = await res.json();
    if (r.success) { toast('تم التحديث ✅'); await fetchOffers(); }
    else toast(r.message || 'فشل', true);
  } catch (e) { toast('خطأ', true); }
}

async function deleteOffer(id) {
  if (!confirm('هل أنتِ متأكدة من حذف هذا العرض؟')) return;
  try {
    const res = await fetch(`/api/admin/offers/${id}`, { method: 'DELETE', credentials: 'include' });
    const r = await res.json();
    if (r.success) { toast('تم الحذف'); await fetchOffers(); }
    else toast(r.message || 'فشل', true);
  } catch (e) { toast('خطأ', true); }
}

// ============================================================
// CREDENTIALS
// ============================================================
document.getElementById('credentialsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    currentUsername: document.getElementById('currentUsername').value.trim(),
    currentPassword: document.getElementById('currentPassword').value.trim(),
    newUsername: document.getElementById('newUsername').value.trim(),
    newPassword: document.getElementById('newPassword').value.trim()
  };
  try {
    const res = await fetch('/api/admin/change-credentials', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      credentials: 'include', body: JSON.stringify(payload)
    });
    const r = await res.json();
    if (r.success) { toast('تم تحديث البيانات ✅'); e.target.reset(); }
    else toast(r.message || 'فشل', true);
  } catch (e) { toast('خطأ', true); }
});

// ============================================================
// REMINDERS — إرسال يدوي وعمليات الجلسة
// ============================================================

/* =============================================
   MANUAL SEND — الإرسال اليدوي
============================================= */

let manualBookingsList = [];
let extraContactsList  = [];
let allBookingsSelected = false;
let allExtraSelected    = false;

function switchManualTab(tab) {
  document.getElementById('mtab-bookings').style.display = tab === 'bookings' ? '' : 'none';
  document.getElementById('mtab-extra').style.display    = tab === 'extra'    ? '' : 'none';
  const btnB = document.getElementById('mtab-btn-bookings');
  const btnE = document.getElementById('mtab-btn-extra');
  if (btnB) { btnB.style.borderBottomColor = tab === 'bookings' ? '#b76e79' : 'transparent'; btnB.style.color = tab === 'bookings' ? '#b76e79' : 'var(--text-muted)'; }
  if (btnE) { btnE.style.borderBottomColor = tab === 'extra'    ? '#b76e79' : 'transparent'; btnE.style.color = tab === 'extra'    ? '#b76e79' : 'var(--text-muted)'; }
  if (tab === 'extra') loadExtraContacts();
}

// --- من الحجوزات ---
async function loadManualBookings() {
  const tbody = document.getElementById('manualBookingsBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;">⏳ جاري التحميل...</td></tr>';
  try {
    const res  = await fetch('/api/bookings', { credentials: 'include' });
    const data = await res.json();
    manualBookingsList = data.success ? (data.data || []) : [];
    renderManualBookings(manualBookingsList);
  } catch (e) { toast('خطأ في تحميل الحجوزات', true); }
}

function filterManualBookings() {
  const q = (document.getElementById('manualSearchInput')?.value || '').trim().toLowerCase();
  const filtered = q
    ? manualBookingsList.filter(c => (c.full_name || '').toLowerCase().includes(q) || (c.phone || '').includes(q))
    : manualBookingsList;
  renderManualBookings(filtered);
}

function renderManualBookings(list) {
  const tbody = document.getElementById('manualBookingsBody');
  if (!tbody) return;
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="color:var(--text-muted);padding:20px;text-align:center;">لا توجد نتائج</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(c => {
    const date = (c.preferred_date || '').slice(0, 10);
    return "<tr>" +
      "<td><input type='checkbox' class='booking-check' data-name='" + (c.full_name||'').replace(/'/g,"") + "' data-phone='" + (c.phone||'') + "' onchange='updateSelectedCount()'></td>" +
      "<td>" + (c.full_name||'') + "</td>" +
      "<td>" + (c.phone||'') + "</td>" +
      "<td>" + (c.service||'') + "</td>" +
      "<td>" + (c.body_area||'') + "</td>" +
      "<td>" + date + "</td>" +
      "<td>" + (c.status||'') + "</td>" +
      "</tr>";
  }).join('');
  updateSelectedCount();
}

function toggleAllBookings(cb) {
  document.querySelectorAll('.booking-check').forEach(c => c.checked = cb.checked);
  updateSelectedCount();
}

function toggleAllBookingsBtn() {
  allBookingsSelected = !allBookingsSelected;
  document.querySelectorAll('.booking-check').forEach(c => c.checked = allBookingsSelected);
  const cb = document.getElementById('checkAllBookings');
  if (cb) cb.checked = allBookingsSelected;
  updateSelectedCount();
}

function updateSelectedCount() {
  const n = document.querySelectorAll('.booking-check:checked').length
          + document.querySelectorAll('.extra-check:checked').length;
  const el1 = document.getElementById('selectedCount');
  const el2 = document.getElementById('selectedCountExtra');
  if (el1) el1.textContent = n;
  if (el2) el2.textContent = n;
}

// --- عميلات يدويات ---
async function loadExtraContacts() {
  const tbody = document.getElementById('extraContactsBody');
  if (!tbody) return;
  try {
    const res  = await fetch('/api/admin/extra-contacts', { credentials: 'include' });
    const data = await res.json();
    extraContactsList = data.success ? (data.data || []) : [];
    renderExtraContacts(extraContactsList);
  } catch (e) { toast('خطأ في تحميل العميلات', true); }
}

function renderExtraContacts(list) {
  const tbody = document.getElementById('extraContactsBody');
  if (!tbody) return;
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="color:var(--text-muted);padding:20px;text-align:center;">لا توجد عميلات يدويات</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(c =>
    "<tr>" +
    "<td><input type='checkbox' class='extra-check' data-name='" + (c.name||'').replace(/'/g,"") + "' data-phone='" + (c.phone||'') + "' onchange='updateSelectedCount()'></td>" +
    "<td>" + (c.name||'') + "</td>" +
    "<td>" + (c.phone||'') + "</td>" +
    "<td><button class='btn delete-btn' style='padding:4px 10px;font-size:12px;' onclick='deleteExtraContact(" + c.id + ")'>🗑️</button></td>" +
    "</tr>"
  ).join('');
  updateSelectedCount();
}

function toggleAllExtra(cb) {
  document.querySelectorAll('.extra-check').forEach(c => c.checked = cb.checked);
  updateSelectedCount();
}

function toggleAllExtraBtn() {
  allExtraSelected = !allExtraSelected;
  document.querySelectorAll('.extra-check').forEach(c => c.checked = allExtraSelected);
  const cb = document.getElementById('checkAllExtra');
  if (cb) cb.checked = allExtraSelected;
  updateSelectedCount();
}

async function addExtraContact() {
  const name  = (document.getElementById('extraName')?.value || '').trim();
  const phone = (document.getElementById('extraPhone')?.value || '').trim();
  if (!name || !phone) { toast('ادخلي الاسم والهاتف', true); return; }
  try {
    const res  = await fetch('/api/admin/extra-contacts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'include', body: JSON.stringify({ name, phone })
    });
    const data = await res.json();
    if (data.success) {
      document.getElementById('extraName').value  = '';
      document.getElementById('extraPhone').value = '';
      toast('تمت الإضافة ✅');
      loadExtraContacts();
    } else toast(data.message || 'فشل الإضافة', true);
  } catch (e) { toast('خطأ', true); }
}

async function deleteExtraContact(id) {
  if (!confirm('حذف العميلة؟')) return;
  try {
    await fetch('/api/admin/extra-contacts/' + id, { method: 'DELETE', credentials: 'include' });
    toast('تم الحذف');
    loadExtraContacts();
  } catch (e) { toast('خطأ', true); }
}

async function sendManualSelected() {
  const message = (document.getElementById('manualMessage')?.value || '').trim();
  if (!message) { toast('اكتبي الرسالة الأول', true); return; }
  const targets = [];
  document.querySelectorAll('.booking-check:checked, .extra-check:checked').forEach(cb => {
    targets.push({ name: cb.dataset.name || '', phone: cb.dataset.phone || '' });
  });
  if (targets.length === 0) { toast('مفيش عميلات محددة', true); return; }
  if (!confirm('هترسلي لـ ' + targets.length + ' عميلة. متأكدة؟')) return;
  toast('جاري الإرسال لـ ' + targets.length + ' عميلة...');
  try {
    const res  = await fetch('/api/admin/reminders/manual-send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'include', body: JSON.stringify({ targets, message })
    });
    const data = await res.json();
    if (data.success) toast('تم الإرسال: ' + data.sent + ' | فشل: ' + data.failed);
    else toast(data.message || 'فشل الإرسال', true);
  } catch (e) { toast('خطأ في الإرسال', true); }
}

// تحميل تلقائي عند فتح تاب التذكيرات
(function() {
  const origTabClick = window._tabClickHandler;
})();

/* =============================================
   SESSION OPERATIONS — عمليات الجلسة
============================================= */

async function loadSessionOperations(daysFilter) {
  const tbody = document.getElementById('sessionOpsBody');
  const badge = document.getElementById('opFilterBadge');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:20px;color:var(--text-muted);">⏳ جاري التحميل...</td></tr>';

  let url = '/api/admin/session-operations';
  if (daysFilter && !isNaN(daysFilter)) {
    url += '?days=' + daysFilter;
    if (badge) { badge.textContent = 'عدا عليها ' + daysFilter + ' يوم+'; badge.style.display = 'inline-block'; }
  } else {
    if (badge) badge.style.display = 'none';
  }

  try {
    const res  = await fetch(url, { credentials: 'include' });
    const data = await res.json();
    if (!data.success) {
      tbody.innerHTML = '<tr><td colspan="10" style="color:red;padding:20px;text-align:center;">فشل التحميل</td></tr>';
      return;
    }
    const list = data.data || [];
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="10" style="color:var(--text-muted);padding:20px;text-align:center;">' +
        (daysFilter ? 'لا توجد عمليات عدا عليها ' + daysFilter + ' يوم أو أكثر' : 'لا توجد عمليات مسجّلة بعد') + '</td></tr>';
      return;
    }
    const today = new Date();
    tbody.innerHTML = list.map(op => {
      const opDate   = new Date(op.operation_date);
      const diffDays = Math.floor((today - opDate) / (1000 * 60 * 60 * 24));
      const badgeColor = diffDays >= 21 ? '#b76e79' : diffDays >= 14 ? '#e0a04e' : '#5cb85c';
      const daysBadge = `<span style="background:${badgeColor};color:#fff;border-radius:20px;padding:3px 10px;font-size:12px;font-weight:700;">${diffDays} يوم</span>`;

      let phone = (op.phone || '').replace(/\D/g, '');
      if (phone.startsWith('0')) phone = '2' + phone;
      else if (!phone.startsWith('20')) phone = '20' + phone;
      const waLink = op.phone
        ? `<a href="https://wa.me/${phone}" target="_blank" rel="noopener"
             style="display:inline-flex;align-items:center;gap:4px;background:#25d366;color:#fff;padding:4px 10px;border-radius:8px;font-size:12px;text-decoration:none;">${WA_ICON} واتساب</a>`
        : '<span style="color:var(--text-muted);font-size:12px;">-</span>';

      return `<tr>
        <td style="font-size:11px;color:var(--text-muted);">${op.id}</td>
        <td style="font-weight:700;">${escapeHtml(op.client_name||'-')}</td>
        <td dir="ltr">${escapeHtml(op.phone||'-')}</td>
        <td>${escapeHtml(op.service||'-')}</td>
        <td>${escapeHtml(op.body_area||'-')}</td>
        <td>${formatDate(op.operation_date)}</td>
        <td style="text-align:center;">${daysBadge}</td>
        <td style="max-width:160px;font-size:12px;" title="${escapeHtml(op.notes||'')}">${escapeHtml(op.notes||'-')}</td>
        <td>${waLink}</td>
        <td><button class="btn btn-danger" style="padding:4px 10px;font-size:12px;" onclick="deleteSessionOperation(${op.id})">🗑️</button></td>
      </tr>`;
    }).join('');
  } catch (e) { toast('خطأ في تحميل العمليات', true); }
}

function filterSessionOperations() {
  const days = Number(document.getElementById('opDaysFilter')?.value || 0);
  if (!days || days < 1) { toast('ادخلي عدد الأيام أولاً', true); return; }
  loadSessionOperations(days);
}

async function addSessionOperation() {
  const clientName    = (document.getElementById('opClientName')?.value || '').trim();
  const phone         = (document.getElementById('opPhone')?.value     || '').trim();
  const service       = (document.getElementById('opService')?.value   || '').trim();
  const bodyArea      = (document.getElementById('opBodyArea')?.value  || '').trim();
  const operationDate = (document.getElementById('opDate')?.value      || '').trim();
  const notes         = (document.getElementById('opNotes')?.value     || '').trim();

  if (!clientName) { toast('الاسم مطلوب', true); return; }
  if (!operationDate) { toast('تاريخ العملية مطلوب', true); return; }

  try {
    const res  = await fetch('/api/admin/session-operations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ clientName, phone, service, bodyArea, operationDate, notes })
    });
    const data = await res.json();
    if (data.success) {
      toast('تمت إضافة العملية ✅');
      ['opClientName','opPhone','opService','opBodyArea','opDate','opNotes'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
      });
      loadSessionOperations();
    } else toast(data.message || 'فشل الحفظ', true);
  } catch (e) { toast('خطأ في الحفظ', true); }
}

async function deleteSessionOperation(id) {
  if (!confirm('حذف هذه العملية؟')) return;
  try {
    await fetch('/api/admin/session-operations/' + id, { method: 'DELETE', credentials: 'include' });
    toast('تم الحذف');
    loadSessionOperations();
  } catch (e) { toast('خطأ', true); }
}