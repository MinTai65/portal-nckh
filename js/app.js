/**
 * CỔNG THÔNG TIN NGHIÊN CỨU KHOA HỌC - KHOA HOÁ HỌC (HCMUE)
 * Tệp xử lý gọi API từ Google Apps Script, lọc dữ liệu, vẽ biểu đồ Chart.js và hiển thị giao diện.
 */

const CONFIG = {
  API_URL: "https://script.google.com/macros/s/AKfycbz-y0kUxEFygO4PxHAw7Z5N06nOGS57TMMr-t6XMjH6PmjNFHDXmQlA-wCwag1IUko6dg/exec",
  ITEMS_PER_PAGE: 12
};

const STATE = {
  rawData: null,
  filteredTopics: [],
  currentPage: 1,
  announcementFilter: "ALL",
  seminarFilter: "ALL",
  charts: {
    yearChart: null,
    fieldChart: null
  }
};

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  fetchPortalData();
});

function bindEvents() {
  const searchInput = document.getElementById("search-input");
  const filterYear = document.getElementById("filter-year");
  const filterField = document.getElementById("filter-field");
  const filterAward = document.getElementById("filter-award");
  const btnReset = document.getElementById("btn-reset-filters");
  const annFilter = document.getElementById("announcement-filter");
  const semFilter = document.getElementById("seminar-status-filter");
  const modal = document.getElementById("detail-modal");
  const modalCloseBtn = document.getElementById("modal-close-btn");
  const mobileMenuBtn = document.getElementById("mobile-menu-btn");
  const mobileMenu = document.getElementById("mobile-menu");

  if (searchInput) searchInput.addEventListener("input", applyTopicFilters);
  if (filterYear) filterYear.addEventListener("change", applyTopicFilters);
  if (filterField) filterField.addEventListener("change", applyTopicFilters);
  if (filterAward) filterAward.addEventListener("change", applyTopicFilters);

  if (btnReset) {
    btnReset.addEventListener("click", () => {
      if (searchInput) searchInput.value = "";
      if (filterYear) filterYear.value = "";
      if (filterField) filterField.value = "";
      if (filterAward) filterAward.value = "";
      applyTopicFilters();
    });
  }

  if (annFilter) {
    annFilter.addEventListener("change", (e) => {
      STATE.announcementFilter = e.target.value;
      renderAnnouncements(STATE.rawData?.announcements || []);
    });
  }

  if (semFilter) {
    semFilter.addEventListener("change", (e) => {
      STATE.seminarFilter = e.target.value;
      renderSeminars(STATE.rawData?.seminars || []);
    });
  }

  if (modalCloseBtn && modal) {
    modalCloseBtn.addEventListener("click", closeModal);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  if (mobileMenuBtn && mobileMenu) {
    mobileMenuBtn.addEventListener("click", () => {
      mobileMenu.classList.toggle("hidden");
    });
    mobileMenu.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => mobileMenu.classList.add("hidden"));
    });
  }
}

async function fetchPortalData() {
  setSyncStatus("loading", "Đang đồng bộ dữ liệu từ hệ thống CMS...");
  try {
    const response = await fetch(CONFIG.API_URL, {
      method: "GET",
      redirect: "follow"
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    if (data.status !== "success") {
      throw new Error(data.message || "Không thể đọc dữ liệu từ Google Sheets.");
    }

    STATE.rawData = data;
    renderAll(data);

    const updatedTime = data.updatedAt
      ? new Date(data.updatedAt).toLocaleString("vi-VN")
      : new Date().toLocaleString("vi-VN");
    setSyncStatus("success", `Đã đồng bộ dữ liệu trực tuyến • Cập nhật: ${updatedTime}`);
  } catch (error) {
    console.error("Lỗi tải dữ liệu API:", error);
    setSyncStatus(
      "error",
      "Không thể kết nối máy chủ dữ liệu. Vui lòng kiểm tra quyền triển khai Apps Script (Anyone) hoặc tải lại trang."
    );
  }
}

function setSyncStatus(type, message) {
  const el = document.getElementById("sync-status");
  if (!el) return;

  const styles = {
    loading: "bg-blue-50 text-[#124874] border-blue-200",
    success: "bg-emerald-50 text-emerald-800 border-emerald-200",
    error: "bg-red-50 text-[#CF373D] border-red-200"
  };
  const icons = {
    loading: '<i class="fa-solid fa-rotate fa-spin mr-1.5"></i>',
    success: '<i class="fa-solid fa-circle-check mr-1.5 text-emerald-600"></i>',
    error: '<i class="fa-solid fa-triangle-exclamation mr-1.5 text-[#CF373D]"></i>'
  };

  el.className = `inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ${styles[type] || styles.loading}`;
  el.innerHTML = `${icons[type] || ""}${escapeHtml(message)}`;
}

function renderAll(data) {
  applySystemConfig(data.config || {});
  renderHeroStats(data.topics || []);
  renderInteractiveCards(data.interactiveCards || []);
  renderAnnouncements(data.announcements || []);
  renderSchedules(data.schedules || []);
  renderSeminars(data.seminars || []);
  initTopicFilters(data.topics || []);
  applyTopicFilters();
  renderCharts(data.topics || []);
  renderDocuments(data.documents || []);
}

/* ==========================================================================
   1. CẤU HÌNH HỆ THỐNG (CMS_CauHinh_HeThong)
   ========================================================================== */
function applySystemConfig(cfg) {
  setText("header-faculty", cfg.ten_khoa || "KHOA HOÁ HỌC");
  setText("header-school", cfg.ten_truong || "TRƯỜNG ĐẠI HỌC SƯ PHẠM THÀNH PHỐ HỒ CHÍ MINH");
  setText("header-title", cfg.tieu_de_cong || "CỔNG THÔNG TIN NGHIÊN CỨU KHOA HỌC");
  if (cfg.mo_ta_cong) setText("header-subtitle", cfg.mo_ta_cong);

  const logoEl = document.getElementById("header-logo");
  if (logoEl && cfg.logo_header) {
    logoEl.src = normalizeDriveImageUrl(cfg.logo_header);
    logoEl.classList.remove("hidden");
  }

  if (cfg.ten_khoa) setText("footer-faculty", cfg.ten_khoa);
  if (cfg.ten_truong) setText("footer-school", cfg.ten_truong);
  if (cfg.dia_chi) setText("footer-address", cfg.dia_chi);
  if (cfg.email_lien_he) {
    const emailEl = document.getElementById("footer-email");
    if (emailEl) {
      emailEl.textContent = cfg.email_lien_he;
      emailEl.href = `mailto:${cfg.email_lien_he}`;
    }
  }
}

/* ==========================================================================
   2. THỐNG KÊ TỔNG QUAN HERO
   ========================================================================== */
function renderHeroStats(topics) {
  const totalTopics = topics.length;
  const years = new Set(topics.map((t) => String(t["Niên khóa"] || "").trim()).filter(Boolean));

  const awardedCount = topics.filter((t) => {
    const k = cleanDash(t["Giải cấp Khoa"]);
    const tr = cleanDash(t["Giải cấp Trường"]);
    const b = cleanDash(t["Giải cấp Bộ"]);
    return Boolean(k || tr || b);
  }).length;

  const pubCount = topics.filter((t) => {
    const qt = cleanDash(t["Bài báo khoa học quốc tế"]);
    const tn = cleanDash(t["Bài báo khoa học trong nước"]);
    return Boolean(qt || tn);
  }).length;

  setText("stat-total-topics", totalTopics);
  setText("stat-total-years", years.size);
  setText("stat-total-awards", awardedCount);
  setText("stat-total-pubs", pubCount);
}

/* ==========================================================================
   3. CỔNG TƯƠNG TÁC NHANH (CMS_Cong_Tuong_Tac)
   ========================================================================== */
function renderInteractiveCards(cards) {
  const container = document.getElementById("interactive-cards-grid");
  if (!container) return;

  if (!cards.length) {
    container.innerHTML = `<div class="col-span-full text-center py-8 text-slate-500 text-sm">Chưa có kênh tương tác nào được kích hoạt.</div>`;
    return;
  }

  container.innerHTML = cards
    .map((card) => {
      const badgeColor = mapBadgeColor(card["Màu nhãn"]);
      const btnStyle = String(card["Kiểu nút bấm"] || "").trim();
      const link = String(card["Link đăng ký / Liên kết"] || "").trim();
      const btnText = String(card["Chữ trên nút bấm"] || "Truy cập").trim();
      const isExternal = link.startsWith("http");

      let actionHtml = "";
      if (btnStyle === "Chỉ hiện dòng ghi chú" || !link) {
        actionHtml = `
          <div class="mt-4 pt-3 border-t border-slate-100 text-xs font-medium text-amber-700 bg-amber-50/70 px-3 py-2 rounded-lg">
            <i class="fa-solid fa-circle-info mr-1.5"></i>${escapeHtml(btnText)}
          </div>`;
      } else if (btnStyle === "Nút đỏ nổi bật") {
        actionHtml = `
          <a href="${escapeAttr(link)}" ${isExternal ? 'target="_blank" rel="noopener noreferrer"' : ""}
             class="mt-4 inline-flex items-center justify-center w-full px-4 py-2.5 rounded-xl bg-[#CF373D] hover:bg-[#b52b31] text-white font-semibold text-sm transition shadow-sm">
            <span>${escapeHtml(btnText)}</span>
            <i class="fa-solid ${isExternal ? "fa-arrow-up-right-from-square" : "fa-arrow-down"} ml-2 text-xs"></i>
          </a>`;
      } else {
        actionHtml = `
          <a href="${escapeAttr(link)}" ${isExternal ? 'target="_blank" rel="noopener noreferrer"' : ""}
             class="mt-4 inline-flex items-center justify-center w-full px-4 py-2.5 rounded-xl border-2 border-[#124874] text-[#124874] hover:bg-[#124874] hover:text-white font-semibold text-sm transition">
            <span>${escapeHtml(btnText)}</span>
            <i class="fa-solid ${isExternal ? "fa-arrow-up-right-from-square" : "fa-arrow-down"} ml-2 text-xs"></i>
          </a>`;
      }

      return `
        <article class="portal-card bg-white rounded-2xl border border-slate-200/90 p-6 flex flex-col justify-between shadow-sm">
          <div>
            <span class="inline-block px-2.5 py-1 rounded-md text-[11px] font-bold tracking-wider uppercase ${badgeColor}">
              ${escapeHtml(card["Nhãn phân loại"] || "THÔNG TIN")}
            </span>
            <h3 class="mt-3 text-lg font-bold text-slate-900 leading-snug">
              ${escapeHtml(card["Tiêu đề thẻ"] || "")}
            </h3>
            <p class="mt-2 text-sm text-slate-600 leading-relaxed">
              ${escapeHtml(card["Nội dung mô tả"] || "")}
            </p>
          </div>
          ${actionHtml}
        </article>`;
    })
    .join("");
}

/* ==========================================================================
   4. THÔNG BÁO NCKH (CMS_ThongBao_NCKH)
   ========================================================================== */
function renderAnnouncements(items) {
  const container = document.getElementById("announcements-list");
  const filterSelect = document.getElementById("announcement-filter");
  if (!container) return;

  if (filterSelect && filterSelect.options.length <= 1) {
    const categories = [...new Set(items.map((i) => String(i["Phân loại"] || "").trim()).filter(Boolean))];
    categories.forEach((cat) => {
      const opt = document.createElement("option");
      opt.value = cat;
      opt.textContent = cat;
      filterSelect.appendChild(opt);
    });
  }

  let list = [...items];
  if (STATE.announcementFilter !== "ALL") {
    list = list.filter((i) => String(i["Phân loại"] || "").trim() === STATE.announcementFilter);
  }

  list.sort((a, b) => {
    const pinA = String(a["Ghim nổi bật"] || "").trim().toLowerCase() === "có" ? 1 : 0;
    const pinB = String(b["Ghim nổi bật"] || "").trim().toLowerCase() === "có" ? 1 : 0;
    return pinB - pinA;
  });

  if (!list.length) {
    container.innerHTML = `<div class="bg-white rounded-xl border border-slate-200 p-6 text-center text-sm text-slate-500">Chưa có thông báo phù hợp.</div>`;
    return;
  }

  container.innerHTML = list
    .map((item, idx) => {
      const isPinned = String(item["Ghim nổi bật"] || "").trim().toLowerCase() === "có";
      const deadline = String(item["Ngày sự kiện / Hạn mốc"] || "").trim();
      const session = String(item["Buổi / Ca"] || "").trim();
      const link = String(item["Link đính kèm / Đăng ký"] || "").trim();
      const btnLabel = String(item["Tên nút liên kết"] || "Xem chi tiết").trim();

      return `
        <div class="portal-card bg-white rounded-xl border ${isPinned ? "border-l-4 border-l-[#CF373D] border-slate-200" : "border-slate-200"} p-5 shadow-sm">
          <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div class="flex flex-wrap items-center gap-2">
              ${isPinned ? '<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-red-50 text-[#CF373D] border border-red-200"><i class="fa-solid fa-thumbtack mr-1"></i>Ghim</span>' : ""}
              <span class="px-2.5 py-0.5 rounded text-xs font-medium bg-blue-50 text-[#124874]">
                ${escapeHtml(item["Phân loại"] || "Thông báo")}
              </span>
              <span class="text-xs text-slate-400">
                <i class="fa-regular fa-calendar mr-1"></i>Đăng ngày: ${escapeHtml(item["Ngày đăng"] || "—")}
              </span>
            </div>
            ${deadline ? `<span class="text-xs font-semibold text-amber-700 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-200">Mốc thời gian: ${escapeHtml(deadline)} ${session ? `(${escapeHtml(session)})` : ""}</span>` : ""}
          </div>

          <h3 class="text-base font-bold text-slate-900 hover:text-[#124874] cursor-pointer" onclick="openAnnouncementModal(${idx})">
            ${escapeHtml(item["Tiêu đề thông báo"] || "")}
          </h3>
          <p class="mt-1.5 text-sm text-slate-600 line-clamp-2">
            ${escapeHtml(item["Tóm tắt ngắn"] || item["Nội dung chi tiết"] || "")}
          </p>

          <div class="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <button type="button" onclick="openAnnouncementModal(${idx})" class="text-xs font-semibold text-[#124874] hover:underline">
              Xem nội dung chi tiết <i class="fa-solid fa-chevron-right ml-1 text-[10px]"></i>
            </button>
            ${
              link
                ? `<a href="${escapeAttr(link)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center px-3 py-1.5 rounded-lg bg-[#124874] hover:bg-[#0d3556] text-white text-xs font-medium transition">
                    ${escapeHtml(btnLabel)} <i class="fa-solid fa-arrow-up-right-from-square ml-1.5 text-[10px]"></i>
                  </a>`
                : ""
            }
          </div>
        </div>`;
    })
    .join("");

  window.__currentAnnouncements = list;
}

window.openAnnouncementModal = function (index) {
  const item = (window.__currentAnnouncements || [])[index];
  if (!item) return;

  const link = String(item["Link đính kèm / Đăng ký"] || "").trim();
  const btnLabel = String(item["Tên nút liên kết"] || "Mở liên kết đính kèm").trim();

  const bodyHtml = `
    <div class="space-y-3 text-sm text-slate-700">
      <div class="flex flex-wrap gap-3 text-xs text-slate-500 bg-slate-50 p-3 rounded-lg border border-slate-200/80">
        <span><strong>Mã TB:</strong> ${escapeHtml(item["Mã thông báo"] || "—")}</span>
        <span><strong>Ngày đăng:</strong> ${escapeHtml(item["Ngày đăng"] || "—")}</span>
        ${item["Ngày sự kiện / Hạn mốc"] ? `<span><strong>Thời gian / Hạn mốc:</strong> ${escapeHtml(item["Ngày sự kiện / Hạn mốc"])} ${item["Buổi / Ca"] ? `(${escapeHtml(item["Buổi / Ca"])})` : ""}</span>` : ""}
      </div>
      <div class="whitespace-pre-line leading-relaxed text-slate-800">
        ${escapeHtml(item["Nội dung chi tiết"] || item["Tóm tắt ngắn"] || "")}
      </div>
      ${
        link
          ? `<div class="pt-3 border-t border-slate-100">
              <a href="${escapeAttr(link)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center px-4 py-2 rounded-xl bg-[#CF373D] hover:bg-[#b52b31] text-white text-sm font-semibold transition">
                ${escapeHtml(btnLabel)} <i class="fa-solid fa-arrow-up-right-from-square ml-2 text-xs"></i>
              </a>
            </div>`
          : ""
      }
    </div>`;

  openModal(item["Phân loại"] || "Thông báo NCKH", item["Tiêu đề thông báo"] || "", bodyHtml);
};

/* ==========================================================================
   5. THỜI GIAN BIỂU (CMS_ThoiGianBieu)
   ========================================================================== */
function renderSchedules(schedules) {
  const container = document.getElementById("schedule-list");
  if (!container) return;

  if (!schedules.length) {
    container.innerHTML = `<div class="bg-white rounded-xl border border-slate-200 p-6 text-center text-sm text-slate-500">Chưa có lịch trình công bố.</div>`;
    return;
  }

  container.innerHTML = schedules
    .map((item) => {
      const start = String(item["Ngày bắt đầu"] || "").trim();
      const end = String(item["Ngày kết thúc"] || "").trim();
      const dateDisplay = end && end !== start ? `${start} → ${end}` : start;
      const link = String(item["Link liên kết"] || "").trim();

      return `
        <div class="relative pl-6 pb-6 border-l-2 border-[#124874]/30 last:pb-0">
          <span class="absolute -left-[9px] top-1 w-4 h-4 rounded-full bg-[#124874] ring-4 ring-blue-50"></span>
          <div class="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-xs font-bold text-[#CF373D]">
                <i class="fa-regular fa-clock mr-1"></i>${escapeHtml(dateDisplay)}
                ${item["Buổi / Ca"] ? ` • ${escapeHtml(item["Buổi / Ca"])}` : ""}
                ${item["Giờ cụ thể"] ? ` (${escapeHtml(item["Giờ cụ thể"])})` : ""}
              </span>
              <span class="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700">
                ${escapeHtml(item["Phân loại"] || "Hoạt động")}
              </span>
            </div>
            <h4 class="mt-1.5 text-sm font-bold text-slate-900">
              ${escapeHtml(item["Tên hoạt động"] || "")}
            </h4>
            <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
              ${item["Địa điểm"] ? `<span><i class="fa-solid fa-location-dot mr-1 text-[#124874]"></i>${escapeHtml(item["Địa điểm"])}</span>` : ""}
              ${item["Đơn vị / Phụ trách"] ? `<span><i class="fa-solid fa-user-tie mr-1 text-[#124874]"></i>${escapeHtml(item["Đơn vị / Phụ trách"])}</span>` : ""}
            </div>
            ${item["Nội dung / Ghi chú"] ? `<p class="mt-2 text-xs text-slate-600 leading-relaxed">${escapeHtml(item["Nội dung / Ghi chú"])}</p>` : ""}
            ${
              link
                ? `<a href="${escapeAttr(link)}" target="_blank" rel="noopener noreferrer" class="mt-2.5 inline-flex items-center text-xs font-semibold text-[#124874] hover:underline">
                    Chi tiết / Tham gia <i class="fa-solid fa-arrow-up-right-from-square ml-1 text-[10px]"></i>
                  </a>`
                : ""
            }
          </div>
        </div>`;
    })
    .join("");
}

/* ==========================================================================
   6. SEMINAR & HỘI NGHỊ KHOA HỌC (CMS_Seminar_HoiNghi)
   ========================================================================== */
function renderSeminars(seminars) {
  const container = document.getElementById("seminars-grid");
  if (!container) return;

  let list = [...seminars];
  if (STATE.seminarFilter !== "ALL") {
    list = list.filter((s) => String(s["Trạng thái"] || "").trim() === STATE.seminarFilter);
  }

  if (!list.length) {
    container.innerHTML = `<div class="col-span-full bg-white rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-500">Không có sự kiện hội nghị / chuyên đề nào ở trạng thái đã chọn.</div>`;
    return;
  }

  container.innerHTML = list
    .map((ev) => {
      const status = String(ev["Trạng thái"] || "").trim();
      const isUpcoming = status.toLowerCase().includes("sắp") || status.toLowerCase().includes("đang mở");
      const statusClass = isUpcoming
        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
        : "bg-slate-100 text-slate-600 border-slate-200";
      const formLink = String(ev["Link đăng ký (Form)"] || "").trim();
      const docLink = String(ev["Link tài liệu / Kỷ yếu"] || "").trim();

      return `
        <article class="portal-card bg-white rounded-2xl border border-slate-200 p-5 flex flex-col justify-between shadow-sm">
          <div>
            <div class="flex items-start justify-between gap-2">
              <span class="text-[11px] font-semibold text-[#124874] bg-blue-50 px-2.5 py-1 rounded-md">
                ${escapeHtml(ev["Loại hoạt động"] || "Chuyên đề học thuật")}
              </span>
              <span class="shrink-0 text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${statusClass}">
                ${escapeHtml(status || "Đã công bố")}
              </span>
            </div>

            <h3 class="mt-3 text-base font-bold text-slate-900 leading-snug">
              ${escapeHtml(ev["Tên sự kiện"] || "")}
            </h3>

            <div class="mt-3 space-y-1.5 text-xs text-slate-600">
              <div><i class="fa-regular fa-calendar-days w-4 text-[#CF373D]"></i> <strong>Thời gian:</strong> ${escapeHtml(ev["Ngày bắt đầu"] || "")} ${ev["Thời gian"] ? `• ${escapeHtml(ev["Thời gian"])}` : ""} ${ev["Buổi / Ca"] ? `(${escapeHtml(ev["Buổi / Ca"])})` : ""}</div>
              <div><i class="fa-solid fa-location-dot w-4 text-[#124874]"></i> <strong>Địa điểm:</strong> ${escapeHtml(ev["Địa điểm"] || "—")}</div>
              <div><i class="fa-solid fa-microphone-lines w-4 text-[#124874]"></i> <strong>Diễn giả:</strong> <span class="whitespace-pre-line">${escapeHtml(ev["Diễn giả / Đơn vị tổ chức"] || "—")}</span></div>
            </div>

            ${ev["Tóm tắt nội dung"] ? `<p class="mt-3 text-xs text-slate-500 leading-relaxed line-clamp-3">${escapeHtml(ev["Tóm tắt nội dung"])}</p>` : ""}
          </div>

          <div class="mt-4 pt-3 border-t border-slate-100 flex flex-wrap gap-2">
            ${
              formLink && isUpcoming
                ? `<a href="${escapeAttr(formLink)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center px-3 py-1.5 rounded-lg bg-[#CF373D] hover:bg-[#b52b31] text-white text-xs font-semibold transition">
                    Đăng ký tham dự <i class="fa-solid fa-arrow-up-right-from-square ml-1.5 text-[10px]"></i>
                  </a>`
                : ""
            }
            ${
              docLink
                ? `<a href="${escapeAttr(docLink)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center px-3 py-1.5 rounded-lg border border-[#124874] text-[#124874] hover:bg-[#124874] hover:text-white text-xs font-semibold transition">
                    Tài liệu / Kỷ yếu <i class="fa-solid fa-file-lines ml-1.5 text-[10px]"></i>
                  </a>`
                : ""
            }
          </div>
        </article>`;
    })
    .join("");
}

/* ==========================================================================
   7. TRA CỨU ĐỀ TÀI & BIỂU ĐỒ THỐNG KÊ (CMS_DeTai_NCKH + CMS_ThanhVien_DeTai)
   ========================================================================== */
function initTopicFilters(topics) {
  const yearSelect = document.getElementById("filter-year");
  const fieldSelect = document.getElementById("filter-field");

  if (yearSelect) {
    const years = [...new Set(topics.map((t) => String(t["Niên khóa"] || "").trim()).filter(Boolean))].sort().reverse();
    yearSelect.innerHTML = `<option value="">Tất cả niên khóa</option>` + years.map((y) => `<option value="${escapeAttr(y)}">${escapeHtml(y)}</option>`).join("");
  }

  if (fieldSelect) {
    const fields = [...new Set(topics.map((t) => String(t["Bộ môn / Lĩnh vực"] || "").trim()).filter(Boolean))].sort();
    fieldSelect.innerHTML = `<option value="">Tất cả bộ môn / lĩnh vực</option>` + fields.map((f) => `<option value="${escapeAttr(f)}">${escapeHtml(f)}</option>`).join("");
  }
}

function applyTopicFilters() {
  const topics = STATE.rawData?.topics || [];
  const query = normalizeText(document.getElementById("search-input")?.value || "");
  const year = document.getElementById("filter-year")?.value || "";
  const field = document.getElementById("filter-field")?.value || "";
  const award = document.getElementById("filter-award")?.value || "";

  STATE.filteredTopics = topics.filter((t) => {
    if (year && String(t["Niên khóa"] || "").trim() !== year) return false;
    if (field && String(t["Bộ môn / Lĩnh vực"] || "").trim() !== field) return false;

    if (award === "KHOA" && !cleanDash(t["Giải cấp Khoa"])) return false;
    if (award === "TRUONG" && !cleanDash(t["Giải cấp Trường"])) return false;
    if (award === "BO" && !cleanDash(t["Giải cấp Bộ"])) return false;
    if (award === "BAIBAO" && !cleanDash(t["Bài báo khoa học quốc tế"]) && !cleanDash(t["Bài báo khoa học trong nước"])) return false;

    if (query) {
      const haystack = normalizeText(
        [
          t["Tên đề tài"],
          t["SV chủ nhiệm"],
          t["SV tham gia"],
          t["Giảng viên hướng dẫn"],
          t["Bộ môn / Lĩnh vực"],
          t["Từ khóa"],
          t["Niên khóa"]
        ].join(" ")
      );
      if (!haystack.includes(query)) return false;
    }

    return true;
  });

  STATE.currentPage = 1;
  renderTopicsTable();
}

function renderTopicsTable() {
  const tbody = document.getElementById("topics-table-body");
  const mobileList = document.getElementById("topics-mobile-list");
  const countLabel = document.getElementById("topics-count-label");
  const total = STATE.filteredTopics.length;

  if (countLabel) {
    countLabel.textContent = `Hiển thị ${total} đề tài phù hợp`;
  }

  if (!total) {
    const emptyMsg = `Không tìm thấy đề tài nào khớp với điều kiện lọc hiện tại.`;
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="px-4 py-8 text-center text-sm text-slate-500">${emptyMsg}</td></tr>`;
    if (mobileList) mobileList.innerHTML = `<div class="bg-white rounded-xl border border-slate-200 p-6 text-center text-sm text-slate-500">${emptyMsg}</div>`;
    renderPagination(0);
    return;
  }

  const startIdx = (STATE.currentPage - 1) * CONFIG.ITEMS_PER_PAGE;
  const pageItems = STATE.filteredTopics.slice(startIdx, startIdx + CONFIG.ITEMS_PER_PAGE);

  if (tbody) {
    tbody.innerHTML = pageItems
      .map((t, idx) => {
        const globalIdx = startIdx + idx;
        const badges = buildAwardBadges(t);
        const students = [t["SV chủ nhiệm"], t["SV tham gia"]].filter(Boolean).join(", ");

        return `
          <tr class="hover:bg-blue-50/40 transition border-b border-slate-100">
            <td class="px-4 py-3.5 text-xs font-semibold text-[#124874] whitespace-nowrap">
              ${escapeHtml(t["Niên khóa"] || "")}
              <div class="text-[11px] font-normal text-slate-400">Mã: ${escapeHtml(t["Mã số"] || "—")}</div>
            </td>
            <td class="px-4 py-3.5">
              <button type="button" onclick="openTopicModal(${globalIdx})" class="text-left font-semibold text-sm text-slate-900 hover:text-[#124874] leading-snug">
                ${escapeHtml(t["Tên đề tài"] || "")}
              </button>
              <div class="mt-1 text-xs text-slate-500">${escapeHtml(t["Bộ môn / Lĩnh vực"] || "")}</div>
            </td>
            <td class="px-4 py-3.5 text-xs text-slate-700">
              <div class="font-semibold text-slate-900">${escapeHtml(t["SV chủ nhiệm"] || "—")}</div>
              ${t["SV tham gia"] ? `<div class="text-slate-500 mt-0.5 line-clamp-2">${escapeHtml(t["SV tham gia"])}</div>` : ""}
            </td>
            <td class="px-4 py-3.5 text-xs font-medium text-slate-800 whitespace-nowrap">
              ${escapeHtml(t["Giảng viên hướng dẫn"] || "—")}
            </td>
            <td class="px-4 py-3.5 text-xs">
              <div class="flex flex-wrap gap-1">${badges || '<span class="text-slate-400">—</span>'}</div>
            </td>
            <td class="px-4 py-3.5 text-right whitespace-nowrap">
              <button type="button" onclick="openTopicModal(${globalIdx})" class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-[#124874] text-slate-700 hover:text-white text-xs font-semibold transition">
                Chi tiết
              </button>
            </td>
          </tr>`;
      })
      .join("");
  }

  if (mobileList) {
    mobileList.innerHTML = pageItems
      .map((t, idx) => {
        const globalIdx = startIdx + idx;
        const badges = buildAwardBadges(t);
        return `
          <div class="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <div class="flex items-center justify-between text-xs text-slate-500 mb-1.5">
              <span class="font-bold text-[#124874]">${escapeHtml(t["Niên khóa"] || "")} • Mã ${escapeHtml(t["Mã số"] || "—")}</span>
              <span>${escapeHtml(t["Bộ môn / Lĩnh vực"] || "")}</span>
            </div>
            <h4 class="text-sm font-bold text-slate-900 leading-snug" onclick="openTopicModal(${globalIdx})">
              ${escapeHtml(t["Tên đề tài"] || "")}
            </h4>
            <div class="mt-2 text-xs text-slate-600 space-y-1">
              <div><strong>SV chủ nhiệm:</strong> ${escapeHtml(t["SV chủ nhiệm"] || "—")}</div>
              <div><strong>GVHD:</strong> ${escapeHtml(t["Giảng viên hướng dẫn"] || "—")}</div>
            </div>
            ${badges ? `<div class="mt-2.5 flex flex-wrap gap-1">${badges}</div>` : ""}
            <button type="button" onclick="openTopicModal(${globalIdx})" class="mt-3 w-full py-2 rounded-lg bg-slate-100 text-[#124874] font-semibold text-xs">
              Xem chi tiết đề tài
            </button>
          </div>`;
      })
      .join("");
  }

  renderPagination(total);
}

function renderPagination(totalItems) {
  const container = document.getElementById("pagination-controls");
  if (!container) return;

  const totalPages = Math.ceil(totalItems / CONFIG.ITEMS_PER_PAGE);
  if (totalPages <= 1) {
    container.innerHTML = "";
    return;
  }

  let html = "";
  for (let p = 1; p <= totalPages; p++) {
    const active = p === STATE.currentPage;
    html += `
      <button type="button" onclick="goToPage(${p})"
        class="w-8 h-8 rounded-lg text-xs font-semibold transition ${
          active ? "bg-[#124874] text-white" : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
        }">
        ${p}
      </button>`;
  }
  container.innerHTML = html;
}

window.goToPage = function (page) {
  STATE.currentPage = page;
  renderTopicsTable();
  document.getElementById("tra-cuu-de-tai")?.scrollIntoView({ behavior: "smooth", block: "start" });
};

window.openTopicModal = function (index) {
  const t = STATE.filteredTopics[index];
  if (!t) return;

  const allMembers = STATE.rawData?.members || [];
  const matchedMembers = allMembers.filter(
    (m) =>
      String(m["Niên khóa"] || "").trim() === String(t["Niên khóa"] || "").trim() &&
      String(m["Mã số đề tài"] || "").trim() === String(t["Mã số"] || "").trim()
  );

  const memberHtml = matchedMembers.length
    ? `<ul class="list-disc pl-5 space-y-1 text-slate-700">
        ${matchedMembers
          .map(
            (m) =>
              `<li><strong>${escapeHtml(m["Họ và tên SV"] || "")}</strong> — ${escapeHtml(m["Vai trò"] || "")}${m["Ngành"] ? ` (${escapeHtml(m["Ngành"])})` : ""}</li>`
          )
          .join("")}
      </ul>`
    : `<p class="text-slate-700"><strong>SV chủ nhiệm:</strong> ${escapeHtml(t["SV chủ nhiệm"] || "—")}${t["SV tham gia"] ? `<br><strong>SV tham gia:</strong> ${escapeHtml(t["SV tham gia"])}` : ""}</p>`;

  const intlPub = cleanDash(t["Bài báo khoa học quốc tế"]);
  const domPub = cleanDash(t["Bài báo khoa học trong nước"]);
  const decisionLink = cleanDash(t["Link QĐ công nhận / Kỷ yếu"]);
  const honorImg = cleanDash(t["Link ảnh vinh danh"]);

  const bodyHtml = `
    <div class="space-y-4 text-sm text-slate-700">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200/80 text-xs">
        <div><span class="text-slate-500">Niên khóa:</span> <strong class="text-slate-900">${escapeHtml(t["Niên khóa"] || "—")}</strong></div>
        <div><span class="text-slate-500">Mã số đề tài:</span> <strong class="text-slate-900">${escapeHtml(t["Mã số"] || "—")}</strong></div>
        <div><span class="text-slate-500">Bộ môn / Lĩnh vực:</span> <strong class="text-slate-900">${escapeHtml(t["Bộ môn / Lĩnh vực"] || "—")}</strong></div>
        <div><span class="text-slate-500">Trạng thái:</span> <strong class="text-emerald-700">${escapeHtml(t["Trạng thái"] || "—")}</strong></div>
        <div class="sm:col-span-2"><span class="text-slate-500">Giảng viên hướng dẫn:</span> <strong class="text-[#124874]">${escapeHtml(t["Giảng viên hướng dẫn"] || "—")}</strong></div>
      </div>

      <div>
        <h4 class="font-bold text-slate-900 mb-1.5">Nhóm sinh viên thực hiện</h4>
        ${memberHtml}
      </div>

      <div>
        <h4 class="font-bold text-slate-900 mb-1.5">Thành tích & Giải thưởng</h4>
        <div class="flex flex-wrap gap-1.5">
          ${buildAwardBadges(t) || '<span class="text-xs text-slate-500">Chưa ghi nhận giải thưởng</span>'}
        </div>
      </div>

      ${
        intlPub || domPub
          ? `<div>
              <h4 class="font-bold text-slate-900 mb-1.5">Công bố khoa học</h4>
              <div class="space-y-1 text-xs">
                ${intlPub ? `<div><strong>Quốc tế:</strong> ${formatLinkOrText(intlPub)}</div>` : ""}
                ${domPub ? `<div><strong>Trong nước:</strong> ${formatLinkOrText(domPub)}</div>` : ""}
              </div>
            </div>`
          : ""
      }

      ${
        cleanDash(t["Tóm tắt đề tài"])
          ? `<div>
              <h4 class="font-bold text-slate-900 mb-1">Tóm tắt nội dung</h4>
              <p class="text-xs text-slate-600 leading-relaxed whitespace-pre-line">${escapeHtml(t["Tóm tắt đề tài"])}</p>
            </div>`
          : ""
      }

      ${
        honorImg
          ? `<div>
              <img src="${escapeAttr(normalizeDriveImageUrl(honorImg))}" alt="Ảnh vinh danh đề tài" class="w-full max-h-64 object-cover rounded-xl border border-slate-200">
            </div>`
          : ""
      }

      ${
        decisionLink
          ? `<div class="pt-2 border-t border-slate-100">
              <a href="${escapeAttr(decisionLink)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center px-4 py-2 rounded-xl bg-[#124874] hover:bg-[#0d3556] text-white text-xs font-semibold transition">
                Xem Quyết định công nhận / Kỷ yếu <i class="fa-solid fa-arrow-up-right-from-square ml-2"></i>
              </a>
            </div>`
          : ""
      }
    </div>`;

  openModal(`Đề tài SV NCKH • ${t["Niên khóa"] || ""}`, t["Tên đề tài"] || "", bodyHtml);
};

function renderCharts(topics) {
  if (typeof Chart === "undefined") return;

  const yearCanvas = document.getElementById("chart-by-year");
  const fieldCanvas = document.getElementById("chart-by-field");

  if (yearCanvas) {
    const yearCounts = {};
    topics.forEach((t) => {
      const y = String(t["Niên khóa"] || "").trim();
      if (y) yearCounts[y] = (yearCounts[y] || 0) + 1;
    });
    const labels = Object.keys(yearCounts).sort();
    const values = labels.map((l) => yearCounts[l]);

    if (STATE.charts.yearChart) STATE.charts.yearChart.destroy();
    STATE.charts.yearChart = new Chart(yearCanvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Số lượng đề tài",
            data: values,
            backgroundColor: "#124874",
            borderRadius: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
      }
    });
  }

  if (fieldCanvas) {
    const fieldCounts = {};
    topics.forEach((t) => {
      const f = String(t["Bộ môn / Lĩnh vực"] || "Khác").trim();
      fieldCounts[f] = (fieldCounts[f] || 0) + 1;
    });
    const labels = Object.keys(fieldCounts);
    const values = labels.map((l) => fieldCounts[l]);

    if (STATE.charts.fieldChart) STATE.charts.fieldChart.destroy();
    STATE.charts.fieldChart = new Chart(fieldCanvas, {
      type: "doughnut",
      data: {
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: ["#124874", "#CF373D", "#0EA5E9", "#F59E0B", "#10B981", "#6366F1"]
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } }
        }
      }
    });
  }
}

/* ==========================================================================
   8. VĂN BẢN & BIỂU MẪU (CMS_VanBan_BieuMau)
   ========================================================================== */
function renderDocuments(docs) {
  const container = document.getElementById("documents-grid");
  if (!container) return;

  if (!docs.length) {
    container.innerHTML = `<div class="col-span-full text-center py-8 text-sm text-slate-500">Chưa có văn bản / biểu mẫu nào được đăng tải.</div>`;
    return;
  }

  container.innerHTML = docs
    .map((doc) => {
      const fmt = String(doc["Định dạng"] || "FILE").trim().toUpperCase();
      const link = String(doc["Link tải / Xem"] || "#").trim();
      const iconMap = {
        PDF: "fa-file-pdf text-[#CF373D]",
        RAR: "fa-file-zipper text-amber-600",
        ZIP: "fa-file-zipper text-amber-600",
        DOCX: "fa-file-word text-[#124874]",
        FOLDER: "fa-folder-open text-amber-500"
      };
      const iconClass = iconMap[fmt] || "fa-file-lines text-[#124874]";

      return `
        <a href="${escapeAttr(link)}" target="_blank" rel="noopener noreferrer"
           class="portal-card bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between gap-3 shadow-sm hover:border-[#124874]">
          <div class="flex items-center gap-3.5 min-w-0">
            <div class="w-10 h-10 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-center shrink-0 text-lg">
              <i class="fa-solid ${iconClass}"></i>
            </div>
            <div class="min-w-0">
              <h4 class="text-sm font-bold text-slate-900 truncate">${escapeHtml(doc["Tên văn bản / Biểu mẫu"] || "")}</h4>
              <p class="text-xs text-slate-500 truncate">${escapeHtml(doc["Phân loại"] || "")}</p>
            </div>
          </div>
          <span class="shrink-0 px-2.5 py-1 rounded-md text-[11px] font-bold bg-slate-100 text-slate-700">
            ${escapeHtml(fmt)} <i class="fa-solid fa-download ml-1 text-[10px]"></i>
          </span>
        </a>`;
    })
    .join("");
}

/* ==========================================================================
   TIỆN ÍCH HỖ TRỢ
   ========================================================================== */
function openModal(badge, title, bodyHtml) {
  const modal = document.getElementById("detail-modal");
  if (!modal) return;
  setText("modal-badge", badge);
  setText("modal-title", title);
  const bodyEl = document.getElementById("modal-body");
  if (bodyEl) bodyEl.innerHTML = bodyHtml;
  modal.classList.remove("hidden");
  document.body.classList.add("overflow-hidden");
}

function closeModal() {
  const modal = document.getElementById("detail-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  document.body.classList.remove("overflow-hidden");
}

function buildAwardBadges(t) {
  const badges = [];
  const gBo = cleanDash(t["Giải cấp Bộ"]);
  const gTruong = cleanDash(t["Giải cấp Trường"]);
  const gKhoa = cleanDash(t["Giải cấp Khoa"]);
  const pubQt = cleanDash(t["Bài báo khoa học quốc tế"]);
  const pubTn = cleanDash(t["Bài báo khoa học trong nước"]);

  if (gBo) badges.push(`<span class="px-2 py-0.5 rounded bg-red-50 text-[#CF373D] border border-red-200 font-semibold text-[11px]">Cấp Bộ: ${escapeHtml(gBo)}</span>`);
  if (gTruong) badges.push(`<span class="px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 font-semibold text-[11px]">Cấp Trường: ${escapeHtml(gTruong)}</span>`);
  if (gKhoa) badges.push(`<span class="px-2 py-0.5 rounded bg-blue-50 text-[#124874] border border-blue-200 font-semibold text-[11px]">Cấp Khoa: ${escapeHtml(gKhoa)}</span>`);
  if (pubQt) badges.push(`<span class="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold text-[11px]">Bài báo QT</span>`);
  if (pubTn) badges.push(`<span class="px-2 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-200 font-semibold text-[11px]">Bài báo TN</span>`);

  return badges.join("");
}

function mapBadgeColor(colorName) {
  const c = String(colorName || "").trim().toLowerCase();
  if (c === "đỏ" || c === "red") return "bg-red-50 text-[#CF373D] border border-red-200";
  if (c === "vàng" || c === "yellow") return "bg-amber-50 text-amber-800 border border-amber-200";
  return "bg-blue-50 text-[#124874] border border-blue-200";
}

function normalizeDriveImageUrl(url) {
  const str = String(url || "").trim();
  const matchFile = str.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (matchFile && matchFile[1]) {
    return `https://lh3.googleusercontent.com/d/${matchFile[1]}`;
  }
  const matchOpen = str.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (matchOpen && matchOpen[1]) {
    return `https://lh3.googleusercontent.com/d/${matchOpen[1]}`;
  }
  return str;
}

function formatLinkOrText(val) {
  const s = String(val || "").trim();
  if (s.startsWith("http://") || s.startsWith("https://")) {
    return `<a href="${escapeAttr(s)}" target="_blank" rel="noopener noreferrer" class="text-[#124874] underline break-all">${escapeHtml(s)}</a>`;
  }
  if (s.toUpperCase().startsWith("DOI:")) {
    const doi = s.replace(/^DOI:\s*/i, "").trim();
    return `<a href="https://doi.org/${escapeAttr(doi)}" target="_blank" rel="noopener noreferrer" class="text-[#124874] underline">${escapeHtml(s)}</a>`;
  }
  return escapeHtml(s);
}

function cleanDash(val) {
  const s = String(val ?? "").trim();
  return s === "-" || s === "—" || s === "–" ? "" : s;
}

function normalizeText(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .trim();
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(str) {
  return escapeHtml(str);
}
