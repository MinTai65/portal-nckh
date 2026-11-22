/**
 * ============================================================================
 * LOGIC ĐIỀU KHIỂN CỔNG THÔNG TIN NCKH - KHOA HÓA HỌC (HCMUE)
 * - Tự động đồng bộ cấu hình (Logo, Địa chỉ, SĐT, Thông báo) từ CMS_CauHinh_HeThong
 * - Tự động thích ứng với các cột bật/tắt [CÔNG KHAI] / [NỘI BỘ] trên Google Sheets
 * ============================================================================
 */

const API_URL = "https://script.google.com/macros/s/AKfycbzzIB36p5__18W9nqnAO1izKUw9a7SAzu-Ai1zMYvPPEN-_s12PAGwCdXxHxr-ZRytlfw/exec";
const CACHE_KEY = "hcmue_chem_nckh_cache_v1";
const CACHE_TTL_MS = 5 * 60 * 1000; // Bộ nhớ đệm 5 phút giúp chuyển trang tức thì

const state = {
  rawData: null,
  filteredProjects: [],
  currentPage: 1,
  itemsPerPage: 15,
  selectedGvhdId: "",
  eventFilter: "ALL"
};

// Hàm chống chèn mã độc XSS
function escapeHTML(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Chuẩn hóa tiếng Việt không dấu để tìm kiếm chính xác
function normalizeText(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .trim();
}

function hasValidAward(val) {
  const v = String(val || "").trim();
  return v !== "" && v !== "-" && v.toLowerCase() !== "không";
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
          state.rawData = parsed.data;
          renderAll();
          loadingEl.classList.add("hidden");
          return;
        }
      }
    }

    const response = await fetch(API_URL);
    if (!response.ok) throw new Error("Lỗi kết nối máy chủ dữ liệu");
    const data = await response.json();

    state.rawData = data;
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({
      timestamp: Date.now(),
      data: data
    }));

    renderAll();
  } catch (err) {
    console.error(err);
    loadingEl.innerHTML = `<div class="container">Không thể tải dữ liệu lúc này. Vui lòng nhấn <strong>"Cập nhật dữ liệu"</strong> hoặc kiểm tra lại đường truyền.</div>`;
    return;
  }

  loadingEl.classList.add("hidden");
}

// 2. Render toàn bộ giao diện
function renderAll() {
  if (!state.rawData) return;
  applySystemConfig(state.rawData.cau_hinh || {});
  renderKPIs(state.rawData);
  renderHistoryChart(state.rawData.thong_ke_lich_su || []);
  populateFilterDropdowns(state.rawData.de_tai || []);
  applyProjectFilters();
  renderEvents(state.rawData.su_kien || []);
  renderDocuments(state.rawData.van_ban || []);
}

// 3. Áp dụng cấu hình hệ thống (Logo, Địa chỉ, SĐT, Thông báo)
function applySystemConfig(cfg) {
  if (cfg.ten_truong) {
    document.getElementById("header-university").textContent = cfg.ten_truong;
  }
  if (cfg.ten_khoa) {
    document.getElementById("header-faculty").textContent = cfg.ten_khoa;
    document.getElementById("footer-faculty-title").textContent = `${cfg.ten_khoa} – ${cfg.ten_truong || "TRƯỜNG ĐẠI HỌC SƯ PHẠM TP. HỒ CHÍ MINH"}`;
  }
  if (cfg.tieu_de_cong) {
    document.getElementById("header-portal-title").textContent = cfg.tieu_de_cong;
    document.title = `${cfg.tieu_de_cong} - ${cfg.ten_khoa || "Khoa Hóa học"} HCMUE`;
  }

  // Logo Header
  const headerLogo = document.getElementById("header-logo");
  const headerFallback = document.getElementById("header-logo-fallback");
  if (cfg.logo_header) {
    headerLogo.src = cfg.logo_header;
    headerLogo.onload = () => {
      headerLogo.classList.remove("hidden");
      headerFallback.classList.add("hidden");
    };
  }

  // Logo Footer
  const footerLogo = document.getElementById("footer-logo");
  if (cfg.logo_footer) {
    footerLogo.src = cfg.logo_footer;
    footerLogo.onload = () => footerLogo.classList.remove("hidden");
  }

  // Thông báo chạy
  const annBar = document.getElementById("announcement-bar");
  const annText = document.getElementById("announcement-text");
  if (cfg.thong_bao_chay && cfg.thong_bao_chay.trim() !== "") {
    annText.textContent = cfg.thong_bao_chay;
    annBar.classList.remove("hidden");
  } else {
    annBar.classList.add("hidden");
  }

  // Thông tin liên hệ chân trang
  if (cfg.dia_chi) document.getElementById("footer-address").textContent = cfg.dia_chi;
  if (cfg.dien_thoai) document.getElementById("footer-phone").textContent = cfg.dien_thoai;
  if (cfg.email) {
    const emailEl = document.getElementById("footer-email");
    emailEl.textContent = cfg.email;
    emailEl.href = `mailto:${cfg.email}`;
    document.getElementById("link-form-register").href = `mailto:${cfg.email}?subject=[NCKH]%20Đăng%20ký%20/%20Trao%20đổi%20thông%20tin%20NCKH`;
  }
  if (cfg.fanpage) {
    const fpEl = document.getElementById("footer-fanpage");
    fpEl.href = cfg.fanpage;
  }
}

// 4. Tính toán chỉ số KPI
function renderKPIs(data) {
  const projects = data.de_tai || [];
  const events = data.su_kien || [];

  const awardedCount = projects.filter(p =>
    hasValidAward(p.giai_khoa) || hasValidAward(p.giai_truong) || hasValidAward(p.giai_bo)
  ).length;

  const ongoingCount = projects.filter(p =>
    normalizeText(p.trang_thai).includes("dang thuc hien")
  ).length;

  document.getElementById("kpi-total-projects").textContent = projects.length;
  document.getElementById("kpi-awarded-projects").textContent = awardedCount;
  document.getElementById("kpi-ongoing-projects").textContent = ongoingCount;
  document.getElementById("kpi-events-count").textContent = events.length;

  if (data.updated_at) {
    const dt = new Date(data.updated_at);
    document.getElementById("last-updated-label").textContent =
      `Đồng bộ: ${dt.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`;
  }
}

// 5. Biểu đồ cột quy mô qua các niên khóa
function renderHistoryChart(historyList) {
  const container = document.getElementById("history-chart");
  if (!historyList.length) {
    container.innerHTML = `<p class="text-muted">Chưa có dữ liệu thống kê lịch sử.</p>`;
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
        <div class="bar-fill" style="height: ${heightPct}px;" title="Niên khóa ${escapeHTML(item.nien_khoa)}: ${count} đề tài"></div>
        <span class="bar-label">${escapeHTML(item.nien_khoa)}</span>
      </div>
    `;
  }).join("");
}

// 6. Nạp danh sách chọn cho bộ lọc từ dữ liệu thực tế
function populateFilterDropdowns(projects) {
  const fillSelect = (id, values, defaultLabel) => {
    const select = document.getElementById(id);
    const currentVal = select.value;
    const unique = [...new Set(values.filter(Boolean))].sort((a, b) => b.localeCompare(a, "vi"));
    select.innerHTML = `<option value="">${defaultLabel}</option>` +
      unique.map(v => `<option value="${escapeHTML(v)}">${escapeHTML(v)}</option>`).join("");
    if (unique.includes(currentVal)) select.value = currentVal;
  };

  fillSelect("filter-year", projects.map(p => p.nien_khoa), "Tất cả niên khóa");
  fillSelect("filter-major", projects.map(p => p.nganh), "Tất cả ngành đào tạo");
  fillSelect("filter-department", projects.map(p => p.bo_mon), "Tất cả bộ môn / lĩnh vực");
  fillSelect("filter-status", projects.map(p => p.trang_thai), "Tất cả trạng thái");
}

// 7. Lọc & Tìm kiếm đề tài
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
    } else if (award === "BO" && !hasValidAward(p.giai_bo)) {
      return false;
    } else if (award === "TRUONG" && !hasValidAward(p.giai_truong)) {
      return false;
    } else if (award === "KHOA" && !hasValidAward(p.giai_khoa)) {
      return false;
    }

    if (keyword) {
      const searchable = normalizeText([
        p.ma_so,
        p.ten_de_tai,
        p.sv_chu_nhiem,
        p.sv_tham_gia,
        p.gvhd,
        p.tu_khoa,
        p.bo_mon,
        p.nganh
      ].join(" "));
      if (!searchable.includes(keyword)) return false;
    }

    return true;
  });

  state.currentPage = 1;
  document.getElementById("result-count").textContent = state.filteredProjects.length;
  renderProjectsTable();
}

// 8. Render bảng đề tài + phân trang
function renderProjectsTable() {
  const tbody = document.getElementById("projects-tbody");
  const total = state.filteredProjects.length;

  if (total === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 32px; color: #64748b;">
          Không tìm thấy đề tài nào phù hợp với điều kiện lọc hiện tại.
        </td>
      </tr>
    `;
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
    if (hasValidAward(p.giai_bo)) {
      awardsHtml += `<span class="award-badge award-bo">Cấp Bộ: ${escapeHTML(p.giai_bo)}</span>`;
    }
    if (hasValidAward(p.giai_truong)) {
      awardsHtml += `<span class="award-badge award-truong">Cấp Trường: ${escapeHTML(p.giai_truong)}</span>`;
    }
    if (hasValidAward(p.giai_khoa)) {
      awardsHtml += `<span class="award-badge award-khoa">Cấp Khoa: ${escapeHTML(p.giai_khoa)}</span>`;
    }
    if (!awardsHtml) {
      awardsHtml = `<span style="color:#94a3b8; font-size:13px;">—</span>`;
    }

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
          <button type="button" class="gvhd-link" data-gvhd-id="${escapeHTML(p.ma_gvhd || "")}" data-gvhd-name="${escapeHTML(p.gvhd || "")}" title="Nhấn để xem tất cả đề tài do giảng viên này hướng dẫn">
            ${escapeHTML(p.gvhd || "-")}
          </button>
        </td>
        <td><div class="award-stack">${awardsHtml}</div></td>
        <td>
          <button type="button" class="btn-detail" data-project-idx="${globalIndex}">Xem thêm</button>
        </td>
      </tr>
    `;
  }).join("");

  renderPagination(total);
}

function renderPagination(totalItems) {
  const totalPages = Math.ceil(totalItems / state.itemsPerPage);
  const container = document.getElementById("pagination-controls");
  if (totalPages <= 1) {
    container.innerHTML = "";
    return;
  }

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

// 9. Modal Xem chi tiết đề tài (Tự động hiển thị các cột bổ sung nếu được bật CÔNG KHAI)
function openProjectModal(project) {
  if (!project) return;
  document.getElementById("modal-project-meta").textContent =
    `NIÊN KHÓA ${project.nien_khoa || "--"}  |  MÃ SỐ ĐỀ TÀI: ${project.ma_so || "--"}`;
  document.getElementById("modal-project-title").textContent = project.ten_de_tai || "";

  // Danh sách thành viên chi tiết (nếu có trong CMS_ThanhVien_DeTai)
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

  // Các cột mở rộng tự động khi bật công tắc CÔNG KHAI ở Dòng 2
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
      <div class="detail-item">
        <span class="detail-label">Giảng viên hướng dẫn</span>
        <div class="detail-value">${escapeHTML(project.gvhd || "-")}</div>
      </div>
      <div class="detail-item">
        <span class="detail-label">Trạng thái thực hiện</span>
        <div class="detail-value">${escapeHTML(project.trang_thai || "-")}</div>
      </div>
      <div class="detail-item">
        <span class="detail-label">Ngành đào tạo</span>
        <div class="detail-value">${escapeHTML(project.nganh || "Chưa phân loại")}</div>
      </div>
      <div class="detail-item">
        <span class="detail-label">Bộ môn / Lĩnh vực</span>
        <div class="detail-value">${escapeHTML(project.bo_mon || "Chưa phân loại")}</div>
      </div>
      <div class="detail-item full">
        <span class="detail-label">Nhóm sinh viên thực hiện</span>
        <div class="detail-value">${membersHtml}</div>
      </div>
      <div class="detail-item full">
        <span class="detail-label">Thành tích / Giải thưởng đạt được</span>
        <div class="detail-value">
          Cấp Khoa: <strong>${escapeHTML(project.giai_khoa || "-")}</strong> &nbsp;|&nbsp;
          Cấp Trường: <strong>${escapeHTML(project.giai_truong || "-")}</strong> &nbsp;|&nbsp;
          Cấp Bộ: <strong>${escapeHTML(project.giai_bo || "-")}</strong>
        </div>
      </div>
      ${project.tom_tat ? `
        <div class="detail-item full">
          <span class="detail-label">Tóm tắt nội dung nghiên cứu</span>
          <div class="detail-value" style="font-weight:400;">${escapeHTML(project.tom_tat)}</div>
        </div>` : ""}
      ${project.tu_khoa ? `
        <div class="detail-item full">
          <span class="detail-label">Từ khóa nghiên cứu</span>
          <div class="detail-value">${escapeHTML(project.tu_khoa)}</div>
        </div>` : ""}
      ${dynamicExtraHtml}
      ${project.link_tai_lieu ? `
        <div class="detail-item full">
          <span class="detail-label">Tài liệu / Quyết định công nhận</span>
          <div class="detail-value" style="margin-top:6px;">
            <a href="${escapeHTML(project.link_tai_lieu)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary">Mở tài liệu đính kèm ↗</a>
          </div>
        </div>` : ""}
    </div>
  `;

  document.getElementById("project-modal").classList.remove("hidden");
}

// 10. Render Seminar & Hội nghị
function renderEvents(events) {
  const grid = document.getElementById("events-grid");
  const filtered = events.filter(ev => {
    if (state.eventFilter === "ALL") return true;
    return normalizeText(ev.trang_thai) === normalizeText(state.eventFilter);
  });

  if (!filtered.length) {
    grid.innerHTML = `<p style="color:#64748b;">Hiện chưa có sự kiện nào trong mục này.</p>`;
    return;
  }

  grid.innerHTML = filtered.map(ev => {
    const isUpcoming = normalizeText(ev.trang_thai).includes("sap dien ra");
    return `
      <article class="event-card ${isUpcoming ? "upcoming" : ""}">
        <div>
          <div class="event-meta-top">
            <span class="event-type">${escapeHTML(ev.loai || "Hoạt động KH&CN")}</span>
            <span class="event-status">${escapeHTML(ev.trang_thai || "Thông báo")}</span>
          </div>
          <h3 class="event-title">${escapeHTML(ev.ten_su_kien)}</h3>
          <ul class="event-info-list">
            ${ev.thoi_gian ? `<li><strong>Thời gian:</strong> ${escapeHTML(ev.thoi_gian)}</li>` : ""}
            ${ev.dia_diem ? `<li><strong>Địa điểm:</strong> ${escapeHTML(ev.dia_diem)}</li>` : ""}
            ${ev.dien_gia ? `<li><strong>Đơn vị / Diễn giả:</strong> ${escapeHTML(ev.dien_gia)}</li>` : ""}
          </ul>
          ${ev.tom_tat ? `<p class="event-summary">${escapeHTML(ev.tom_tat)}</p>` : ""}
        </div>
        <div class="event-actions">
          ${ev.link_dang_ky ? `<a href="${escapeHTML(ev.link_dang_ky)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary">Đăng ký tham dự</a>` : ""}
          ${ev.link_tai_lieu ? `<a href="${escapeHTML(ev.link_tai_lieu)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline-primary">Xem tài liệu / Kỷ yếu</a>` : ""}
          ${(!ev.link_dang_ky && !ev.link_tai_lieu) ? `<span style="font-size:12.5px; color:#64748b;">Cổng đăng ký sẽ được cập nhật sớm</span>` : ""}
        </div>
      </article>
    `;
  }).join("");
}

// 11. Render Văn bản & Biểu mẫu
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
        <a href="${escapeHTML(doc.link)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline-primary">
          ${escapeHTML(btnLabel)} ↗
        </a>
      </div>
    `;
  }).join("");
}

// 12. Gắn sự kiện tương tác
document.addEventListener("DOMContentLoaded", () => {
  loadPortalData(false);

  document.getElementById("btn-refresh-data").addEventListener("click", () => {
    loadPortalData(true);
  });

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

  // Lọc nhanh theo GVHD & Mở Modal chi tiết đề tài
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
    if (detailBtn) {
      const idx = Number(detailBtn.dataset.projectIdx);
      openProjectModal(state.filteredProjects[idx]);
    }
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

  // Tab lọc sự kiện
  document.getElementById("event-filter-tabs").addEventListener("click", (e) => {
    const pill = e.target.closest(".tab-pill");
    if (!pill) return;
    document.querySelectorAll(".tab-pill").forEach(p => p.classList.remove("active"));
    pill.classList.add("active");
    state.eventFilter = pill.dataset.eventFilter;
    renderEvents((state.rawData && state.rawData.su_kien) || []);
  });

  // Đóng Modal
  const modal = document.getElementById("project-modal");
  document.getElementById("modal-close-btn").addEventListener("click", () => modal.classList.add("hidden"));
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.add("hidden");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") modal.classList.add("hidden");
  });
});
