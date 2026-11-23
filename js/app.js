/**
 * ============================================================================
 * LOGIC ĐIỀU KHIỂN CỔNG THÔNG TIN NCKH - KHOA HOÁ HỌC (HCMUE) - PHIÊN BẢN V3
 * - Tự động đồng bộ cấu hình, thông báo NCKH, thời gian biểu, đề tài, sự kiện & cổng tương tác
 * - Thời gian biểu tích hợp 2 nguồn: (i) Seminar + Thông báo có ngày; (ii) Tab CMS_ThoiGianBieu
 * - Hỗ trợ xem theo Tuần (Thứ 2 - CN x Ca Sáng/Chiều/Tối) và xem theo Tháng
 * ============================================================================
 */

const API_URL = "https://script.google.com/macros/s/AKfycbz-y0kUxEFygO4PxHAw7Z5N06nOGS57TMMr-t6XMjH6PmjNFHDXmQlA-wCwag1IUko6dg/exec";
const CACHE_KEY = "hcmue_chem_nckh_cache_v3";
const CACHE_TTL_MS = 5 * 60 * 1000;

const state = {
  rawData: null,
  filteredProjects: [],
  currentPage: 1,
  itemsPerPage: 15,
  selectedGvhdId: "",
  eventFilter: "ALL",
  scheduleView: "WEEK",
  scheduleAnchorDate: new Date(),
  scheduleSourceFilter: "ALL",
  unifiedScheduleItems: []
};

function escapeHTML(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeText(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .trim();
}

// Tự động chuẩn hoá quy tắc đặt dấu kiểu cũ (Hoá, Khoá, hoà, thuỷ...)
function toOldVietnameseTone(str) {
  if (typeof str !== "string" || !str) return str;
  const endSyl = "(?![a-zA-ZÀ-ỹĐđ])";
  return str
    .replace(new RegExp("óa" + endSyl, "g"), "oá")
    .replace(new RegExp("òa" + endSyl, "g"), "oà")
    .replace(new RegExp("ỏa" + endSyl, "g"), "oả")
    .replace(new RegExp("õa" + endSyl, "g"), "oã")
    .replace(new RegExp("ọa" + endSyl, "g"), "oạ")
    .replace(new RegExp("ÓA" + endSyl, "g"), "OÁ")
    .replace(new RegExp("ÒA" + endSyl, "g"), "OÀ")
    .replace(new RegExp("ỎA" + endSyl, "g"), "OẢ")
    .replace(new RegExp("ÕA" + endSyl, "g"), "OÃ")
    .replace(new RegExp("ỌA" + endSyl, "g"), "OẠ")
    .replace(new RegExp("óe" + endSyl, "g"), "oé")
    .replace(new RegExp("òe" + endSyl, "g"), "oè")
    .replace(new RegExp("ỏe" + endSyl, "g"), "oẻ")
    .replace(new RegExp("õe" + endSyl, "g"), "oẽ")
    .replace(new RegExp("ọe" + endSyl, "g"), "oẹ")
    .replace(new RegExp("ÓE" + endSyl, "g"), "OÉ")
    .replace(new RegExp("ÒE" + endSyl, "g"), "OÈ")
    .replace(new RegExp("ỎE" + endSyl, "g"), "OẺ")
    .replace(new RegExp("ÕE" + endSyl, "g"), "OẼ")
    .replace(new RegExp("ỌE" + endSyl, "g"), "OẸ")
    .replace(new RegExp("(^|[^qQ])úy" + endSyl, "g"), "$1uý")
    .replace(new RegExp("(^|[^qQ])ùy" + endSyl, "g"), "$1uỳ")
    .replace(new RegExp("(^|[^qQ])ủy" + endSyl, "g"), "$1uỷ")
    .replace(new RegExp("(^|[^qQ])ũy" + endSyl, "g"), "$1uỹ")
    .replace(new RegExp("(^|[^qQ])ụy" + endSyl, "g"), "$1uỵ")
    .replace(new RegExp("(^|[^qQ])ÚY" + endSyl, "g"), "$1UÝ")
    .replace(new RegExp("(^|[^qQ])ÙY" + endSyl, "g"), "$1UỲ")
    .replace(new RegExp("(^|[^qQ])ỦY" + endSyl, "g"), "$1UỶ")
    .replace(new RegExp("(^|[^qQ])ŨY" + endSyl, "g"), "$1UỸ")
    .replace(new RegExp("(^|[^qQ])ỤY" + endSyl, "g"), "$1UỴ");
}

function convertObjectStrings(obj, keyName = "") {
  if (typeof obj === "string") {
    if (/^(link|logo|fanpage|email|ma_|updated_at|ngay_)/i.test(keyName)) return obj;
    return toOldVietnameseTone(obj);
  }
  if (Array.isArray(obj)) return obj.map(item => convertObjectStrings(item, keyName));
  if (obj && typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = convertObjectStrings(v, k);
    return out;
  }
  return obj;
}

function hasValidAward(val) {
  const v = String(val || "").trim();
  return v !== "" && v !== "-" && v.toLowerCase() !== "không";
}

function parseSheetDate(raw) {
  if (!raw) return null;
  const str = String(raw).trim();
  let m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = str.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return null;
}

function formatDisplayDate(raw) {
  const d = raw instanceof Date ? raw : parseSheetDate(raw);
  if (!d) return raw || "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function formatShortDayMonth(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

function toDateKey(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function computeEventStatus(ev) {
  const start = parseSheetDate(ev.ngay_bat_dau) || parseSheetDate(ev.thoi_gian);
  const end = parseSheetDate(ev.ngay_ket_thuc) || start;
  if (start) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (today < start) return "Sắp diễn ra";
    if (today >= start && today <= end) return "Đang diễn ra";
    return "Đã diễn ra";
  }
  return ev.trang_thai || "Sắp diễn ra";
}

// Xác định ca Sáng / Chiều / Tối từ cột Buổi/Ca hoặc chuỗi thời gian
function detectSessionSlot(buoiRaw, timeHint = "") {
  const norm = normalizeText(buoiRaw);
  if (norm.includes("toi")) return "TOI";
  if (norm.includes("chieu")) return "CHIEU";
  if (norm.includes("sang") || norm.includes("ca ngay")) return "SANG";

  const t = normalizeText(timeHint);
  if (t.includes("toi")) return "TOI";
  if (t.includes("chieu")) return "CHIEU";
  const hourMatch = t.match(/(\d{1,2})\s*[:h]/);
  if (hourMatch) {
    const h = Number(hourMatch[1]);
    if (h >= 17) return "TOI";
    if (h >= 12) return "CHIEU";
  }
  return "SANG";
}

function getSessionLabel(slot, rawBuoi) {
  if (normalizeText(rawBuoi).includes("ca ngay")) return "Cả ngày";
  if (slot === "CHIEU") return "Ca Chiều";
  if (slot === "TOI") return "Ca Tối";
  return "Ca Sáng";
}

// 1. Tải dữ liệu từ Apps Script API
async function loadPortalData(forceRefresh = false) {
  const loadingEl = document.getElementById("loading-banner");
  loadingEl.classList.remove("hidden");

  try {
    if (!forceRefresh) {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.timestamp < CACHE_TTL_MS) {
          state.rawData = convertObjectStrings(parsed.data);
          renderAll();
          loadingEl.classList.add("hidden");
          handleDeepLinkHash();
          return;
        }
      }
    }

    const response = await fetch(API_URL);
    if (!response.ok) throw new Error("Lỗi kết nối máy chủ dữ liệu");
    const data = await response.json();

    state.rawData = convertObjectStrings(data);
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({
      timestamp: Date.now(),
      data: state.rawData
    }));

    renderAll();
    handleDeepLinkHash();
  } catch (err) {
    console.error(err);
    loadingEl.innerHTML = `<div class="container">Không thể tải dữ liệu lúc này. Vui lòng nhấn <strong>"Cập nhật dữ liệu"</strong> hoặc kiểm tra lại đường truyền.</div>`;
    return;
  }

  loadingEl.classList.add("hidden");
}

function renderAll() {
  if (!state.rawData) return;
  applySystemConfig(state.rawData.cau_hinh || {});
  renderKPIs(state.rawData);
  renderHistoryChart(state.rawData.thong_ke_lich_su || []);
  renderAnnouncements(state.rawData.thong_bao || []);
  buildUnifiedSchedule();
  renderSchedule();
  populateFilterDropdowns(state.rawData.de_tai || []);
  applyProjectFilters();
  renderEvents(state.rawData.su_kien || []);
  renderDocuments(state.rawData.van_ban || []);
  renderInteractionCards(state.rawData.cong_tuong_tac || []);
}

function applySystemConfig(cfg) {
  if (cfg.ten_truong) document.getElementById("header-university").textContent = cfg.ten_truong;
  if (cfg.ten_khoa) {
    document.getElementById("header-faculty").textContent = cfg.ten_khoa;
    document.getElementById("footer-faculty-title").textContent = `${cfg.ten_khoa} – ${cfg.ten_truong || "TRƯỜNG ĐẠI HỌC SƯ PHẠM TP. HỒ CHÍ MINH"}`;
  }
  if (cfg.tieu_de_cong) {
    document.getElementById("header-portal-title").textContent = cfg.tieu_de_cong;
    document.title = `${cfg.tieu_de_cong} - ${cfg.ten_khoa || "Khoa Hoá học"} HCMUE`;
  }

  const headerLogo = document.getElementById("header-logo");
  const headerFallback = document.getElementById("header-logo-fallback");
  if (cfg.logo_header) {
    headerLogo.src = cfg.logo_header;
    headerLogo.onload = () => {
      headerLogo.classList.remove("hidden");
      headerFallback.classList.add("hidden");
    };
  }

  const footerLogo = document.getElementById("footer-logo");
  if (cfg.logo_footer) {
    footerLogo.src = cfg.logo_footer;
    footerLogo.onload = () => footerLogo.classList.remove("hidden");
  }

  const annBar = document.getElementById("announcement-bar");
  const annText = document.getElementById("announcement-text");
  if (cfg.thong_bao_chay && cfg.thong_bao_chay.trim() !== "") {
    annText.textContent = cfg.thong_bao_chay;
    annBar.classList.remove("hidden");
  } else {
    annBar.classList.add("hidden");
  }

  if (cfg.dia_chi) document.getElementById("footer-address").textContent = cfg.dia_chi;
  if (cfg.dien_thoai) document.getElementById("footer-phone").textContent = cfg.dien_thoai;
  if (cfg.email) {
    const emailEl = document.getElementById("footer-email");
    emailEl.textContent = cfg.email;
    emailEl.href = `mailto:${cfg.email}`;
  }
  if (cfg.fanpage) document.getElementById("footer-fanpage").href = cfg.fanpage;
}

function renderKPIs(data) {
  const projects = data.de_tai || [];
  const events = data.su_kien || [];
  const announcements = data.thong_bao || [];

  const awardedCount = projects.filter(p =>
    hasValidAward(p.giai_khoa) || hasValidAward(p.giai_truong) || hasValidAward(p.giai_bo)
  ).length;

  const ongoingCount = projects.filter(p =>
    normalizeText(p.trang_thai).includes("dang thuc hien")
  ).length;

  document.getElementById("kpi-total-projects").textContent = projects.length;
  document.getElementById("kpi-awarded-projects").textContent = awardedCount;
  document.getElementById("kpi-ongoing-projects").textContent = ongoingCount;
  document.getElementById("kpi-events-count").textContent = events.length + announcements.length;

  if (data.updated_at) {
    const dt = new Date(data.updated_at);
    document.getElementById("last-updated-label").textContent =
      `Đồng bộ: ${dt.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`;
  }
}

function renderHistoryChart(historyList) {
  const container = document.getElementById("history-chart");
  if (!historyList.length) {
    container.innerHTML = `<p style="color:#64748b;">Chưa có dữ liệu thống kê lịch sử.</p>`;
    return;
  }
  const maxVal = Math.max(...historyList.map(i => Number(i.so_luong) || 0), 1);
  container.innerHTML = historyList.map((item, idx) => {
    const count = Number(item.so_luong) || 0;
    const heightPct = Math.max(Math.round((count / maxVal) * 145), 10);
    const isLatest = idx === historyList.length - 1;
    return `
      <div class="bar-col ${isLatest ? "latest" : ""}">
        <span class="bar-value">${count}</span>
        <div class="bar-fill" style="height: ${heightPct}px;" title="Niên khoá ${escapeHTML(item.nien_khoa)}: ${count} đề tài"></div>
        <span class="bar-label">${escapeHTML(item.nien_khoa)}</span>
      </div>
    `;
  }).join("");
}

// ============================================================================
// HỢP NHẤT 2 NGUỒN DỮ LIỆU CHO THỜI GIAN BIỂU
// ============================================================================
function buildUnifiedSchedule() {
  const items = [];
  if (!state.rawData) return;

  // Nguồn (ii): Nhập riêng từ tab CMS_ThoiGianBieu
  (state.rawData.thoi_gian_bieu || []).forEach(row => {
    const start = parseSheetDate(row.ngay_bat_dau);
    const end = parseSheetDate(row.ngay_ket_thuc) || start;
    if (!start) return;
    const slot = detectSessionSlot(row.buoi_ca, row.gio_cu_the);
    items.push({
      id: row.ma_lich,
      source: "MANUAL",
      sourceLabel: row.phan_loai || "Lịch hoạt động",
      startDate: start,
      endDate: end,
      slot: slot,
      sessionLabel: getSessionLabel(slot, row.buoi_ca),
      timeText: row.gio_cu_the || getSessionLabel(slot, row.buoi_ca),
      title: row.ten_hoat_dong,
      location: row.dia_diem,
      organizer: row.phu_trach,
      content: row.noi_dung,
      link: row.link
    });
  });

  // Nguồn (i-a): Tự đồng bộ từ Seminar & Hội nghị có ngày
  (state.rawData.su_kien || []).forEach(ev => {
    const start = parseSheetDate(ev.ngay_bat_dau) || parseSheetDate(ev.thoi_gian);
    const end = parseSheetDate(ev.ngay_ket_thuc) || start;
    if (!start) return;
    const slot = detectSessionSlot(ev.buoi_ca, ev.thoi_gian);
    items.push({
      id: ev.ma_su_kien,
      source: "EVENT",
      sourceLabel: ev.loai || "Seminar / Hội nghị",
      startDate: start,
      endDate: end,
      slot: slot,
      sessionLabel: getSessionLabel(slot, ev.buoi_ca),
      timeText: ev.thoi_gian || getSessionLabel(slot, ev.buoi_ca),
      title: ev.ten_su_kien,
      location: ev.dia_diem,
      organizer: ev.dien_gia,
      content: ev.tom_tat,
      link: ev.link_dang_ky || ev.link_tai_lieu
    });
  });

  // Nguồn (i-b): Tự đồng bộ từ Thông báo NCKH có nhập ngày sự kiện / hạn mốc
  (state.rawData.thong_bao || []).forEach(tb => {
    const start = parseSheetDate(tb.ngay_su_kien);
    if (!start) return;
    const slot = detectSessionSlot(tb.buoi_ca, tb.tieu_de);
    items.push({
      id: tb.ma_tb,
      source: "ANNOUNCEMENT",
      sourceLabel: tb.phan_loai || "Thông báo NCKH",
      startDate: start,
      endDate: start,
      slot: slot,
      sessionLabel: getSessionLabel(slot, tb.buoi_ca),
      timeText: getSessionLabel(slot, tb.buoi_ca),
      title: tb.tieu_de,
      location: "Khoa Hoá học - HCMUE",
      organizer: "Ban Chủ nhiệm / Trợ lý NCKH",
      content: tb.noi_dung || tb.tom_tat,
      link: tb.link
    });
  });

  state.unifiedScheduleItems = items;
}

function getFilteredScheduleItems() {
  return state.unifiedScheduleItems.filter(item => {
    if (state.scheduleSourceFilter === "ALL") return true;
    return item.source === state.scheduleSourceFilter;
  });
}

function getItemsForDate(targetDate, items) {
  const t = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate()).getTime();
  return items.filter(it => {
    const s = new Date(it.startDate.getFullYear(), it.startDate.getMonth(), it.startDate.getDate()).getTime();
    const e = new Date(it.endDate.getFullYear(), it.endDate.getMonth(), it.endDate.getDate()).getTime();
    return t >= s && t <= e;
  });
}

function renderSchedule() {
  const picker = document.getElementById("sched-date-picker");
  if (picker) picker.value = toDateKey(state.scheduleAnchorDate);

  if (state.scheduleView === "MONTH") {
    renderMonthSchedule();
  } else {
    renderWeekSchedule();
  }
}

// Hiển thị Thời gian biểu theo Tuần (Cột: Thứ 2 -> CN kèm ngày; Hàng: Ca Sáng / Chiều / Tối)
function renderWeekSchedule() {
  const anchor = new Date(state.scheduleAnchorDate.getFullYear(), state.scheduleAnchorDate.getMonth(), state.scheduleAnchorDate.getDate());
  const dayOfWeek = anchor.getDay();
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(anchor);
  monday.setDate(anchor.getDate() + diffToMonday);

  const days = [];
  const dayNames = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ nhật"];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.push({ date: d, label: dayNames[i] });
  }

  const sunday = days[6].date;
  document.getElementById("sched-range-label").textContent =
    `Tuần từ ${formatDisplayDate(monday)} đến ${formatDisplayDate(sunday)}`;

  const now = new Date();
  const todayKey = toDateKey(now);
  const items = getFilteredScheduleItems();

  const sessions = [
    { key: "SANG", title: "Ca Sáng", hint: "07:00 – 11:30" },
    { key: "CHIEU", title: "Ca Chiều", hint: "13:00 – 17:00" },
    { key: "TOI", title: "Ca Tối", hint: "17:30 – 21:00" }
  ];

  const headerHtml = days.map(d => {
    const isToday = toDateKey(d.date) === todayKey;
    return `
      <th class="${isToday ? "is-today" : ""}">
        ${d.label}
        <span class="week-day-sub">${formatShortDayMonth(d.date)}</span>
      </th>
    `;
  }).join("");

  const rowsHtml = sessions.map(sess => {
    const cellsHtml = days.map(d => {
      const isToday = toDateKey(d.date) === todayKey;
      const dayItems = getItemsForDate(d.date, items).filter(it => it.slot === sess.key);
      const cardsHtml = dayItems.map(it => {
        const srcClass = it.source === "EVENT" ? "src-event" : (it.source === "ANNOUNCEMENT" ? "src-ann" : "");
        return `
          <div class="sched-item-card ${srcClass}" data-open-sched-source="${it.source}" data-open-sched-id="${escapeHTML(it.id)}" title="${escapeHTML(it.title)}">
            <span class="sched-item-meta">${escapeHTML(it.timeText)} • ${escapeHTML(it.sourceLabel)}</span>
            <div class="sched-item-title">${escapeHTML(it.title)}</div>
          </div>
        `;
      }).join("");

      return `<td class="${isToday ? "is-today-col" : ""}">${cardsHtml}</td>`;
    }).join("");

    return `
      <tr>
        <td class="session-label-cell">
          ${sess.title}
          <span class="session-time-hint">${sess.hint}</span>
        </td>
        ${cellsHtml}
      </tr>
    `;
  }).join("");

  document.getElementById("schedule-container").innerHTML = `
    <table class="week-table">
      <thead>
        <tr>
          <th class="col-session">Buổi / Ca</th>
          ${headerHtml}
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
}

// Hiển thị Thời gian biểu theo Tháng (Thứ 2 -> CN, kèm nhãn [Sáng]/[Chiều]/[Tối])
function renderMonthSchedule() {
  const year = state.scheduleAnchorDate.getFullYear();
  const month = state.scheduleAnchorDate.getMonth();
  document.getElementById("sched-range-label").textContent = `Tháng ${String(month + 1).padStart(2, "0")} / ${year}`;

  const firstOfMonth = new Date(year, month, 1);
  const firstDow = firstOfMonth.getDay();
  const offset = firstDow === 0 ? -6 : 1 - firstDow;
  const gridStart = new Date(year, month, 1 + offset);

  const now = new Date();
  const todayKey = toDateKey(now);
  const items = getFilteredScheduleItems();

  let bodyRows = "";
  const cursor = new Date(gridStart);

  for (let week = 0; week < 6; week++) {
    let rowCells = "";
    for (let d = 0; d < 7; d++) {
      const cellDate = new Date(cursor);
      const isCurrentMonth = cellDate.getMonth() === month;
      const isToday = toDateKey(cellDate) === todayKey;
      const dayItems = getItemsForDate(cellDate, items);

      const pillsHtml = dayItems.map(it => {
        const srcClass = it.source === "EVENT" ? "src-event" : (it.source === "ANNOUNCEMENT" ? "src-ann" : "");
        const shortCa = it.slot === "CHIEU" ? "Chiều" : (it.slot === "TOI" ? "Tối" : "Sáng");
        return `
          <div class="month-pill ${srcClass}" data-open-sched-source="${it.source}" data-open-sched-id="${escapeHTML(it.id)}" title="[${shortCa}] ${escapeHTML(it.title)}">
            [${shortCa}] ${escapeHTML(it.title)}
          </div>
        `;
      }).join("");

      rowCells += `
        <td class="${!isCurrentMonth ? "other-month" : ""} ${isToday ? "is-today-cell" : ""}">
          <div class="month-day-header">
            <span class="month-day-num">${cellDate.getDate()}</span>
          </div>
          ${pillsHtml}
        </td>
      `;
      cursor.setDate(cursor.getDate() + 1);
    }
    bodyRows += `<tr>${rowCells}</tr>`;
    if (cursor.getMonth() !== month && week >= 3) break;
  }

  document.getElementById("schedule-container").innerHTML = `
    <table class="month-table">
      <thead>
        <tr>
          <th>Thứ 2</th>
          <th>Thứ 3</th>
          <th>Thứ 4</th>
          <th>Thứ 5</th>
          <th>Thứ 6</th>
          <th>Thứ 7</th>
          <th>Chủ nhật</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>
  `;
}

// ============================================================================
// THÔNG BÁO HOẠT ĐỘNG NCKH & SEMINAR (THẺ TỐI GIẢN -> MỞ TRANG CHI TIẾT RIÊNG)
// ============================================================================
function renderAnnouncements(list) {
  const grid = document.getElementById("announcements-grid");
  if (!list.length) {
    grid.innerHTML = `<p style="color:#64748b;">Hiện chưa có thông báo mới nào.</p>`;
    return;
  }

  const sorted = [...list].sort((a, b) => (b.ghim ? 1 : 0) - (a.ghim ? 1 : 0));
  grid.innerHTML = sorted.map(tb => {
    const dateStr = formatDisplayDate(tb.ngay_dang);
    return `
      <article class="minimal-card ${tb.ghim ? "is-highlighted" : ""}" data-open-tb="${escapeHTML(tb.ma_tb)}" tabindex="0" role="button">
        <div>
          <div class="minimal-card-top">
            <div>
              ${tb.ghim ? `<span class="pill-badge badge-red">NỔI BẬT</span> ` : ""}
              <span class="pill-badge">${escapeHTML(tb.phan_loai || "Thông báo")}</span>
            </div>
            ${dateStr ? `<span class="minimal-date">${escapeHTML(dateStr)}</span>` : ""}
          </div>
          <h3 class="minimal-title">${escapeHTML(tb.tieu_de)}</h3>
          ${tb.tom_tat ? `<p class="minimal-excerpt">${escapeHTML(tb.tom_tat)}</p>` : ""}
        </div>
        <div class="minimal-card-footer">
          <span>Nhấn vào thẻ để xem chi tiết</span>
          <span>→</span>
        </div>
      </article>
    `;
  }).join("");
}

function renderEvents(events) {
  const grid = document.getElementById("events-grid");
  const enriched = events.map(ev => ({ ...ev, auto_status: computeEventStatus(ev) }));

  const filtered = enriched.filter(ev => {
    if (state.eventFilter === "ALL") return true;
    return normalizeText(ev.auto_status) === normalizeText(state.eventFilter);
  });

  if (!filtered.length) {
    grid.innerHTML = `<p style="color:#64748b;">Hiện chưa có hoạt động nào trong mục "${escapeHTML(state.eventFilter)}".</p>`;
    return;
  }

  grid.innerHTML = filtered.map(ev => {
    const st = ev.auto_status;
    const normSt = normalizeText(st);
    let badgeClass = "badge-gray";
    let cardClass = "";

    if (normSt.includes("dang dien ra")) {
      badgeClass = "badge-green";
      cardClass = "is-live";
    } else if (normSt.includes("sap dien ra")) {
      badgeClass = "badge-red";
      cardClass = "is-highlighted";
    }

    const dateDisplay = ev.thoi_gian || (ev.ngay_bat_dau ? formatDisplayDate(ev.ngay_bat_dau) : "");
    return `
      <article class="minimal-card ${cardClass}" data-open-ev="${escapeHTML(ev.ma_su_kien)}" tabindex="0" role="button">
        <div>
          <div class="minimal-card-top">
            <span class="pill-badge">${escapeHTML(ev.loai || "Hoạt động KH&CN")}</span>
            <span class="pill-badge ${badgeClass}">${escapeHTML(st)}</span>
          </div>
          <h3 class="minimal-title">${escapeHTML(ev.ten_su_kien)}</h3>
          <p class="minimal-excerpt">
            ${dateDisplay ? `<strong>Thời gian:</strong> ${escapeHTML(dateDisplay)}` : ""}
            ${ev.dia_diem ? ` • <strong>Địa điểm:</strong> ${escapeHTML(ev.dia_diem)}` : ""}
          </p>
        </div>
        <div class="minimal-card-footer">
          <span>Xem thông tin chi tiết & đăng ký</span>
          <span>→</span>
        </div>
      </article>
    `;
  }).join("");
}

// ============================================================================
// TRANG ĐỌC CHI TIẾT RIÊNG (CHO THÔNG BÁO, SỰ KIỆN VÀ LỊCH TRÌNH)
// ============================================================================
function openReaderPage({ badgesHtml, title, metaItems, bodyText, actionsHtml, hashSlug }) {
  document.getElementById("reader-badges").innerHTML = badgesHtml;
  document.getElementById("reader-title").textContent = title || "";

  const metaEl = document.getElementById("reader-meta");
  if (metaItems && metaItems.length > 0) {
    metaEl.innerHTML = metaItems.map(m => `<span>${m}</span>`).join("");
    metaEl.classList.remove("hidden");
  } else {
    metaEl.classList.add("hidden");
  }

  const paragraphs = String(bodyText || "Chưa có nội dung chi tiết bổ sung.")
    .split(/\n+/)
    .filter(p => p.trim() !== "")
    .map(p => `<p>${escapeHTML(p)}</p>`)
    .join("");
  document.getElementById("reader-body").innerHTML = paragraphs;

  document.getElementById("reader-actions").innerHTML = actionsHtml || "";
  document.getElementById("article-reader-page").classList.remove("hidden");
  document.getElementById("article-reader-page").scrollTop = 0;
  document.body.classList.add("no-scroll");

  if (hashSlug) history.replaceState(null, "", `#${hashSlug}`);
}

function closeReaderPage() {
  document.getElementById("article-reader-page").classList.add("hidden");
  document.body.classList.remove("no-scroll");
  if (/^#(thong-bao|su-kien|lich)\//.test(location.hash)) {
    history.replaceState(null, "", location.pathname + location.search);
  }
}

function openAnnouncementDetail(maTb) {
  const list = (state.rawData && state.rawData.thong_bao) || [];
  const tb = list.find(item => item.ma_tb === maTb);
  if (!tb) return;

  const dateStr = formatDisplayDate(tb.ngay_dang);
  const badgesHtml = `
    ${tb.ghim ? `<span class="pill-badge badge-red">NỔI BẬT</span>` : ""}
    <span class="pill-badge">${escapeHTML(tb.phan_loai || "Thông báo NCKH")}</span>
  `;
  const metaItems = [];
  if (dateStr) metaItems.push(`<strong>Ngày đăng:</strong> ${escapeHTML(dateStr)}`);
  if (tb.ngay_su_kien) {
    metaItems.push(`<strong>Ngày diễn ra / Hạn mốc:</strong> ${formatDisplayDate(tb.ngay_su_kien)}${tb.buoi_ca ? ` (${escapeHTML(tb.buoi_ca)})` : ""}`);
  }
  if (tb.ma_tb) metaItems.push(`<strong>Mã thông báo:</strong> ${escapeHTML(tb.ma_tb)}`);

  let actionsHtml = "";
  if (tb.link) {
    actionsHtml += `<a href="${escapeHTML(tb.link)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary">${escapeHTML(tb.ten_nut || "Mở văn bản / Liên kết đính kèm")} ↗</a>`;
  }
  actionsHtml += `<button type="button" class="btn btn-outline-primary" onclick="closeReaderPage()">← Quay lại danh sách</button>`;

  openReaderPage({
    badgesHtml,
    title: tb.tieu_de,
    metaItems,
    bodyText: tb.noi_dung || tb.tom_tat,
    actionsHtml,
    hashSlug: `thong-bao/${encodeURIComponent(tb.ma_tb)}`
  });
}

function openEventDetail(maSk) {
  const list = (state.rawData && state.rawData.su_kien) || [];
  const ev = list.find(item => item.ma_su_kien === maSk);
  if (!ev) return;

  const st = computeEventStatus(ev);
  const normSt = normalizeText(st);
  const badgeClass = normSt.includes("dang dien ra") ? "badge-green" : (normSt.includes("sap dien ra") ? "badge-red" : "badge-gray");

  const badgesHtml = `
    <span class="pill-badge">${escapeHTML(ev.loai || "Hoạt động KH&CN")}</span>
    <span class="pill-badge ${badgeClass}">${escapeHTML(st)}</span>
  `;

  const metaItems = [];
  const dateDisplay = ev.thoi_gian || (ev.ngay_bat_dau ? formatDisplayDate(ev.ngay_bat_dau) : "");
  if (dateDisplay) metaItems.push(`<strong>Thời gian:</strong> ${escapeHTML(dateDisplay)}`);
  if (ev.ngay_bat_dau && ev.ngay_ket_thuc && ev.ngay_bat_dau !== ev.ngay_ket_thuc) {
    metaItems.push(`<strong>Từ ngày:</strong> ${formatDisplayDate(ev.ngay_bat_dau)} <strong>đến</strong> ${formatDisplayDate(ev.ngay_ket_thuc)}`);
  }
  if (ev.dia_diem) metaItems.push(`<strong>Địa điểm:</strong> ${escapeHTML(ev.dia_diem)}`);
  if (ev.dien_gia) metaItems.push(`<strong>Đơn vị / Diễn giả:</strong> ${escapeHTML(ev.dien_gia)}`);

  let actionsHtml = "";
  if (ev.link_dang_ky) actionsHtml += `<a href="${escapeHTML(ev.link_dang_ky)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary">Đăng ký tham dự ↗</a>`;
  if (ev.link_tai_lieu) actionsHtml += `<a href="${escapeHTML(ev.link_tai_lieu)}" target="_blank" rel="noopener noreferrer" class="btn btn-blue">Xem tài liệu / Kỷ yếu ↗</a>`;
  actionsHtml += `<button type="button" class="btn btn-outline-primary" onclick="closeReaderPage()">← Quay lại danh sách</button>`;

  openReaderPage({
    badgesHtml,
    title: ev.ten_su_kien,
    metaItems,
    bodyText: ev.tom_tat,
    actionsHtml,
    hashSlug: `su-kien/${encodeURIComponent(ev.ma_su_kien)}`
  });
}

function openManualScheduleDetail(maLich) {
  const list = (state.rawData && state.rawData.thoi_gian_bieu) || [];
  const item = list.find(x => x.ma_lich === maLich);
  if (!item) return;

  const badgesHtml = `
    <span class="pill-badge">${escapeHTML(item.phan_loai || "Thời gian biểu NCKH")}</span>
    <span class="pill-badge badge-blue">${escapeHTML(item.buoi_ca || "Sáng")}</span>
  `;
  const metaItems = [];
  if (item.ngay_bat_dau) {
    const dateStr = item.ngay_ket_thuc && item.ngay_ket_thuc !== item.ngay_bat_dau
      ? `${formatDisplayDate(item.ngay_bat_dau)} – ${formatDisplayDate(item.ngay_ket_thuc)}`
      : formatDisplayDate(item.ngay_bat_dau);
    metaItems.push(`<strong>Ngày tổ chức:</strong> ${dateStr}`);
  }
  if (item.gio_cu_the) metaItems.push(`<strong>Khung giờ:</strong> ${escapeHTML(item.gio_cu_the)}`);
  if (item.dia_diem) metaItems.push(`<strong>Địa điểm:</strong> ${escapeHTML(item.dia_diem)}`);
  if (item.phu_trach) metaItems.push(`<strong>Đơn vị / Phụ trách:</strong> ${escapeHTML(item.phu_trach)}`);

  let actionsHtml = "";
  if (item.link) actionsHtml += `<a href="${escapeHTML(item.link)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary">Mở liên kết đính kèm ↗</a>`;
  actionsHtml += `<button type="button" class="btn btn-outline-primary" onclick="closeReaderPage()">← Quay lại Thời gian biểu</button>`;

  openReaderPage({
    badgesHtml,
    title: item.ten_hoat_dong,
    metaItems,
    bodyText: item.noi_dung,
    actionsHtml,
    hashSlug: `lich/${encodeURIComponent(item.ma_lich)}`
  });
}

function handleDeepLinkHash() {
  const h = decodeURIComponent(location.hash || "");
  if (h.startsWith("#thong-bao/")) openAnnouncementDetail(h.replace("#thong-bao/", ""));
  else if (h.startsWith("#su-kien/")) openEventDetail(h.replace("#su-kien/", ""));
  else if (h.startsWith("#lich/")) openManualScheduleDetail(h.replace("#lich/", ""));
}

// ============================================================================
// CỔNG TƯƠNG TÁC ĐỘNG, TRA CỨU ĐỀ TÀI & VĂN BẢN
// ============================================================================
function renderInteractionCards(cards) {
  const grid = document.getElementById("interaction-grid");
  if (!cards.length) {
    grid.innerHTML = `<p style="color:#64748b;">Đang cập nhật các kênh tương tác.</p>`;
    return;
  }

  grid.innerHTML = cards.map(card => {
    const colorRaw = (card.mau_nhan || "").trim();
    const normColor = normalizeText(colorRaw);
    let badgeClass = "";
    let badgeCustomStyle = "";

    if (colorRaw.startsWith("#")) {
      badgeCustomStyle = `style="background-color:${escapeHTML(colorRaw)}1A; color:${escapeHTML(colorRaw)};"`;
    } else if (normColor.includes("xanh la")) badgeClass = "badge-green";
    else if (normColor.includes("xanh")) badgeClass = "badge-blue";
    else if (normColor.includes("vang")) badgeClass = "badge-gold";
    else if (normColor.includes("tim")) badgeClass = "badge-purple";

    const btnType = normalizeText(card.kieu_nut || "");
    const isNoteOnly = btnType.includes("ghi chu") || !card.link;
    let actionHtml = "";

    if (isNoteOnly) {
      if (card.ten_nut) actionHtml = `<span class="future-status">${escapeHTML(card.ten_nut)}</span>`;
    } else {
      const isExternal = /^https?:\/\//i.test(card.link);
      const targetAttr = isExternal ? `target="_blank" rel="noopener noreferrer"` : "";
      let btnClass = "btn btn-primary";
      let btnStyle = "";

      if (card.kieu_nut && card.kieu_nut.trim().startsWith("#")) {
        btnStyle = `style="background-color:${escapeHTML(card.kieu_nut.trim())}; color:#ffffff;"`;
      } else if (btnType.includes("vien")) btnClass = "btn btn-outline-primary";
      else if (btnType.includes("xanh")) btnClass = "btn btn-blue";

      actionHtml = `<a href="${escapeHTML(card.link)}" ${targetAttr} class="${btnClass}" ${btnStyle}>${escapeHTML(card.ten_nut || "Truy cập")} ${isExternal ? "↗" : ""}</a>`;
    }

    return `
      <div class="interact-card ${isNoteOnly ? "style-dashed" : ""}">
        <div>
          ${card.nhan ? `<div class="interact-badge ${badgeClass}" ${badgeCustomStyle}>${escapeHTML(card.nhan)}</div>` : ""}
          <h3>${escapeHTML(card.tieu_de)}</h3>
          <p>${escapeHTML(card.mo_ta)}</p>
        </div>
        <div>${actionHtml}</div>
      </div>
    `;
  }).join("");
}

function populateFilterDropdowns(projects) {
  const fillSelect = (id, values, defaultLabel) => {
    const select = document.getElementById(id);
    const currentVal = select.value;
    const unique = [...new Set(values.filter(Boolean))].sort((a, b) => b.localeCompare(a, "vi"));
    select.innerHTML = `<option value="">${defaultLabel}</option>` +
      unique.map(v => `<option value="${escapeHTML(v)}">${escapeHTML(v)}</option>`).join("");
    if (unique.includes(currentVal)) select.value = currentVal;
  };

  fillSelect("filter-year", projects.map(p => p.nien_khoa), "Tất cả niên khoá");
  fillSelect("filter-major", projects.map(p => p.nganh), "Tất cả ngành đào tạo");
  fillSelect("filter-department", projects.map(p => p.bo_mon), "Tất cả bộ môn / lĩnh vực");
  fillSelect("filter-status", projects.map(p => p.trang_thai), "Tất cả trạng thái");
}

function applyProjectFilters() {
  const projects = (state.rawData && state.rawData.de_tai) || [];
  const keyword = normalizeText(document.getElementById("search-input").value);
  const year = document.getElementById("filter-year").value;
  const major = document.getElementById("filter-major").value;
  const dept = document.getElementById("filter-department").value;
  const status = document.getElementById("filter-status").value;
  const award = document.getElementById("filter-award").value;

  state.filteredProjects = projects.filter(p => {
    if (year && p.nien_khoa !== year) return false;
    if (major && p.nganh !== major) return false;
    if (dept && p.bo_mon !== dept) return false;
    if (status && p.trang_thai !== status) return false;
    if (state.selectedGvhdId && p.ma_gvhd !== state.selectedGvhdId) return false;

    if (award === "ANY_AWARD") {
      if (!hasValidAward(p.giai_khoa) && !hasValidAward(p.giai_truong) && !hasValidAward(p.giai_bo)) return false;
    } else if (award === "BO" && !hasValidAward(p.giai_bo)) return false;
    else if (award === "TRUONG" && !hasValidAward(p.giai_truong)) return false;
    else if (award === "KHOA" && !hasValidAward(p.giai_khoa)) return false;

    if (keyword) {
      const searchable = normalizeText([
        p.ma_so, p.ten_de_tai, p.sv_chu_nhiem, p.sv_tham_gia, p.gvhd, p.tu_khoa, p.bo_mon, p.nganh
      ].join(" "));
      if (!searchable.includes(keyword)) return false;
    }
    return true;
  });

  state.currentPage = 1;
  document.getElementById("result-count").textContent = state.filteredProjects.length;
  renderProjectsTable();
}

function renderProjectsTable() {
  const tbody = document.getElementById("projects-tbody");
  const total = state.filteredProjects.length;

  if (total === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 32px; color: #64748b;">Không tìm thấy đề tài nào phù hợp với điều kiện lọc hiện tại.</td></tr>`;
    document.getElementById("pagination-controls").innerHTML = "";
    return;
  }

  const startIdx = (state.currentPage - 1) * state.itemsPerPage;
  const pageItems = state.filteredProjects.slice(startIdx, startIdx + state.itemsPerPage);

  tbody.innerHTML = pageItems.map((p, idx) => {
    const globalIndex = startIdx + idx;
    const isOngoing = normalizeText(p.trang_thai).includes("dang thuc hien");
    const statusClass = isOngoing ? "status-ongoing" : "status-done";

    let awardsHtml = "";
    if (hasValidAward(p.giai_bo)) awardsHtml += `<span class="award-badge award-bo">Cấp Bộ: ${escapeHTML(p.giai_bo)}</span>`;
    if (hasValidAward(p.giai_truong)) awardsHtml += `<span class="award-badge award-truong">Cấp Trường: ${escapeHTML(p.giai_truong)}</span>`;
    if (hasValidAward(p.giai_khoa)) awardsHtml += `<span class="award-badge award-khoa">Cấp Khoa: ${escapeHTML(p.giai_khoa)}</span>`;
    if (!awardsHtml) awardsHtml = `<span style="color:#94a3b8; font-size:13px;">—</span>`;

    return `
      <tr>
        <td><strong>${escapeHTML(p.nien_khoa)}</strong></td>
        <td><code>${escapeHTML(p.ma_so || "-")}</code></td>
        <td>
          <div class="project-title-cell">${escapeHTML(p.ten_de_tai)}</div>
          <div class="meta-tags">
            ${p.trang_thai ? `<span class="tag-chip ${statusClass}">${escapeHTML(p.trang_thai)}</span>` : ""}
            ${p.nganh ? `<span class="tag-chip">${escapeHTML(p.nganh)}</span>` : ""}
            ${p.bo_mon ? `<span class="tag-chip">${escapeHTML(p.bo_mon)}</span>` : ""}
          </div>
        </td>
        <td>
          <div class="sv-lead">${escapeHTML(p.sv_chu_nhiem || "Chưa cập nhật")}</div>
          ${p.sv_tham_gia ? `<div class="sv-members">Thành viên: ${escapeHTML(p.sv_tham_gia)}</div>` : ""}
        </td>
        <td>
          <button type="button" class="gvhd-link" data-gvhd-id="${escapeHTML(p.ma_gvhd || "")}" data-gvhd-name="${escapeHTML(p.gvhd || "")}">
            ${escapeHTML(p.gvhd || "-")}
          </button>
        </td>
        <td><div class="award-stack">${awardsHtml}</div></td>
        <td><button type="button" class="btn-detail" data-project-idx="${globalIndex}">Xem thêm</button></td>
      </tr>
    `;
  }).join("");

  renderPagination(total);
}

function renderPagination(totalItems) {
  const totalPages = Math.ceil(totalItems / state.itemsPerPage);
  const container = document.getElementById("pagination-controls");
  if (totalPages <= 1) { container.innerHTML = ""; return; }

  let html = `<button type="button" class="page-btn" ${state.currentPage === 1 ? "disabled" : ""} data-page="${state.currentPage - 1}">‹ Trước</button>`;
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - state.currentPage) <= 2) {
      html += `<button type="button" class="page-btn ${i === state.currentPage ? "active" : ""}" data-page="${i}">${i}</button>`;
    } else if (Math.abs(i - state.currentPage) === 3) {
      html += `<span style="padding: 0 4px; color: #64748b;">...</span>`;
    }
  }
  html += `<button type="button" class="page-btn" ${state.currentPage === totalPages ? "disabled" : ""} data-page="${state.currentPage + 1}">Sau ›</button>`;
  container.innerHTML = html;
}

function openProjectModal(project) {
  if (!project) return;
  document.getElementById("modal-project-meta").textContent =
    `NIÊN KHOÁ ${project.nien_khoa || "--"}  |  MÃ SỐ ĐỀ TÀI: ${project.ma_so || "--"}`;
  document.getElementById("modal-project-title").textContent = project.ten_de_tai || "";

  let membersHtml = "";
  if (project.thanh_vien_chi_tiet && project.thanh_vien_chi_tiet.length > 0) {
    membersHtml = `<ul class="member-list">` + project.thanh_vien_chi_tiet.map(m => {
      const extras = [m.nganh, m.mssv ? `MSSV: ${m.mssv}` : "", m.lop ? `Lớp: ${m.lop}` : ""].filter(Boolean).join(" • ");
      return `<li><strong>${escapeHTML(m.vai_tro)}:</strong> ${escapeHTML(m.ho_ten)} ${extras ? `<span style="color:#64748b;">(${escapeHTML(extras)})</span>` : ""}</li>`;
    }).join("") + `</ul>`;
  } else {
    membersHtml = `
      <div><strong>SV chủ nhiệm:</strong> ${escapeHTML(project.sv_chu_nhiem || "-")}</div>
      ${project.sv_tham_gia ? `<div><strong>SV tham gia:</strong> ${escapeHTML(project.sv_tham_gia)}</div>` : ""}
    `;
  }

  let dynamicExtraHtml = "";
  if (project.thong_tin_bo_sung && Object.keys(project.thong_tin_bo_sung).length > 0) {
    dynamicExtraHtml = Object.entries(project.thong_tin_bo_sung).map(([k, v]) => `
      <div class="detail-item">
        <span class="detail-label">${escapeHTML(k)}</span>
        <div class="detail-value">${escapeHTML(v)}</div>
      </div>
    `).join("");
  }

  document.getElementById("modal-project-body").innerHTML = `
    <div class="detail-grid">
      <div class="detail-item"><span class="detail-label">Giảng viên hướng dẫn</span><div class="detail-value">${escapeHTML(project.gvhd || "-")}</div></div>
      <div class="detail-item"><span class="detail-label">Trạng thái thực hiện</span><div class="detail-value">${escapeHTML(project.trang_thai || "-")}</div></div>
      <div class="detail-item"><span class="detail-label">Ngành đào tạo</span><div class="detail-value">${escapeHTML(project.nganh || "Chưa phân loại")}</div></div>
      <div class="detail-item"><span class="detail-label">Bộ môn / Lĩnh vực</span><div class="detail-value">${escapeHTML(project.bo_mon || "Chưa phân loại")}</div></div>
      <div class="detail-item full"><span class="detail-label">Nhóm sinh viên thực hiện</span><div class="detail-value">${membersHtml}</div></div>
      <div class="detail-item full">
        <span class="detail-label">Thành tích / Giải thưởng đạt được</span>
        <div class="detail-value">Cấp Khoa: <strong>${escapeHTML(project.giai_khoa || "-")}</strong> &nbsp;|&nbsp; Cấp Trường: <strong>${escapeHTML(project.giai_truong || "-")}</strong> &nbsp;|&nbsp; Cấp Bộ: <strong>${escapeHTML(project.giai_bo || "-")}</strong></div>
      </div>
      ${project.tom_tat ? `<div class="detail-item full"><span class="detail-label">Tóm tắt nội dung nghiên cứu</span><div class="detail-value" style="font-weight:400;">${escapeHTML(project.tom_tat)}</div></div>` : ""}
      ${project.tu_khoa ? `<div class="detail-item full"><span class="detail-label">Từ khoá nghiên cứu</span><div class="detail-value">${escapeHTML(project.tu_khoa)}</div></div>` : ""}
      ${dynamicExtraHtml}
      ${project.link_tai_lieu ? `<div class="detail-item full"><span class="detail-label">Tài liệu / Quyết định công nhận</span><div class="detail-value" style="margin-top:6px;"><a href="${escapeHTML(project.link_tai_lieu)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary">Mở tài liệu đính kèm ↗</a></div></div>` : ""}
    </div>
  `;
  document.getElementById("project-modal").classList.remove("hidden");
}

function renderDocuments(docs) {
  const grid = document.getElementById("documents-grid");
  if (!docs.length) {
    grid.innerHTML = `<p style="color:#64748b;">Đang cập nhật văn bản và biểu mẫu.</p>`;
    return;
  }

  grid.innerHTML = docs.map(doc => {
    const ext = (doc.dinh_dang || "FILE").toUpperCase();
    const isRar = ext === "RAR" || ext === "ZIP";
    const btnLabel = isRar ? `Tải bộ biểu mẫu (.${ext})` : (ext === "FOLDER" ? "Mở thư mục biểu mẫu" : `Xem / Tải (.${ext})`);

    return `
      <div class="doc-card">
        <div>
          <span class="doc-ext ${isRar ? "ext-rar" : ""}">${escapeHTML(ext)}</span>
          <h3 class="doc-title">${escapeHTML(doc.ten)}</h3>
          <p class="doc-cat">${escapeHTML(doc.phan_loai || "")}</p>
        </div>
        <a href="${escapeHTML(doc.link)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline-primary">${escapeHTML(btnLabel)} ↗</a>
      </div>
    `;
  }).join("");
}

// ============================================================================
// SỰ KIỆN TƯƠNG TÁC
// ============================================================================
document.addEventListener("DOMContentLoaded", () => {
  loadPortalData(false);

  document.getElementById("btn-refresh-data").addEventListener("click", () => loadPortalData(true));
  document.getElementById("search-input").addEventListener("input", applyProjectFilters);
  ["filter-year", "filter-major", "filter-department", "filter-status", "filter-award"].forEach(id => {
    document.getElementById(id).addEventListener("change", applyProjectFilters);
  });

  document.getElementById("btn-reset-filters").addEventListener("click", () => {
    document.getElementById("search-input").value = "";
    ["filter-year", "filter-major", "filter-department", "filter-status", "filter-award"].forEach(id => {
      document.getElementById(id).value = "";
    });
    state.selectedGvhdId = "";
    document.getElementById("active-gvhd-filter").classList.add("hidden");
    applyProjectFilters();
  });

  document.getElementById("projects-tbody").addEventListener("click", (e) => {
    const gvhdBtn = e.target.closest(".gvhd-link");
    if (gvhdBtn) {
      const id = gvhdBtn.dataset.gvhdId;
      const name = gvhdBtn.dataset.gvhdName;
      if (id) {
        state.selectedGvhdId = id;
        document.getElementById("active-gvhd-name").textContent = name;
        document.getElementById("active-gvhd-filter").classList.remove("hidden");
        applyProjectFilters();
      }
      return;
    }
    const detailBtn = e.target.closest(".btn-detail");
    if (detailBtn) openProjectModal(state.filteredProjects[Number(detailBtn.dataset.projectIdx)]);
  });

  document.getElementById("clear-gvhd-filter").addEventListener("click", () => {
    state.selectedGvhdId = "";
    document.getElementById("active-gvhd-filter").classList.add("hidden");
    applyProjectFilters();
  });

  document.getElementById("pagination-controls").addEventListener("click", (e) => {
    const btn = e.target.closest(".page-btn");
    if (btn && !btn.disabled) {
      state.currentPage = Number(btn.dataset.page);
      renderProjectsTable();
      document.getElementById("tra-cuu-de-tai").scrollIntoView({ behavior: "smooth" });
    }
  });

  // Sự kiện điều khiển Thời gian biểu (Tuần / Tháng, Tiến / Lùi, Lọc nguồn, Nhấn xem chi tiết)
  document.getElementById("schedule-view-tabs").addEventListener("click", (e) => {
    const pill = e.target.closest(".tab-pill");
    if (!pill) return;
    document.querySelectorAll("#schedule-view-tabs .tab-pill").forEach(p => p.classList.remove("active"));
    pill.classList.add("active");
    state.scheduleView = pill.dataset.scheduleView;
    renderSchedule();
  });

  document.getElementById("sched-prev-btn").addEventListener("click", () => {
    const d = state.scheduleAnchorDate;
    if (state.scheduleView === "MONTH") state.scheduleAnchorDate = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    else state.scheduleAnchorDate = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 7);
    renderSchedule();
  });

  document.getElementById("sched-next-btn").addEventListener("click", () => {
    const d = state.scheduleAnchorDate;
    if (state.scheduleView === "MONTH") state.scheduleAnchorDate = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    else state.scheduleAnchorDate = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7);
    renderSchedule();
  });

  document.getElementById("sched-today-btn").addEventListener("click", () => {
    state.scheduleAnchorDate = new Date();
    renderSchedule();
  });

  document.getElementById("sched-date-picker").addEventListener("change", (e) => {
    const picked = parseSheetDate(e.target.value);
    if (picked) {
      state.scheduleAnchorDate = picked;
      renderSchedule();
    }
  });

  document.getElementById("sched-source-filter").addEventListener("change", (e) => {
    state.scheduleSourceFilter = e.target.value;
    renderSchedule();
  });

  document.getElementById("schedule-container").addEventListener("click", (e) => {
    const card = e.target.closest("[data-open-sched-id]");
    if (!card) return;
    const src = card.dataset.openSchedSource;
    const id = card.dataset.openSchedId;
    if (src === "EVENT") openEventDetail(id);
    else if (src === "ANNOUNCEMENT") openAnnouncementDetail(id);
    else openManualScheduleDetail(id);
  });

  // Mở trang đọc chi tiết riêng khi nhấn vào thẻ Thông báo hoặc Seminar
  document.getElementById("announcements-grid").addEventListener("click", (e) => {
    const card = e.target.closest("[data-open-tb]");
    if (card) openAnnouncementDetail(card.dataset.openTb);
  });

  document.getElementById("events-grid").addEventListener("click", (e) => {
    const card = e.target.closest("[data-open-ev]");
    if (card) openEventDetail(card.dataset.openEv);
  });

  document.getElementById("reader-back-btn").addEventListener("click", closeReaderPage);
  document.getElementById("reader-copy-link-btn").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      const btn = document.getElementById("reader-copy-link-btn");
      btn.textContent = "Đã sao chép link ✓";
      setTimeout(() => { btn.textContent = "Sao chép link bài viết"; }, 2000);
    } catch (_) {}
  });

  document.getElementById("event-filter-tabs").addEventListener("click", (e) => {
    const pill = e.target.closest(".tab-pill");
    if (!pill) return;
    document.querySelectorAll("#event-filter-tabs .tab-pill").forEach(p => p.classList.remove("active"));
    pill.classList.add("active");
    state.eventFilter = pill.dataset.eventFilter;
    renderEvents((state.rawData && state.rawData.su_kien) || []);
  });

  const modal = document.getElementById("project-modal");
  document.getElementById("modal-close-btn").addEventListener("click", () => modal.classList.add("hidden"));
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.add("hidden"); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      modal.classList.add("hidden");
      closeReaderPage();
    }
  });
});
