/**
 * CỔNG THÔNG TIN NGHIÊN CỨU KHOA HỌC - KHOA HOÁ HỌC (HCMUE)
 * Đồng bộ 100% với cấu trúc HTML Tailwind CSS & JSON snake_case từ Code.gs
 */

const API_URL = "https://script.google.com/macros/s/AKfycbz-y0kUxEFygO4PxHAw7Z5N06nOGS57TMMr-t6XMjH6PmjNFHDXmQlA-wCwag1IUko6dg/exec";

let APP_DATA = {
  updatedAt: "",
  cauHinh: {},
  deTai: [],
  thongBao: [],
  thoiGianBieu: [],
  congTuongTac: [],
  seminar: [],
  vanBan: [],
  thongKeLichSu: []
};

let UNIFIED_SCHEDULE = [];
let CURRENT_SCHEDULE_VIEW = "week";
let SCHEDULE_REF_DATE = new Date();

let chartNienKhoaInstance = null;
let chartLinhVucInstance = null;

let overviewScrollTimer = null;
let overviewAutoScrollEnabled = true;
let overviewHoverPaused = false;

let tabTbScrollTimer = null;
let tabTbAutoScrollEnabled = false;
let tabTbHoverPaused = false;

// =====================================================================
// HÀM TIỆN ÍCH CHUNG
// =====================================================================
function pick(obj, ...keys) {
  if (!obj) return "";
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== "") {
      return obj[k];
    }
  }
  return "";
}

function isVisible(row) {
  const v = String(pick(row, "hien_thi", "Hiển thị")).trim().toLowerCase();
  return v === "" || v === "có" || v === "true" || v === "1" || v === "yes";
}

function isTruthyFlag(val) {
  const s = String(val || "").trim().toLowerCase();
  return s === "có" || s === "true" || s === "1" || s === "yes" || s === "x";
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function cleanAward(val) {
  const s = String(val || "").trim();
  if (!s || s === "-" || s === "—" || s.toLowerCase() === "không") return "";
  return s;
}

function renderAwardBadges(dt) {
  const gk = cleanAward(pick(dt, "giai_khoa", "Giải cấp Khoa"));
  const gt = cleanAward(pick(dt, "giai_truong", "Giải cấp Trường"));
  const gb = cleanAward(pick(dt, "giai_bo", "Giải cấp Bộ"));
  let html = "";
  if (gb) {
    html += `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-red-50 text-[#C8102E] border border-red-200"><i class="fa-solid fa-medal"></i> Giải ${escapeHtml(gb)} cấp Bộ</span> `;
  }
  if (gt) {
    html += `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200"><i class="fa-solid fa-trophy"></i> Giải ${escapeHtml(gt)} cấp Trường</span> `;
  }
  if (gk) {
    html += `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#EBF3FA] text-[#0B3C78] border border-blue-200"><i class="fa-solid fa-star"></i> Giải ${escapeHtml(gk)} cấp Khoa</span> `;
  }
  return html.trim();
}

// =====================================================================
// XỬ LÝ NGÀY THÁNG TIẾNG VIỆT (dd/mm/yyyy, yyyy-mm-dd, ISO)
// =====================================================================
function parseVnDate(raw) {
  if (!raw) return null;
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return new Date(raw.getFullYear(), raw.getMonth(), raw.getDate());
  }
  const str = String(raw).trim();
  if (!str) return null;

  // Lấy mốc ngày đầu tiên nếu là khoảng ngày (vd: "23/11/2026 - 29/11/2026")
  const firstPart = str.split(/\s+[-–]\s+/)[0].trim();

  // Định dạng dd/mm/yyyy hoặc dd-mm-yyyy
  const dmy = firstPart.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmy) {
    const d = parseInt(dmy[1], 10);
    const m = parseInt(dmy[2], 10) - 1;
    const y = parseInt(dmy[3], 10);
    const dt = new Date(y, m, d);
    return isNaN(dt.getTime()) ? null : dt;
  }

  // Định dạng yyyy-mm-dd hoặc ISO
  const ymd = firstPart.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (ymd) {
    const y = parseInt(ymd[1], 10);
    const m = parseInt(ymd[2], 10) - 1;
    const d = parseInt(ymd[3], 10);
    const dt = new Date(y, m, d);
    return isNaN(dt.getTime()) ? null : dt;
  }

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  }
  return null;
}

function formatDateKey(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDateVn(dateObj) {
  const d = String(dateObj.getDate()).padStart(2, "0");
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const y = dateObj.getFullYear();
  return `${d}/${m}/${y}`;
}

// =====================================================================
// 1. KHỞI TẠO & TẢI DỮ LIỆU TỪ GOOGLE APPS SCRIPT
// =====================================================================
document.addEventListener("DOMContentLoaded", () => {
  setupModalListeners();
  fetchPortalData();
});

async function fetchPortalData() {
  const loadingEl = document.getElementById("loading-screen");
  const errorEl = document.getElementById("error-screen");
  const mainEl = document.getElementById("main-content");

  loadingEl?.classList.remove("hidden");
  errorEl?.classList.add("hidden");
  mainEl?.classList.add("hidden");

  try {
    const response = await fetch(API_URL, { redirect: "follow" });
    if (!response.ok) throw new Error(`HTTP Error ${response.status}`);

    const raw = await response.json();
    if (raw.error) throw new Error(raw.error);

    APP_DATA = {
      updatedAt: pick(raw, "updated_at", "updatedAt"),
      cauHinh: raw.cau_hinh || raw.cauHinh || {},
      deTai: raw.de_tai || raw.deTai || [],
      thongBao: (raw.thong_bao || raw.thong_bao_nckh || raw.thongBao || []).filter(isVisible),
      thoiGianBieu: (raw.thoi_gian_bieu || raw.thoiGianBieu || []).filter(isVisible),
      congTuongTac: (raw.cong_tuong_tac || raw.congTuongTac || []).filter(isVisible),
      seminar: (raw.seminar || raw.seminar_hoi_nghi || raw.seminar || []).filter(isVisible),
      vanBan: (raw.van_ban || raw.van_ban_bieu_mau || raw.vanBan || []).filter(isVisible),
      thongKeLichSu: raw.thong_ke_lich_su || raw.thongKeLichSu || []
    };

    buildUnifiedSchedule();
    renderAllSections();

    loadingEl?.classList.add("hidden");
    mainEl?.classList.remove("hidden");

    startOverviewAutoScroll();
  } catch (err) {
    console.error("Lỗi tải dữ liệu:", err);
    loadingEl?.classList.add("hidden");
    errorEl?.classList.remove("hidden");
    const errMsgEl = document.getElementById("error-message");
    if (errMsgEl) {
      errMsgEl.textContent = `Chi tiết lỗi: ${err.message}. Vui lòng kiểm tra quyền truy cập Web App (Anyone) hoặc kết nối mạng.`;
    }
  }
}

// =====================================================================
// 2. ĐIỀU HƯỚNG TAB
// =====================================================================
function switchTab(tabId) {
  document.querySelectorAll(".nav-btn").forEach(btn => {
    const isTarget = btn.id === `tab-${tabId}`;
    btn.classList.toggle("active", isTarget);
    btn.classList.toggle("border-[#0B3C78]", isTarget);
    btn.classList.toggle("text-[#0B3C78]", isTarget);
    btn.classList.toggle("font-semibold", isTarget);
    btn.classList.toggle("border-transparent", !isTarget);
    btn.classList.toggle("text-slate-600", !isTarget);
    btn.classList.toggle("font-medium", !isTarget);
  });

  document.querySelectorAll(".tab-content").forEach(section => {
    section.classList.toggle("active", section.id === `content-${tabId}`);
  });
}

// =====================================================================
// 3. RENDER TOÀN BỘ GIAO DIỆN
// =====================================================================
function renderAllSections() {
  renderConfigAndHeader();
  renderOverviewKPIs();
  renderOverviewThongBao();
  renderOverviewSchedule();
  renderOverviewCharts();
  renderCongTuongTac();

  populateThongBaoFilter();
  renderThongBaoTab();

  populateScheduleTypeFilter();
  renderScheduleView();

  populateDeTaiFilters();
  applyFilters();

  renderCongTrinhTab();
  renderSeminarTab();
  renderVanBanTab();
}

// --- 3.1 Cấu hình chung, Header & Footer ---
function renderConfigAndHeader() {
  const cfg = APP_DATA.cauHinh || {};

  const tenTruong = pick(cfg, "ten_truong", "Tên trường");
  const tenKhoa = pick(cfg, "ten_khoa", "Tên khoa");
  const tieuDeCong = pick(cfg, "tieu_de_cong", "Tiêu đề cổng");

  if (tenTruong) {
    const el = document.getElementById("header-ten-truong");
    if (el) el.textContent = tenTruong;
  }
  if (tenKhoa) {
    const el = document.getElementById("header-ten-khoa");
    if (el) el.textContent = tenKhoa;
  }
  if (tieuDeCong) {
    const el = document.getElementById("header-tieu-de");
    if (el) el.textContent = tieuDeCong;
  }

  if (tenTruong || tenKhoa) {
    const footerUnit = document.getElementById("footer-ten-don-vi");
    if (footerUnit) {
      footerUnit.textContent = `${(tenKhoa || "KHOA HOÁ HỌC").toUpperCase()} - ${(tenTruong || "TRƯỜNG ĐẠI HỌC SƯ PHẠM THÀNH PHỐ HỒ CHÍ MINH").toUpperCase()}`;
    }
  }

  const diaChi = pick(cfg, "dia_chi", "dia_chi_lien_he", "Địa chỉ");
  if (diaChi) {
    const el = document.getElementById("footer-dia-chi");
    if (el) el.textContent = diaChi.startsWith("Địa chỉ") ? diaChi : `Địa chỉ: ${diaChi}`;
  }

  const logoHeader = pick(cfg, "logo_header", "Logo header");
  if (logoHeader) {
    const imgH = document.getElementById("header-logo");
    const fallbackH = document.getElementById("header-logo-fallback");
    if (imgH) {
      imgH.src = logoHeader;
      imgH.classList.remove("hidden");
      if (fallbackH) fallbackH.classList.add("hidden");
    }
  }

  const bannerBadge = pick(cfg, "banner_badge");
  const bannerTitle = pick(cfg, "banner_title", "tieu_de_banner");
  const bannerDesc = pick(cfg, "banner_desc", "mo_ta_banner");
  if (bannerBadge) {
    const el = document.getElementById("banner-badge");
    if (el) el.innerHTML = `<i class="fa-solid fa-atom mr-1"></i> ${escapeHtml(bannerBadge)}`;
  }
  if (bannerTitle) {
    const el = document.getElementById("banner-title");
    if (el) el.textContent = bannerTitle;
  }
  if (bannerDesc) {
    const el = document.getElementById("banner-desc");
    if (el) el.textContent = bannerDesc;
  }

  // Badge đếm số thông báo trên thanh điều hướng
  const tbBadge = document.getElementById("nav-tb-badge");
  if (tbBadge) {
    if (APP_DATA.thongBao.length > 0) {
      tbBadge.textContent = APP_DATA.thongBao.length;
      tbBadge.classList.remove("hidden");
    } else {
      tbBadge.classList.add("hidden");
    }
  }

  // Nút đăng ký nhanh trên Header
  const firstAction = APP_DATA.congTuongTac[0];
  const headerBtn = document.getElementById("btn-dang-ky-header");
  if (headerBtn && firstAction) {
    const link = pick(firstAction, "link", "link_dang_ky", "lien_ket", "Link đăng ký / Liên kết");
    if (link && !link.startsWith("#")) {
      headerBtn.href = link;
      headerBtn.target = "_blank";
      headerBtn.rel = "noopener";
      headerBtn.removeAttribute("onclick");
    }
  }

  if (APP_DATA.updatedAt) {
    const d = new Date(APP_DATA.updatedAt);
    const updatedEl = document.getElementById("footer-updated");
    if (updatedEl && !isNaN(d.getTime())) {
      updatedEl.textContent = `Dữ liệu đồng bộ trực tuyến lúc ${d.toLocaleString("vi-VN")}`;
    }
  }
}

// --- 3.2 KPI Tổng quan ---
function renderOverviewKPIs() {
  const list = APP_DATA.deTai;
  let totalDeTai = list.length;
  let totalLuotSV = 0;
  let totalDatGiai = 0;
  let totalBaiBao = 0;

  // Cộng thêm thống kê lịch sử (nếu các niên khóa đó chưa có trong danh sách chi tiết)
  const detailedYears = new Set(
    list.map(dt => String(pick(dt, "nien_khoa", "Niên khóa", "Niên khoá")).trim()).filter(Boolean)
  );

  if (Array.isArray(APP_DATA.thongKeLichSu)) {
    APP_DATA.thongKeLichSu.forEach(item => {
      const y = String(pick(item, "nien_khoa", "Niên khoá", "Niên khóa")).trim();
      if (y && !detailedYears.has(y)) {
        totalDeTai += Number(pick(item, "sl_de_tai", "SL đề tài")) || 0;
        totalLuotSV += Number(pick(item, "sl_sv", "SL sinh viên")) || 0;
        totalDatGiai += Number(pick(item, "sl_giai", "SL giải thưởng")) || 0;
        totalBaiBao += Number(pick(item, "sl_bai_bao", "SL bài báo")) || 0;
      }
    });
  }

  list.forEach(dt => {
    if (Array.isArray(dt.thanh_vien_chi_tiet) && dt.thanh_vien_chi_tiet.length > 0) {
      totalLuotSV += dt.thanh_vien_chi_tiet.length;
    } else {
      const cn = String(pick(dt, "sv_chu_nhiem", "SV chủ nhiệm")).trim();
      const tg = String(pick(dt, "sv_tham_gia", "SV tham gia")).trim();
      if (cn && cn !== "-") totalLuotSV += 1;
      if (tg && tg !== "-") {
        totalLuotSV += tg.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean).length;
      }
    }

    const gk = cleanAward(pick(dt, "giai_khoa", "Giải cấp Khoa"));
    const gt = cleanAward(pick(dt, "giai_truong", "Giải cấp Trường"));
    const gb = cleanAward(pick(dt, "giai_bo", "Giải cấp Bộ"));
    if (gk || gt || gb) totalDatGiai += 1;

    const cb = String(pick(dt, "cong_bo", "bai_bao", "Công bố", "Bài báo")).trim();
    if (cb && cb !== "-" && cb !== "—" && cb.toLowerCase() !== "không") {
      totalBaiBao += 1;
    }
  });

  animateNumber("kpi-tong-de-tai", totalDeTai);
  animateNumber("kpi-tong-sv", totalLuotSV);
  animateNumber("kpi-tong-giai", totalDatGiai);
  animateNumber("kpi-tong-bai-bao", totalBaiBao);
}

function animateNumber(elId, target) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (target <= 0) {
    el.textContent = "0";
    return;
  }
  let current = 0;
  const step = Math.max(1, Math.ceil(target / 25));
  const timer = setInterval(() => {
    current += step;
    if (current >= target) {
      el.textContent = target;
      clearInterval(timer);
    } else {
      el.textContent = current;
    }
  }, 20);
}

// --- 3.3 Bảng tin Thông báo NCKH trên Tab Tổng quan + Tự động cuộn dọc ---
function getSortedThongBao() {
  return [...APP_DATA.thongBao].sort((a, b) => {
    const pinA = isTruthyFlag(pick(a, "ghim_noi_bat", "Ghim nổi bật")) ? 1 : 0;
    const pinB = isTruthyFlag(pick(b, "ghim_noi_bat", "Ghim nổi bật")) ? 1 : 0;
    if (pinB !== pinA) return pinB - pinA;

    const dA = parseVnDate(pick(a, "ngay_dang", "Ngày đăng"));
    const dB = parseVnDate(pick(b, "ngay_dang", "Ngày đăng"));
    if (dA && dB) return dB.getTime() - dA.getTime();
    return 0;
  });
}

function renderOverviewThongBao() {
  const container = document.getElementById("overview-tb-scroll");
  if (!container) return;

  const list = getSortedThongBao();
  if (list.length === 0) {
    container.innerHTML = `<div class="py-10 text-center text-xs text-slate-400">Chưa có thông báo nghiên cứu khoa học nào được đăng tải.</div>`;
    return;
  }

  container.innerHTML = list.map(tb => {
    const origIdx = APP_DATA.thongBao.indexOf(tb);
    const isPin = isTruthyFlag(pick(tb, "ghim_noi_bat", "Ghim nổi bật"));
    const phanLoai = pick(tb, "phan_loai", "Phân loại") || "Thông báo";
    const ngayDang = pick(tb, "ngay_dang", "Ngày đăng");
    const hanMoc = pick(tb, "ngay_su_kien", "han_moc", "Ngày sự kiện / Hạn mốc");
    const tieuDe = pick(tb, "tieu_de", "tieu_de_thong_bao", "Tiêu đề thông báo");
    const tomTat = pick(tb, "tom_tat", "tom_tat_ngan", "Tóm tắt ngắn") || pick(tb, "noi_dung", "noi_dung_chi_tiet");

    return `
      <div onclick="openThongBaoModal(${origIdx})" class="group cursor-pointer p-3.5 rounded-xl border ${isPin ? "border-red-200 bg-red-50/30" : "border-slate-200 bg-white"} hover:border-[#0B3C78] hover:shadow-sm transition">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-1.5">
          <div class="flex flex-wrap items-center gap-1.5">
            ${isPin ? `<span class="inline-flex items-center gap-1 text-[10px] font-bold bg-[#C8102E] text-white px-2 py-0.5 rounded-full"><i class="fa-solid fa-thumbtack"></i> Nổi bật</span>` : ""}
            <span class="text-[11px] font-semibold bg-[#EBF3FA] text-[#0B3C78] px-2.5 py-0.5 rounded-full">${escapeHtml(phanLoai)}</span>
            ${hanMoc ? `<span class="text-[11px] font-medium bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full"><i class="fa-regular fa-clock mr-1"></i>Mốc: ${escapeHtml(hanMoc)}</span>` : ""}
          </div>
          ${ngayDang ? `<span class="text-[11px] text-slate-400"><i class="fa-regular fa-calendar mr-1"></i>${escapeHtml(ngayDang)}</span>` : ""}
        </div>
        <h4 class="text-sm font-bold text-slate-800 group-hover:text-[#0B3C78] transition line-clamp-2">${escapeHtml(tieuDe)}</h4>
        ${tomTat ? `<p class="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">${escapeHtml(tomTat)}</p>` : ""}
      </div>
    `;
  }).join("");

  container.onmouseenter = () => { overviewHoverPaused = true; };
  container.onmouseleave = () => { overviewHoverPaused = false; };
}

function startOverviewAutoScroll() {
  if (overviewScrollTimer) clearInterval(overviewScrollTimer);
  const container = document.getElementById("overview-tb-scroll");
  if (!container) return;

  overviewScrollTimer = setInterval(() => {
    if (!overviewAutoScrollEnabled || overviewHoverPaused) return;
    if (container.scrollHeight <= container.clientHeight + 4) return;

    if (container.scrollTop + container.clientHeight >= container.scrollHeight - 2) {
      container.scrollTop = 0;
    } else {
      container.scrollTop += 1;
    }
  }, 45);
}

function toggleAutoScroll() {
  overviewAutoScrollEnabled = !overviewAutoScrollEnabled;
  const btn = document.getElementById("btn-toggle-auto-scroll");
  if (btn) {
    btn.innerHTML = overviewAutoScrollEnabled
      ? `<i class="fa-solid fa-pause text-[10px]"></i><span>Tạm dừng</span>`
      : `<i class="fa-solid fa-play text-[10px]"></i><span>Tiếp tục</span>`;
  }
}

// --- 3.4 Lịch Hoạt động & Hạn mốc trên Tab Tổng quan ---
function renderOverviewSchedule() {
  const container = document.getElementById("overview-schedule-list");
  if (!container) return;

  if (UNIFIED_SCHEDULE.length === 0) {
    container.innerHTML = `<div class="py-10 text-center text-xs text-slate-400">Chưa có mốc thời gian hoạt động nào được cập nhật.</div>`;
    return;
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // Ưu tiên sự kiện từ hôm nay trở đi, nếu ít thì lấy thêm sự kiện gần nhất
  const upcoming = UNIFIED_SCHEDULE.filter(ev => ev.dateObj && ev.dateObj >= todayStart);
  const displayList = (upcoming.length >= 4 ? upcoming : UNIFIED_SCHEDULE).slice(0, 6);

  container.innerHTML = displayList.map(ev => {
    const idx = UNIFIED_SCHEDULE.indexOf(ev);
    const badgeStyle = getSourceStyle(ev.source);
    return `
      <div onclick="openScheduleItemModal(${idx})" class="cursor-pointer p-3 rounded-xl border border-slate-200 hover:border-[#0B3C78] bg-white hover:bg-slate-50/70 transition flex items-start gap-3">
        <div class="w-12 shrink-0 rounded-lg ${badgeStyle.dateBox} text-center py-1.5 px-1">
          <div class="text-[10px] font-bold uppercase opacity-85">${ev.dateObj ? `Thg ${ev.dateObj.getMonth() + 1}` : "Mốc"}</div>
          <div class="text-base font-extrabold leading-tight">${ev.dateObj ? String(ev.dateObj.getDate()).padStart(2, "0") : "—"}</div>
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5 mb-0.5">
            <span class="w-2 h-2 rounded-full ${badgeStyle.dot}"></span>
            <span class="text-[10px] font-bold uppercase tracking-wide ${badgeStyle.text}">${escapeHtml(ev.sourceLabel)}</span>
            ${ev.timeText ? `<span class="text-[11px] text-slate-400">• ${escapeHtml(ev.timeText)}</span>` : ""}
          </div>
          <h4 class="text-xs sm:text-sm font-bold text-slate-800 line-clamp-2">${escapeHtml(ev.title)}</h4>
          ${ev.location ? `<p class="text-[11px] text-slate-500 mt-0.5 truncate"><i class="fa-solid fa-location-dot mr-1 text-slate-400"></i>${escapeHtml(ev.location)}</p>` : ""}
        </div>
      </div>
    `;
  }).join("");
}

// --- 3.5 Biểu đồ Chart.js ---
function renderOverviewCharts() {
  const list = APP_DATA.deTai;

  // 1. Biểu đồ cột theo Niên khoá
  const yearMap = {};
  if (Array.isArray(APP_DATA.thongKeLichSu)) {
    APP_DATA.thongKeLichSu.forEach(item => {
      const y = String(pick(item, "nien_khoa", "Niên khoá", "Niên khóa")).trim();
      const sl = Number(pick(item, "sl_de_tai", "SL đề tài")) || 0;
      if (y && sl > 0) yearMap[y] = sl;
    });
  }

  const countedYears = new Set();
  list.forEach(dt => {
    const y = String(pick(dt, "nien_khoa", "Niên khóa", "Niên khoá")).trim() || "Khác";
    if (!countedYears.has(y)) {
      yearMap[y] = 0;
      countedYears.add(y);
    }
    yearMap[y] += 1;
  });

  const years = Object.keys(yearMap).sort();
  const yearCounts = years.map(y => yearMap[y]);

  const ctxYear = document.getElementById("chart-nien-khoa");
  if (ctxYear) {
    if (chartNienKhoaInstance) chartNienKhoaInstance.destroy();
    chartNienKhoaInstance = new Chart(ctxYear, {
      type: "bar",
      data: {
        labels: years,
        datasets: [{
          label: "Số lượng đề tài",
          data: yearCounts,
          backgroundColor: "#0B3C78",
          borderRadius: 6,
          maxBarThickness: 48
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } },
          x: { grid: { display: false } }
        }
      }
    });
  }

  // 2. Biểu đồ tròn cơ cấu theo Lĩnh vực / Bộ môn
  const deptMap = {};
  list.forEach(dt => {
    const d = String(pick(dt, "bo_mon", "Bộ môn / Lĩnh vực")).trim() || "Chưa phân loại";
    deptMap[d] = (deptMap[d] || 0) + 1;
  });
  const depts = Object.keys(deptMap);
  const deptCounts = depts.map(d => deptMap[d]);

  const palette = ["#0B3C78", "#1D63B8", "#C8102E", "#D97706", "#059669", "#7C3AED", "#0891B2"];
  const ctxDept = document.getElementById("chart-linh-vuc");
  if (ctxDept) {
    if (chartLinhVucInstance) chartLinhVucInstance.destroy();
    chartLinhVucInstance = new Chart(ctxDept, {
      type: "doughnut",
      data: {
        labels: depts,
        datasets: [{
          data: deptCounts,
          backgroundColor: depts.map((_, i) => palette[i % palette.length]),
          borderWidth: 2,
          borderColor: "#ffffff"
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "right", labels: { boxWidth: 12, font: { size: 12 } } }
        }
      }
    });
  }
}

// --- 3.6 Cổng Tương tác & Dịch vụ Trực tuyến ---
function renderCongTuongTac() {
  const grid = document.getElementById("cong-tuong-tac-grid");
  if (!grid) return;

  if (APP_DATA.congTuongTac.length === 0) {
    grid.innerHTML = `<div class="col-span-full bg-white p-6 rounded-xl border border-slate-200 text-center text-xs text-slate-400">Chưa có kênh tương tác trực tuyến nào được cấu hình.</div>`;
    return;
  }

  grid.innerHTML = APP_DATA.congTuongTac.map(item => {
    const mauNhan = String(pick(item, "mau_nhan", "Màu nhãn")).toLowerCase();
    const kieuNut = String(pick(item, "kieu_nut", "kieu_nut_bam", "Kiểu nút bấm")).toLowerCase();
    const link = String(pick(item, "link", "link_dang_ky", "lien_ket", "Link đăng ký / Liên kết")).trim();
    const chuNut = pick(item, "chu_nut", "chu_tren_nut_bam", "Chữ trên nút bấm") || "Truy cập ngay";
    const nhan = pick(item, "nhan_phan_loai", "nhan", "Nhãn phân loại") || "DỊCH VỤ";
    const tieuDe = pick(item, "tieu_de", "tieu_de_the", "Tiêu đề thẻ");
    const noiDung = pick(item, "noi_dung", "noi_dung_mo_ta", "Nội dung mô tả");

    let tagClass = "bg-[#EBF3FA] text-[#0B3C78]";
    if (mauNhan.includes("đỏ") || mauNhan.includes("red")) tagClass = "bg-red-50 text-[#C8102E]";
    else if (mauNhan.includes("vàng") || mauNhan.includes("cam") || mauNhan.includes("amber")) tagClass = "bg-amber-50 text-amber-700";
    else if (mauNhan.includes("xanh lá") || mauNhan.includes("green")) tagClass = "bg-emerald-50 text-emerald-700";

    let buttonHtml = "";
    if (kieuNut.includes("ghi chú") || !link || link === "-") {
      buttonHtml = `<div class="mt-4 pt-3 border-t border-slate-100 text-xs font-medium text-slate-500 flex items-center gap-1.5"><i class="fa-solid fa-circle-info text-[#0B3C78]"></i><span>${escapeHtml(chuNut)}</span></div>`;
    } else {
      const btnClass = kieuNut.includes("đỏ")
        ? "bg-[#C8102E] hover:bg-red-800 text-white"
        : "bg-[#0B3C78] hover:bg-[#072752] text-white";

      if (link.startsWith("#")) {
        const targetTab = link.replace("#", "").replace("van-ban-bieu-mau", "van-ban");
        buttonHtml = `
          <div class="mt-4 pt-3 border-t border-slate-100">
            <button onclick="switchTab('${escapeHtml(targetTab)}'); window.scrollTo({top:0, behavior:'smooth'});" class="w-full py-2.5 px-4 rounded-lg text-xs font-semibold ${btnClass} transition flex items-center justify-center gap-2 shadow-xs">
              <span>${escapeHtml(chuNut)}</span><i class="fa-solid fa-arrow-right"></i>
            </button>
          </div>`;
      } else {
        buttonHtml = `
          <div class="mt-4 pt-3 border-t border-slate-100">
            <a href="${escapeHtml(link)}" target="_blank" rel="noopener" class="w-full py-2.5 px-4 rounded-lg text-xs font-semibold ${btnClass} transition flex items-center justify-center gap-2 shadow-xs">
              <span>${escapeHtml(chuNut)}</span><i class="fa-solid fa-arrow-up-right-from-square"></i>
            </a>
          </div>`;
      }
    }

    return `
      <div class="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition flex flex-col justify-between">
        <div>
          <span class="inline-block text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${tagClass} mb-3">${escapeHtml(nhan)}</span>
          <h4 class="text-base font-bold text-slate-900 mb-2 leading-snug">${escapeHtml(tieuDe)}</h4>
          <p class="text-xs sm:text-sm text-slate-600 leading-relaxed">${escapeHtml(noiDung)}</p>
        </div>
        ${buttonHtml}
      </div>
    `;
  }).join("");
}

// =====================================================================
// 4. TAB 2: THÔNG BÁO NCKH
// =====================================================================
function populateThongBaoFilter() {
  const select = document.getElementById("tb-filter-loai");
  if (!select) return;

  const categories = new Set();
  APP_DATA.thongBao.forEach(tb => {
    const cat = String(pick(tb, "phan_loai", "Phân loại")).trim();
    if (cat) categories.add(cat);
  });

  select.innerHTML = `<option value="ALL">Tất cả phân loại</option>`;
  [...categories].sort().forEach(cat => {
    select.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`);
  });
}

function renderThongBaoTab() {
  const grid = document.getElementById("thong-bao-grid");
  if (!grid) return;

  const keyword = (document.getElementById("tb-search")?.value || "").trim().toLowerCase();
  const catFilter = document.getElementById("tb-filter-loai")?.value || "ALL";
  const onlyPinned = document.getElementById("tb-filter-pinned")?.checked || false;

  const sorted = getSortedThongBao();
  const filtered = sorted.filter(tb => {
    const isPin = isTruthyFlag(pick(tb, "ghim_noi_bat", "Ghim nổi bật"));
    if (onlyPinned && !isPin) return false;

    const cat = String(pick(tb, "phan_loai", "Phân loại")).trim();
    if (catFilter !== "ALL" && cat !== catFilter) return false;

    if (keyword) {
      const hay = `${pick(tb, "tieu_de", "tieu_de_thong_bao")} ${pick(tb, "tom_tat", "tom_tat_ngan")} ${pick(tb, "noi_dung", "noi_dung_chi_tiet")} ${cat}`.toLowerCase();
      if (!hay.includes(keyword)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="col-span-full bg-white py-12 px-4 rounded-xl border border-slate-200 text-center text-sm text-slate-500">Không tìm thấy thông báo nào phù hợp với điều kiện lọc.</div>`;
    return;
  }

  grid.innerHTML = filtered.map(tb => {
    const origIdx = APP_DATA.thongBao.indexOf(tb);
    const isPin = isTruthyFlag(pick(tb, "ghim_noi_bat", "Ghim nổi bật"));
    const phanLoai = pick(tb, "phan_loai", "Phân loại") || "Thông báo";
    const ngayDang = pick(tb, "ngay_dang", "Ngày đăng");
    const hanMoc = pick(tb, "ngay_su_kien", "han_moc", "Ngày sự kiện / Hạn mốc");
    const tieuDe = pick(tb, "tieu_de", "tieu_de_thong_bao", "Tiêu đề thông báo");
    const tomTat = pick(tb, "tom_tat", "tom_tat_ngan", "Tóm tắt ngắn") || pick(tb, "noi_dung", "noi_dung_chi_tiet");
    const link = pick(tb, "link", "link_dinh_kem", "link_dang_ky", "Link đính kèm / Đăng ký");
    const tenNut = pick(tb, "ten_nut", "ten_nut_lien_ket", "Tên nút liên kết") || "Tài liệu / Đăng ký";

    return `
      <article class="bg-white rounded-xl border ${isPin ? "border-red-200 ring-1 ring-red-100" : "border-slate-200"} p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between">
        <div>
          <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div class="flex flex-wrap items-center gap-1.5">
              ${isPin ? `<span class="inline-flex items-center gap-1 text-[11px] font-bold bg-[#C8102E] text-white px-2.5 py-0.5 rounded-full"><i class="fa-solid fa-thumbtack"></i> Ghim nổi bật</span>` : ""}
              <span class="text-xs font-semibold bg-[#EBF3FA] text-[#0B3C78] px-2.5 py-0.5 rounded-full">${escapeHtml(phanLoai)}</span>
            </div>
            ${ngayDang ? `<span class="text-xs text-slate-400"><i class="fa-regular fa-calendar mr-1"></i>${escapeHtml(ngayDang)}</span>` : ""}
          </div>

          <h3 onclick="openThongBaoModal(${origIdx})" class="cursor-pointer text-base font-bold text-slate-900 hover:text-[#0B3C78] transition leading-snug mb-2">
            ${escapeHtml(tieuDe)}
          </h3>

          ${hanMoc ? `<div class="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-lg mb-2.5"><i class="fa-solid fa-hourglass-half"></i> Hạn mốc / Thời gian: ${escapeHtml(hanMoc)}</div>` : ""}

          <p class="text-xs sm:text-sm text-slate-600 line-clamp-3 leading-relaxed">${escapeHtml(tomTat)}</p>
        </div>

        <div class="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
          <button onclick="openThongBaoModal(${origIdx})" class="text-xs font-semibold text-[#0B3C78] hover:underline flex items-center gap-1">
            <i class="fa-solid fa-book-open"></i> Đọc chi tiết
          </button>
          ${link && link !== "-" ? `
            <a href="${escapeHtml(link)}" target="_blank" rel="noopener" class="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#0B3C78] hover:bg-[#072752] text-white transition">
              <span>${escapeHtml(tenNut)}</span><i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
            </a>
          ` : ""}
        </div>
      </article>
    `;
  }).join("");
}

function toggleTabTbAutoScroll() {
  tabTbAutoScrollEnabled = !tabTbAutoScrollEnabled;
  const btn = document.getElementById("btn-tb-tab-autoscroll");
  const container = document.getElementById("thong-bao-scroll-container");

  if (btn) {
    btn.innerHTML = tabTbAutoScrollEnabled
      ? `<i class="fa-solid fa-arrows-up-down text-[#C8102E]"></i><span>Cuộn tự động: Bật</span>`
      : `<i class="fa-solid fa-arrows-up-down text-[#0B3C78]"></i><span>Cuộn tự động: Tắt</span>`;
  }

  if (tabTbScrollTimer) clearInterval(tabTbScrollTimer);
  if (tabTbAutoScrollEnabled && container) {
    container.onmouseenter = () => { tabTbHoverPaused = true; };
    container.onmouseleave = () => { tabTbHoverPaused = false; };
    tabTbScrollTimer = setInterval(() => {
      if (!tabTbAutoScrollEnabled || tabTbHoverPaused) return;
      if (container.scrollHeight <= container.clientHeight + 4) return;
      if (container.scrollTop + container.clientHeight >= container.scrollHeight - 2) {
        container.scrollTop = 0;
      } else {
        container.scrollTop += 1;
      }
    }, 45);
  }
}

// =====================================================================
// 5. TAB 3: THỜI GIAN BIỂU TÍCH HỢP 3 NGUỒN (TUẦN / THÁNG / DANH SÁCH)
// =====================================================================
function buildUnifiedSchedule() {
  const items = [];

  // Nguồn 1: Lịch hoạt động NCKH nhập trực tiếp
  APP_DATA.thoiGianBieu.forEach(row => {
    const startRaw = pick(row, "ngay_bat_dau", "Ngày bắt đầu");
    const endRaw = pick(row, "ngay_ket_thuc", "Ngày kết thúc");
    const dStart = parseVnDate(startRaw);
    const dEnd = parseVnDate(endRaw) || dStart;
    const buoi = pick(row, "buoi_ca", "Buổi / Ca");
    const gio = pick(row, "gio_cu_the", "Giờ cụ thể");
    const timeText = [buoi, gio].filter(Boolean).join(" • ");

    items.push({
      source: "MANUAL",
      sourceLabel: "Lịch hoạt động NCKH",
      type: pick(row, "phan_loai", "Phân loại") || "Hoạt động NCKH",
      title: pick(row, "ten_hoat_dong", "Tên hoạt động"),
      dateObj: dStart,
      endDateObj: dEnd,
      dateDisplay: endRaw && endRaw !== startRaw ? `${startRaw} – ${endRaw}` : (startRaw || "Đang cập nhật"),
      timeText,
      location: pick(row, "dia_diem", "Địa điểm"),
      organizer: pick(row, "don_vi_phu_trach", "phu_trach", "Đơn vị / Phụ trách"),
      summary: "",
      body: pick(row, "noi_dung", "ghi_chu", "Nội dung / Ghi chú"),
      link: pick(row, "link", "link_lien_ket", "Link liên kết"),
      linkText: "Tham gia / Tài liệu"
    });
  });

  // Nguồn 2: Đồng bộ từ Seminar & Hội thảo
  APP_DATA.seminar.forEach(s => {
    const rawTime = pick(s, "ngay_bat_dau", "thoi_gian", "Thời gian");
    const dObj = parseVnDate(rawTime);
    items.push({
      source: "SEMINAR",
      sourceLabel: "Seminar & Hội thảo",
      type: pick(s, "loai_hoat_dong", "Loại hoạt động") || "Seminar khoa học",
      title: pick(s, "ten_su_kien", "Tên sự kiện"),
      dateObj: dObj,
      endDateObj: dObj,
      dateDisplay: rawTime || "Đang cập nhật",
      timeText: pick(s, "gio_cu_the") || "",
      location: pick(s, "dia_diem", "Địa điểm"),
      organizer: pick(s, "dien_gia", "dien_gia_don_vi", "Diễn giả / Đơn vị"),
      summary: pick(s, "dien_gia", "dien_gia_don_vi") ? `Báo cáo viên: ${pick(s, "dien_gia", "dien_gia_don_vi")}` : "",
      body: pick(s, "tom_tat", "tom_tat_noi_dung", "Tóm tắt nội dung"),
      link: pick(s, "link_dang_ky", "link_tai_lieu", "Link đăng ký (Form)"),
      linkText: "Đăng ký / Tài liệu Seminar"
    });
  });

  // Nguồn 3: Đồng bộ hạn mốc từ Thông báo NCKH
  APP_DATA.thongBao.forEach(tb => {
    const hanMoc = pick(tb, "ngay_su_kien", "han_moc", "Ngày sự kiện / Hạn mốc");
    if (!hanMoc) return;
    const dObj = parseVnDate(hanMoc);
    items.push({
      source: "THONGBAO",
      sourceLabel: "Hạn mốc / Thông báo",
      type: pick(tb, "phan_loai", "Phân loại") || "Mốc thông báo",
      title: pick(tb, "tieu_de", "tieu_de_thong_bao", "Tiêu đề thông báo"),
      dateObj: dObj,
      endDateObj: dObj,
      dateDisplay: hanMoc,
      timeText: "",
      location: "Khoa Hoá học - HCMUE",
      organizer: "Trợ lý NCKH Khoa",
      summary: pick(tb, "tom_tat", "tom_tat_ngan", "Tóm tắt ngắn"),
      body: pick(tb, "noi_dung", "noi_dung_chi_tiet") || pick(tb, "tom_tat", "tom_tat_ngan"),
      link: pick(tb, "link", "link_dinh_kem", "link_dang_ky", "Link đính kèm / Đăng ký"),
      linkText: pick(tb, "ten_nut", "ten_nut_lien_ket") || "Xem thông báo / Nộp hồ sơ"
    });
  });

  items.sort((a, b) => {
    if (a.dateObj && b.dateObj) return a.dateObj.getTime() - b.dateObj.getTime();
    if (a.dateObj) return -1;
    if (b.dateObj) return 1;
    return 0;
  });

  UNIFIED_SCHEDULE = items;
}

function getSourceStyle(source) {
  if (source === "SEMINAR") {
    return {
      dot: "bg-emerald-600",
      text: "text-emerald-700",
      pill: "bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100",
      dateBox: "bg-emerald-50 text-emerald-700 border border-emerald-200"
    };
  }
  if (source === "THONGBAO") {
    return {
      dot: "bg-[#C8102E]",
      text: "text-[#C8102E]",
      pill: "bg-red-50 text-[#C8102E] border-red-200 hover:bg-red-100",
      dateBox: "bg-red-50 text-[#C8102E] border border-red-200"
    };
  }
  return {
    dot: "bg-[#0B3C78]",
    text: "text-[#0B3C78]",
    pill: "bg-[#EBF3FA] text-[#0B3C78] border-blue-200 hover:bg-blue-100",
    dateBox: "bg-[#EBF3FA] text-[#0B3C78] border border-blue-200"
  };
}

function populateScheduleTypeFilter() {
  const select = document.getElementById("tgb-filter-type");
  if (!select) return;
  const types = new Set(UNIFIED_SCHEDULE.map(i => i.type).filter(Boolean));
  select.innerHTML = `<option value="ALL">Tất cả phân loại hoạt động</option>`;
  [...types].sort().forEach(t => {
    select.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`);
  });
}

function setScheduleView(view) {
  CURRENT_SCHEDULE_VIEW = view;
  ["week", "month", "list"].forEach(v => {
    const btn = document.getElementById(`btn-view-${v}`);
    if (!btn) return;
    const active = v === view;
    btn.classList.toggle("bg-white", active);
    btn.classList.toggle("text-[#0B3C78]", active);
    btn.classList.toggle("shadow-sm", active);
    btn.classList.toggle("text-slate-600", !active);
  });
  renderScheduleView();
}

function navigateSchedule(delta) {
  const d = new Date(SCHEDULE_REF_DATE);
  if (CURRENT_SCHEDULE_VIEW === "week") {
    d.setDate(d.getDate() + delta * 7);
  } else {
    d.setMonth(d.getMonth() + delta);
  }
  SCHEDULE_REF_DATE = d;
  renderScheduleView();
}

function resetScheduleToday() {
  SCHEDULE_REF_DATE = new Date();
  renderScheduleView();
}

function getFilteredSchedule() {
  const kw = (document.getElementById("tgb-search")?.value || "").trim().toLowerCase();
  const src = document.getElementById("tgb-filter-source")?.value || "ALL";
  const type = document.getElementById("tgb-filter-type")?.value || "ALL";

  return UNIFIED_SCHEDULE.filter(ev => {
    if (src !== "ALL" && ev.source !== src) return false;
    if (type !== "ALL" && ev.type !== type) return false;
    if (kw) {
      const hay = `${ev.title} ${ev.location} ${ev.organizer} ${ev.body} ${ev.type}`.toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
}

function eventOccursOnDay(ev, dayObj) {
  if (!ev.dateObj) return false;
  const t = new Date(dayObj.getFullYear(), dayObj.getMonth(), dayObj.getDate()).getTime();
  const s = new Date(ev.dateObj.getFullYear(), ev.dateObj.getMonth(), ev.dateObj.getDate()).getTime();
  const e = ev.endDateObj
    ? new Date(ev.endDateObj.getFullYear(), ev.endDateObj.getMonth(), ev.endDateObj.getDate()).getTime()
    : s;
  return t >= s && t <= e;
}

function renderScheduleView() {
  const container = document.getElementById("schedule-container");
  const labelEl = document.getElementById("schedule-period-label");
  if (!container) return;

  const filtered = getFilteredSchedule();
  const today = new Date();
  const todayKey = formatDateKey(today);

  if (CURRENT_SCHEDULE_VIEW === "week") {
    // Tính thứ Hai đầu tuần
    const ref = new Date(SCHEDULE_REF_DATE.getFullYear(), SCHEDULE_REF_DATE.getMonth(), SCHEDULE_REF_DATE.getDate());
    const dayOfWeek = ref.getDay(); // 0 = CN, 1 = T2
    const diffToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(ref);
    monday.setDate(ref.getDate() + diffToMon);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    if (labelEl) {
      labelEl.textContent = `Tuần ${formatDateVn(monday)} – ${formatDateVn(sunday)}`;
    }

    const dayNames = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ nhật"];
    let colsHtml = "";

    for (let i = 0; i < 7; i++) {
      const cur = new Date(monday);
      cur.setDate(monday.getDate() + i);
      const isToday = formatDateKey(cur) === todayKey;
      const dayEvents = filtered.filter(ev => eventOccursOnDay(ev, cur));

      colsHtml += `
        <div class="border-b lg:border-b-0 lg:border-r last:border-r-0 border-slate-200 flex flex-col min-h-[160px] lg:min-h-[280px] ${isToday ? "bg-blue-50/35" : "bg-white"}">
          <div class="px-3 py-2.5 border-b border-slate-100 flex items-center justify-between ${isToday ? "bg-[#EBF3FA]" : "bg-slate-50/70"}">
            <span class="text-xs font-bold ${isToday ? "text-[#0B3C78]" : "text-slate-600"}">${dayNames[i]}</span>
            <span class="text-xs font-extrabold px-2 py-0.5 rounded-full ${isToday ? "bg-[#0B3C78] text-white" : "text-slate-700"}">
              ${String(cur.getDate()).padStart(2, "0")}/${String(cur.getMonth() + 1).padStart(2, "0")}
            </span>
          </div>
          <div class="p-2 space-y-2 flex-1">
            ${dayEvents.length === 0
              ? `<p class="text-[11px] text-slate-300 text-center py-6 select-none">—</p>`
              : dayEvents.map(ev => {
                  const idx = UNIFIED_SCHEDULE.indexOf(ev);
                  const st = getSourceStyle(ev.source);
                  return `
                    <div onclick="openScheduleItemModal(${idx})" class="cursor-pointer p-2 rounded-lg border text-xs transition ${st.pill}">
                      <div class="font-bold line-clamp-2 leading-snug">${escapeHtml(ev.title)}</div>
                      ${ev.timeText ? `<div class="text-[10px] opacity-80 mt-1"><i class="fa-regular fa-clock mr-1"></i>${escapeHtml(ev.timeText)}</div>` : ""}
                      ${ev.location ? `<div class="text-[10px] opacity-80 truncate"><i class="fa-solid fa-location-dot mr-1"></i>${escapeHtml(ev.location)}</div>` : ""}
                    </div>
                  `;
                }).join("")}
          </div>
        </div>
      `;
    }

    container.innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-7">${colsHtml}</div>`;
    return;
  }

  if (CURRENT_SCHEDULE_VIEW === "month") {
    const year = SCHEDULE_REF_DATE.getFullYear();
    const month = SCHEDULE_REF_DATE.getMonth();
    if (labelEl) {
      labelEl.textContent = `Tháng ${String(month + 1).padStart(2, "0")}/${year}`;
    }

    const firstDay = new Date(year, month, 1);
    const startOffset = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

    const headers = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ nhật"]
      .map(d => `<div class="py-2.5 px-2 text-center text-xs font-bold text-slate-600 bg-slate-50 border-b border-r last:border-r-0 border-slate-200">${d}</div>`)
      .join("");

    let cellsHtml = "";
    for (let cell = 0; cell < totalCells; cell++) {
      const dayNum = cell - startOffset + 1;
      const cur = new Date(year, month, dayNum);
      const inCurrentMonth = dayNum >= 1 && dayNum <= daysInMonth;
      const isToday = formatDateKey(cur) === todayKey;
      const dayEvents = filtered.filter(ev => eventOccursOnDay(ev, cur));

      cellsHtml += `
        <div class="min-h-[105px] p-1.5 border-b border-r border-slate-200 ${inCurrentMonth ? (isToday ? "bg-blue-50/40" : "bg-white") : "bg-slate-50/70 text-slate-400"}">
          <div class="flex justify-between items-center mb-1">
            <span class="text-xs font-bold px-1.5 py-0.5 rounded-full ${isToday ? "bg-[#0B3C78] text-white" : (inCurrentMonth ? "text-slate-700" : "text-slate-400")}">
              ${cur.getDate()}
            </span>
          </div>
          <div class="space-y-1">
            ${dayEvents.slice(0, 3).map(ev => {
              const idx = UNIFIED_SCHEDULE.indexOf(ev);
              const st = getSourceStyle(ev.source);
              return `
                <div onclick="openScheduleItemModal(${idx})" title="${escapeHtml(ev.title)}" class="cursor-pointer px-1.5 py-0.5 rounded border text-[10px] font-semibold truncate ${st.pill}">
                  ${escapeHtml(ev.title)}
                </div>
              `;
            }).join("")}
            ${dayEvents.length > 3 ? `<div class="text-[10px] font-semibold text-slate-500 pl-1">+${dayEvents.length - 3} hoạt động</div>` : ""}
          </div>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="overflow-x-auto">
        <div class="min-w-[760px]">
          <div class="grid grid-cols-7">${headers}</div>
          <div class="grid grid-cols-7">${cellsHtml}</div>
        </div>
      </div>
    `;
    return;
  }

  // Chế độ Danh sách (list)
  if (labelEl) {
    labelEl.textContent = `Toàn bộ Lịch hoạt động & Hạn mốc (${filtered.length} mục)`;
  }

  if (filtered.length === 0) {
    container.innerHTML = `<div class="py-12 text-center text-sm text-slate-500">Không tìm thấy hoạt động hay mốc thời gian nào phù hợp.</div>`;
    return;
  }

  container.innerHTML = `
    <div class="divide-y divide-slate-100">
      ${filtered.map(ev => {
        const idx = UNIFIED_SCHEDULE.indexOf(ev);
        const st = getSourceStyle(ev.source);
        return `
          <div onclick="openScheduleItemModal(${idx})" class="cursor-pointer p-4 sm:p-5 hover:bg-slate-50 transition flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div class="flex items-start gap-3.5">
              <div class="w-14 shrink-0 rounded-xl ${st.dateBox} text-center py-2 px-1">
                <div class="text-[10px] font-bold uppercase">${ev.dateObj ? `Thg ${ev.dateObj.getMonth() + 1}` : "Mốc"}</div>
                <div class="text-lg font-extrabold leading-tight">${ev.dateObj ? String(ev.dateObj.getDate()).padStart(2, "0") : "—"}</div>
                <div class="text-[10px] opacity-75">${ev.dateObj ? ev.dateObj.getFullYear() : ""}</div>
              </div>
              <div>
                <div class="flex flex-wrap items-center gap-2 mb-1">
                  <span class="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${st.pill}">
                    <span class="w-1.5 h-1.5 rounded-full ${st.dot}"></span>${escapeHtml(ev.sourceLabel)}
                  </span>
                  <span class="text-xs text-slate-500 font-medium">${escapeHtml(ev.dateDisplay)} ${ev.timeText ? `(${escapeHtml(ev.timeText)})` : ""}</span>
                </div>
                <h4 class="text-sm sm:text-base font-bold text-slate-900 hover:text-[#0B3C78]">${escapeHtml(ev.title)}</h4>
                <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 mt-1">
                  ${ev.location ? `<span><i class="fa-solid fa-location-dot mr-1 text-slate-400"></i>${escapeHtml(ev.location)}</span>` : ""}
                  ${ev.organizer ? `<span><i class="fa-solid fa-user-tie mr-1 text-slate-400"></i>${escapeHtml(ev.organizer)}</span>` : ""}
                </div>
              </div>
            </div>
            <div class="shrink-0 self-end sm:self-center">
              <span class="inline-flex items-center gap-1 text-xs font-semibold text-[#0B3C78] px-3 py-1.5 rounded-lg bg-[#EBF3FA]">
                Chi tiết <i class="fa-solid fa-chevron-right text-[10px]"></i>
              </span>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

// =====================================================================
// 6. TAB 4: ĐỀ TÀI SV NCKH
// =====================================================================
function populateDeTaiFilters() {
  const yearSet = new Set();
  const deptSet = new Set();

  APP_DATA.deTai.forEach(dt => {
    const y = String(pick(dt, "nien_khoa", "Niên khóa", "Niên khoá")).trim();
    const d = String(pick(dt, "bo_mon", "Bộ môn / Lĩnh vực")).trim();
    if (y) yearSet.add(y);
    if (d) deptSet.add(d);
  });

  const yearSel = document.getElementById("filter-nien-khoa");
  if (yearSel) {
    yearSel.innerHTML = `<option value="ALL">Tất cả Niên khoá</option>`;
    [...yearSet].sort().reverse().forEach(y => {
      yearSel.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(y)}">${escapeHtml(y)}</option>`);
    });
  }

  const deptSel = document.getElementById("filter-bo-mon");
  if (deptSel) {
    deptSel.innerHTML = `<option value="ALL">Tất cả Bộ môn / Lĩnh vực</option>`;
    [...deptSet].sort().forEach(d => {
      deptSel.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`);
    });
  }
}

function applyFilters() {
  const tbody = document.getElementById("table-de-tai-body");
  const emptyEl = document.getElementById("empty-state");
  const countEl = document.getElementById("count-filtered");
  if (!tbody) return;

  const kw = (document.getElementById("filter-search")?.value || "").trim().toLowerCase();
  const yearF = document.getElementById("filter-nien-khoa")?.value || "ALL";
  const deptF = document.getElementById("filter-bo-mon")?.value || "ALL";
  const giaiF = document.getElementById("filter-giai")?.value || "ALL";

  const filtered = APP_DATA.deTai.filter(dt => {
    const y = String(pick(dt, "nien_khoa", "Niên khóa", "Niên khoá")).trim();
    const d = String(pick(dt, "bo_mon", "Bộ môn / Lĩnh vực")).trim();
    const gk = cleanAward(pick(dt, "giai_khoa", "Giải cấp Khoa"));
    const gt = cleanAward(pick(dt, "giai_truong", "Giải cấp Trường"));
    const gb = cleanAward(pick(dt, "giai_bo", "Giải cấp Bộ"));
    const allAwards = `${gk} ${gt} ${gb}`.toLowerCase();

    if (yearF !== "ALL" && y !== yearF) return false;
    if (deptF !== "ALL" && d !== deptF) return false;

    if (giaiF === "CO_GIAI" && !gk && !gt && !gb) return false;
    if (giaiF === "NHAT" && !allAwards.includes("nhất")) return false;
    if (giaiF === "NHI" && !allAwards.includes("nhì")) return false;
    if (giaiF === "BA" && !allAwards.includes("ba")) return false;
    if (giaiF === "KK" && !allAwards.includes("khuyến khích") && !allAwards.includes("kk")) return false;

    if (kw) {
      const memberNames = Array.isArray(dt.thanh_vien_chi_tiet)
        ? dt.thanh_vien_chi_tiet.map(m => pick(m, "ho_ten", "ho_va_ten_sv", "ten_sv")).join(" ")
        : "";
      const hay = `${pick(dt, "ten_de_tai", "Tên đề tài")} ${pick(dt, "sv_chu_nhiem", "SV chủ nhiệm")} ${pick(dt, "sv_tham_gia", "SV tham gia")} ${memberNames} ${pick(dt, "gvhd", "Giảng viên hướng dẫn")} ${pick(dt, "tu_khoa")}`.toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });

  if (countEl) countEl.textContent = filtered.length;

  if (filtered.length === 0) {
    tbody.innerHTML = "";
    emptyEl?.classList.remove("hidden");
    return;
  }

  emptyEl?.classList.add("hidden");
  tbody.innerHTML = filtered.map(dt => {
    const idx = APP_DATA.deTai.indexOf(dt);
    const nienKhoa = pick(dt, "nien_khoa", "Niên khóa", "Niên khoá");
    const tenDeTai = pick(dt, "ten_de_tai", "Tên đề tài");
    const svCN = pick(dt, "sv_chu_nhiem", "SV chủ nhiệm");
    const svTG = pick(dt, "sv_tham_gia", "SV tham gia");
    const gvhd = pick(dt, "gvhd", "Giảng viên hướng dẫn");
    const boMon = pick(dt, "bo_mon", "Bộ môn / Lĩnh vực") || "—";
    const trangThai = pick(dt, "trang_thai", "Trạng thái") || "Đang thực hiện";
    const awardsHtml = renderAwardBadges(dt);

    const statusBadge = trangThai.toLowerCase().includes("nghiệm thu")
      ? `<span class="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700">${escapeHtml(trangThai)}</span>`
      : `<span class="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600">${escapeHtml(trangThai)}</span>`;

    return `
      <tr class="hover:bg-slate-50/80 transition">
        <td class="py-3.5 px-4 align-top font-bold text-[#0B3C78] whitespace-nowrap">${escapeHtml(nienKhoa)}</td>
        <td class="py-3.5 px-4 align-top">
          <div onclick="openDeTaiModal(${idx})" class="cursor-pointer font-semibold text-slate-900 hover:text-[#0B3C78] leading-snug">
            ${escapeHtml(tenDeTai)}
          </div>
          <div class="text-xs text-slate-500 mt-1">
            <span class="font-medium text-slate-700">CN: ${escapeHtml(svCN)}</span>
            ${svTG && svTG !== "-" ? ` • TV: ${escapeHtml(svTG)}` : ""}
          </div>
        </td>
        <td class="py-3.5 px-4 align-top text-slate-700 font-medium">${escapeHtml(gvhd)}</td>
        <td class="py-3.5 px-4 align-top text-xs text-slate-600">${escapeHtml(boMon)}</td>
        <td class="py-3.5 px-4 align-top space-y-1">
          ${awardsHtml ? `<div>${awardsHtml}</div>` : ""}
          <div>${statusBadge}</div>
        </td>
        <td class="py-3.5 px-4 align-top text-center">
          <button onclick="openDeTaiModal(${idx})" class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-blue-200 bg-[#EBF3FA] hover:bg-[#0B3C78] text-[#0B3C78] hover:text-white text-xs font-semibold transition">
            <i class="fa-solid fa-eye"></i> Xem
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

function resetFilters() {
  const s = document.getElementById("filter-search");
  const y = document.getElementById("filter-nien-khoa");
  const d = document.getElementById("filter-bo-mon");
  const g = document.getElementById("filter-giai");
  if (s) s.value = "";
  if (y) y.value = "ALL";
  if (d) d.value = "ALL";
  if (g) g.value = "ALL";
  applyFilters();
}

// =====================================================================
// 7. TAB 5: CÔNG TRÌNH & GIẢI THƯỞNG
// =====================================================================
function renderCongTrinhTab() {
  const grid = document.getElementById("grid-cong-trinh");
  if (!grid) return;

  const featured = APP_DATA.deTai
    .map((dt, idx) => {
      const gk = cleanAward(pick(dt, "giai_khoa", "Giải cấp Khoa"));
      const gt = cleanAward(pick(dt, "giai_truong", "Giải cấp Trường"));
      const gb = cleanAward(pick(dt, "giai_bo", "Giải cấp Bộ"));
      const cb = cleanAward(pick(dt, "cong_bo", "bai_bao", "Công bố", "Bài báo"));
      const score = (gb ? 100 : 0) + (gt ? 50 : 0) + (gk ? 20 : 0) + (cb ? 10 : 0);
      return { dt, idx, score, cb };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (featured.length === 0) {
    grid.innerHTML = `<div class="col-span-full bg-white py-12 px-4 rounded-xl border border-slate-200 text-center text-sm text-slate-500">Chưa có dữ liệu đề tài đạt giải hoặc công bố khoa học.</div>`;
    return;
  }

  grid.innerHTML = featured.map(({ dt, idx, cb }) => {
    const nienKhoa = pick(dt, "nien_khoa", "Niên khóa", "Niên khoá");
    const tenDeTai = pick(dt, "ten_de_tai", "Tên đề tài");
    const svCN = pick(dt, "sv_chu_nhiem", "SV chủ nhiệm");
    const gvhd = pick(dt, "gvhd", "Giảng viên hướng dẫn");
    const boMon = pick(dt, "bo_mon", "Bộ môn / Lĩnh vực");
    const awardsHtml = renderAwardBadges(dt);

    return `
      <div class="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between">
        <div>
          <div class="flex items-center justify-between gap-2 mb-3">
            <span class="text-xs font-bold bg-[#EBF3FA] text-[#0B3C78] px-2.5 py-0.5 rounded-full">${escapeHtml(nienKhoa)}</span>
            <span class="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center"><i class="fa-solid fa-award"></i></span>
          </div>

          <div class="flex flex-wrap gap-1.5 mb-2.5">
            ${awardsHtml}
          </div>

          <h3 onclick="openDeTaiModal(${idx})" class="cursor-pointer text-sm sm:text-base font-bold text-slate-900 hover:text-[#0B3C78] leading-snug mb-3">
            ${escapeHtml(tenDeTai)}
          </h3>

          <div class="text-xs text-slate-600 space-y-1 bg-slate-50 p-3 rounded-lg border border-slate-100">
            <p><strong class="text-slate-700">SV chủ nhiệm:</strong> ${escapeHtml(svCN)}</p>
            <p><strong class="text-slate-700">GV hướng dẫn:</strong> ${escapeHtml(gvhd)}</p>
            ${boMon ? `<p><strong class="text-slate-700">Lĩnh vực:</strong> ${escapeHtml(boMon)}</p>` : ""}
          </div>

          ${cb ? `
            <div class="mt-3 text-xs bg-rose-50/70 text-[#C8102E] border border-red-100 p-2.5 rounded-lg">
              <i class="fa-solid fa-book-journal-whills mr-1"></i><strong>Công bố:</strong> ${escapeHtml(cb)}
            </div>
          ` : ""}
        </div>

        <div class="mt-4 pt-3 border-t border-slate-100 flex justify-end">
          <button onclick="openDeTaiModal(${idx})" class="text-xs font-semibold text-[#0B3C78] hover:underline flex items-center gap-1">
            Xem hồ sơ đề tài <i class="fa-solid fa-arrow-right text-[10px]"></i>
          </button>
        </div>
      </div>
    `;
  }).join("");
}

// =====================================================================
// 8. TAB 6: SEMINAR & HỘI THẢO
// =====================================================================
function renderSeminarTab() {
  const listEl = document.getElementById("list-seminar");
  if (!listEl) return;

  if (APP_DATA.seminar.length === 0) {
    listEl.innerHTML = `<div class="bg-white py-12 px-4 rounded-xl border border-slate-200 text-center text-sm text-slate-500">Chưa có thông tin Seminar hoặc Hội thảo khoa học nào được cập nhật.</div>`;
    return;
  }

  listEl.innerHTML = APP_DATA.seminar.map((s, idx) => {
    const st = pick(s, "trang_thai", "Trạng thái") || "Sắp diễn ra";
    const isPast = st.toLowerCase().includes("đã");
    const loai = pick(s, "loai_hoat_dong", "Loại hoạt động") || "Seminar chuyên môn";
    const tenSuKien = pick(s, "ten_su_kien", "Tên sự kiện");
    const dienGia = pick(s, "dien_gia", "dien_gia_don_vi", "Diễn giả / Đơn vị");
    const tomTat = pick(s, "tom_tat", "tom_tat_noi_dung", "Tóm tắt nội dung");
    const thoiGian = pick(s, "thoi_gian", "ngay_bat_dau", "Thời gian");
    const diaDiem = pick(s, "dia_diem", "Địa điểm");
    const regLink = pick(s, "link_dang_ky", "Link đăng ký (Form)");
    const docLink = pick(s, "link_tai_lieu", "Link tài liệu / Kỷ yếu");

    return `
      <div class="bg-white rounded-xl border border-slate-200 p-5 sm:p-6 shadow-sm hover:shadow-md transition">
        <div class="flex flex-wrap items-center gap-2 mb-2.5">
          <span class="text-xs font-bold px-2.5 py-0.5 rounded-full ${isPast ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-[#C8102E]"}">
            ${escapeHtml(st)}
          </span>
          <span class="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-[#EBF3FA] text-[#0B3C78]">
            ${escapeHtml(loai)}
          </span>
        </div>

        <h3 onclick="openSeminarModal(${idx})" class="cursor-pointer text-base sm:text-lg font-bold text-slate-900 hover:text-[#0B3C78] transition leading-snug mb-2">
          ${escapeHtml(tenSuKien)}
        </h3>

        ${dienGia ? `<p class="text-xs sm:text-sm font-semibold text-[#0B3C78] mb-2"><i class="fa-solid fa-microphone-lines mr-1.5"></i>${escapeHtml(dienGia)}</p>` : ""}
        ${tomTat ? `<p class="text-xs sm:text-sm text-slate-600 leading-relaxed mb-4 line-clamp-3">${escapeHtml(tomTat)}</p>` : ""}

        <div class="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100 text-xs text-slate-500">
          <div class="flex flex-wrap items-center gap-4">
            ${thoiGian ? `<span><i class="fa-regular fa-clock mr-1 text-[#0B3C78]"></i><strong>Thời gian:</strong> ${escapeHtml(thoiGian)}</span>` : ""}
            ${diaDiem ? `<span><i class="fa-solid fa-location-dot mr-1 text-[#C8102E]"></i><strong>Địa điểm:</strong> ${escapeHtml(diaDiem)}</span>` : ""}
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button onclick="openSeminarModal(${idx})" class="px-3 py-1.5 rounded-lg border border-slate-200 hover:border-[#0B3C78] text-slate-700 hover:text-[#0B3C78] font-semibold transition">
              Chi tiết
            </button>
            ${!isPast && regLink && regLink !== "-" ? `
              <a href="${escapeHtml(regLink)}" target="_blank" rel="noopener" class="px-3 py-1.5 rounded-lg bg-[#C8102E] hover:bg-red-800 text-white font-semibold transition inline-flex items-center gap-1">
                <i class="fa-solid fa-pen-to-square"></i> Đăng ký tham dự
              </a>
            ` : ""}
            ${docLink && docLink !== "-" ? `
              <a href="${escapeHtml(docLink)}" target="_blank" rel="noopener" class="px-3 py-1.5 rounded-lg bg-[#0B3C78] hover:bg-[#072752] text-white font-semibold transition inline-flex items-center gap-1">
                <i class="fa-solid fa-book-open"></i> Tài liệu
              </a>
            ` : ""}
          </div>
        </div>
      </div>
    `;
  }).join("");
}

// =====================================================================
// 9. TAB 7: VĂN BẢN & BIỂU MẪU
// =====================================================================
function renderVanBanTab() {
  const grid = document.getElementById("grid-van-ban");
  if (!grid) return;

  if (APP_DATA.vanBan.length === 0) {
    grid.innerHTML = `<div class="col-span-full bg-white py-12 px-4 rounded-xl border border-slate-200 text-center text-sm text-slate-500">Chưa có văn bản hoặc biểu mẫu nào được đăng tải.</div>`;
    return;
  }

  grid.innerHTML = APP_DATA.vanBan.map(v => {
    const ten = pick(v, "ten_van_ban", "ten", "Tên văn bản / Biểu mẫu");
    const phanLoai = pick(v, "phan_loai", "Phân loại") || "Văn bản NCKH";
    const fmt = String(pick(v, "dinh_dang", "Định dạng")).toUpperCase();
    const link = pick(v, "link", "link_tai", "link_tai_xem", "Link tải / Xem") || "#";

    let iconCls = "fa-file-lines";
    let boxCls = "bg-[#EBF3FA] text-[#0B3C78]";
    if (fmt.includes("PDF")) {
      iconCls = "fa-file-pdf";
      boxCls = "bg-red-50 text-[#C8102E]";
    } else if (fmt.includes("DOC")) {
      iconCls = "fa-file-word";
      boxCls = "bg-blue-50 text-blue-700";
    } else if (fmt.includes("XLS")) {
      iconCls = "fa-file-excel";
      boxCls = "bg-emerald-50 text-emerald-700";
    } else if (fmt.includes("RAR") || fmt.includes("ZIP")) {
      iconCls = "fa-file-zipper";
      boxCls = "bg-amber-50 text-amber-700";
    } else if (fmt.includes("FOLDER") || fmt.includes("DRIVE")) {
      iconCls = "fa-folder-open";
      boxCls = "bg-amber-50 text-amber-600";
    }

    return `
      <div class="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-sm hover:shadow-md transition flex items-center justify-between gap-4">
        <div class="flex items-center gap-3.5 min-w-0">
          <div class="w-11 h-11 rounded-xl ${boxCls} flex items-center justify-center shrink-0 text-lg">
            <i class="fa-solid ${iconCls}"></i>
          </div>
          <div class="min-w-0">
            <h4 class="text-sm font-bold text-slate-900 leading-snug line-clamp-2">${escapeHtml(ten)}</h4>
            <p class="text-xs text-slate-500 mt-1">
              ${escapeHtml(phanLoai)}${fmt ? ` • <span class="font-semibold text-slate-700">${escapeHtml(fmt)}</span>` : ""}
            </p>
          </div>
        </div>
        <a href="${escapeHtml(link)}" target="_blank" rel="noopener" class="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#0B3C78] hover:bg-[#072752] text-white text-xs font-semibold transition">
          <i class="fa-solid fa-download"></i><span>Mở / Tải</span>
        </a>
      </div>
    `;
  }).join("");
}

// =====================================================================
// 10. MODALS CHI TIẾT (ĐỀ TÀI & THÔNG BÁO / SỰ KIỆN)
// =====================================================================
function setupModalListeners() {
  document.getElementById("detail-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "detail-modal") closeModal();
  });
  document.getElementById("article-detail-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "article-detail-modal") closeArticleModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal();
      closeArticleModal();
    }
  });
}

function openDeTaiModal(index) {
  const dt = APP_DATA.deTai[index];
  if (!dt) return;

  const nienKhoa = pick(dt, "nien_khoa", "Niên khóa", "Niên khoá") || "Đề tài NCKH";
  const maSo = pick(dt, "ma_so", "Mã đề tài");
  document.getElementById("modal-nien-khoa").textContent = maSo ? `${nienKhoa} • Mã: ${maSo}` : nienKhoa;
  document.getElementById("modal-ten-de-tai").textContent = pick(dt, "ten_de_tai", "Tên đề tài");
  document.getElementById("modal-gvhd").textContent = pick(dt, "gvhd", "Giảng viên hướng dẫn") || "-";
  document.getElementById("modal-bo-mon").textContent = pick(dt, "bo_mon", "Bộ môn / Lĩnh vực") || "-";

  // Danh sách sinh viên
  const tvContainer = document.getElementById("modal-thanh-vien");
  if (Array.isArray(dt.thanh_vien_chi_tiet) && dt.thanh_vien_chi_tiet.length > 0) {
    tvContainer.innerHTML = dt.thanh_vien_chi_tiet.map(m => {
      const vaiTro = pick(m, "vai_tro", "Vai trò") || "Thành viên";
      const hoTen = pick(m, "ho_ten", "ho_va_ten_sv", "ten_sv", "Họ và tên SV");
      const nganh = pick(m, "nganh", "Ngành");
      const isLeader = vaiTro.toLowerCase().includes("chủ nhiệm");
      return `
        <div class="flex items-center justify-between text-xs sm:text-sm bg-slate-50 px-3.5 py-2 rounded-lg border border-slate-100">
          <span class="font-semibold text-slate-800">${escapeHtml(hoTen)}${nganh ? ` <span class="text-slate-500 font-normal">(${escapeHtml(nganh)})</span>` : ""}</span>
          <span class="text-[11px] font-bold px-2 py-0.5 rounded-full ${isLeader ? "bg-[#EBF3FA] text-[#0B3C78]" : "bg-slate-200/70 text-slate-600"}">${escapeHtml(vaiTro)}</span>
        </div>
      `;
    }).join("");
  } else {
    const svCN = pick(dt, "sv_chu_nhiem", "SV chủ nhiệm");
    const svTG = pick(dt, "sv_tham_gia", "SV tham gia");
    tvContainer.innerHTML = `
      <div class="text-xs sm:text-sm bg-slate-50 p-3.5 rounded-lg border border-slate-100 space-y-1.5">
        <p><strong class="text-[#0B3C78]">SV chủ nhiệm:</strong> ${escapeHtml(svCN || "—")}</p>
        <p><strong class="text-slate-700">SV tham gia:</strong> ${escapeHtml(svTG && svTG !== "-" ? svTG : "Không có")}</p>
      </div>
    `;
  }

  // Giải thưởng
  const giaiSec = document.getElementById("modal-giai-section");
  const giaiBadges = document.getElementById("modal-giai-badges");
  const awardsHtml = renderAwardBadges(dt);
  if (awardsHtml) {
    giaiBadges.innerHTML = awardsHtml;
    giaiSec.classList.remove("hidden");
  } else {
    giaiSec.classList.add("hidden");
  }

  // Tóm tắt
  const tomTatSec = document.getElementById("modal-tom-tat-section");
  const tomTatEl = document.getElementById("modal-tom-tat");
  const tomTat = pick(dt, "tom_tat", "Tóm tắt đề tài");
  if (tomTat && tomTat !== "-") {
    tomTatEl.textContent = tomTat;
    tomTatSec.classList.remove("hidden");
  } else {
    tomTatSec.classList.add("hidden");
  }

  // Link tài liệu / quyết định
  const linkSec = document.getElementById("modal-link-section");
  const linkBtn = document.getElementById("modal-link-btn");
  const linkQD = pick(dt, "link_tai_lieu", "Link QĐ công nhận / Kỷ yếu");
  if (linkQD && linkQD !== "-") {
    linkBtn.href = linkQD;
    linkSec.classList.remove("hidden");
  } else {
    linkSec.classList.add("hidden");
  }

  document.getElementById("detail-modal").classList.remove("hidden");
}

function closeModal() {
  document.getElementById("detail-modal")?.classList.add("hidden");
}

function showArticleModal({ category, isPinned, title, metaItems, summary, body, link, linkText }) {
  document.getElementById("article-modal-category").textContent = category || "Thông tin";

  const pinEl = document.getElementById("article-modal-pinned");
  if (isPinned) pinEl.classList.remove("hidden");
  else pinEl.classList.add("hidden");

  document.getElementById("article-modal-title").textContent = title || "";

  const metaEl = document.getElementById("article-modal-meta");
  metaEl.innerHTML = (metaItems || [])
    .filter(Boolean)
    .map(m => `<span>${m}</span>`)
    .join("");

  const sumBox = document.getElementById("article-modal-summary-box");
  const sumEl = document.getElementById("article-modal-summary");
  if (summary && summary !== body) {
    sumEl.textContent = summary;
    sumBox.classList.remove("hidden");
  } else {
    sumBox.classList.add("hidden");
  }

  document.getElementById("article-modal-body").textContent = body || summary || "Đang cập nhật nội dung chi tiết.";

  const actWrap = document.getElementById("article-modal-action-wrap");
  const actBtn = document.getElementById("article-modal-action-btn");
  const actText = document.getElementById("article-modal-action-text");
  if (link && link !== "-") {
    actBtn.href = link;
    actText.textContent = linkText || "Xem chi tiết / Đăng ký";
    actWrap.classList.remove("hidden");
  } else {
    actWrap.classList.add("hidden");
  }

  document.getElementById("article-detail-modal").classList.remove("hidden");
}

function closeArticleModal() {
  document.getElementById("article-detail-modal")?.classList.add("hidden");
}

function openThongBaoModal(index) {
  const tb = APP_DATA.thongBao[index];
  if (!tb) return;

  const ngayDang = pick(tb, "ngay_dang", "Ngày đăng");
  const hanMoc = pick(tb, "ngay_su_kien", "han_moc", "Ngày sự kiện / Hạn mốc");

  showArticleModal({
    category: pick(tb, "phan_loai", "Phân loại") || "Thông báo NCKH",
    isPinned: isTruthyFlag(pick(tb, "ghim_noi_bat", "Ghim nổi bật")),
    title: pick(tb, "tieu_de", "tieu_de_thong_bao", "Tiêu đề thông báo"),
    metaItems: [
      ngayDang ? `<i class="fa-regular fa-calendar mr-1"></i>Ngày đăng: <strong>${escapeHtml(ngayDang)}</strong>` : "",
      hanMoc ? `<i class="fa-solid fa-hourglass-half mr-1 text-amber-600"></i>Hạn mốc: <strong>${escapeHtml(hanMoc)}</strong>` : ""
    ],
    summary: pick(tb, "tom_tat", "tom_tat_ngan", "Tóm tắt ngắn"),
    body: pick(tb, "noi_dung", "noi_dung_chi_tiet") || pick(tb, "tom_tat", "tom_tat_ngan"),
    link: pick(tb, "link", "link_dinh_kem", "link_dang_ky", "Link đính kèm / Đăng ký"),
    linkText: pick(tb, "ten_nut", "ten_nut_lien_ket", "Tên nút liên kết") || "Mở tài liệu / Đăng ký"
  });
}

function openSeminarModal(index) {
  const s = APP_DATA.seminar[index];
  if (!s) return;

  const thoiGian = pick(s, "thoi_gian", "ngay_bat_dau", "Thời gian");
  const diaDiem = pick(s, "dia_diem", "Địa điểm");
  const dienGia = pick(s, "dien_gia", "dien_gia_don_vi", "Diễn giả / Đơn vị");

  showArticleModal({
    category: pick(s, "loai_hoat_dong", "Loại hoạt động") || "Seminar & Hội thảo",
    isPinned: false,
    title: pick(s, "ten_su_kien", "Tên sự kiện"),
    metaItems: [
      thoiGian ? `<i class="fa-regular fa-clock mr-1"></i>Thời gian: <strong>${escapeHtml(thoiGian)}</strong>` : "",
      diaDiem ? `<i class="fa-solid fa-location-dot mr-1"></i>Địa điểm: <strong>${escapeHtml(diaDiem)}</strong>` : ""
    ],
    summary: dienGia ? `Báo cáo viên / Đơn vị: ${dienGia}` : "",
    body: pick(s, "tom_tat", "tom_tat_noi_dung", "Tóm tắt nội dung"),
    link: pick(s, "link_dang_ky", "link_tai_lieu", "Link đăng ký (Form)"),
    linkText: "Đăng ký tham dự / Tài liệu"
  });
}

function openScheduleItemModal(index) {
  const ev = UNIFIED_SCHEDULE[index];
  if (!ev) return;

  showArticleModal({
    category: `${ev.sourceLabel} • ${ev.type}`,
    isPinned: ev.source === "THONGBAO",
    title: ev.title,
    metaItems: [
      ev.dateDisplay ? `<i class="fa-regular fa-calendar mr-1"></i>Thời gian: <strong>${escapeHtml(ev.dateDisplay)}${ev.timeText ? ` (${escapeHtml(ev.timeText)})` : ""}</strong>` : "",
      ev.location ? `<i class="fa-solid fa-location-dot mr-1"></i>Địa điểm: <strong>${escapeHtml(ev.location)}</strong>` : "",
      ev.organizer ? `<i class="fa-solid fa-user-tie mr-1"></i>Phụ trách: <strong>${escapeHtml(ev.organizer)}</strong>` : ""
    ],
    summary: ev.summary,
    body: ev.body || ev.summary,
    link: ev.link,
    linkText: ev.linkText
  });
}
