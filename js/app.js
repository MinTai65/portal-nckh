/**
 * CỔNG THÔNG TIN NGHIÊN CỨU KHOA HỌC - KHOA HOÁ HỌC (HCMUE)
 * Tương thích 100% với JSON snake_case từ Google Apps Script (Code.gs)
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

let chartNienKhoaInstance = null;
let chartBoMonInstance = null;

// Hàm lấy giá trị linh hoạt theo nhiều tên khóa (ưu tiên snake_case từ Code.gs)
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

// ==========================================
// 1. KHỞI TẠO & TẢI DỮ LIỆU TỪ GOOGLE SHEETS
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
  setupNavigation();
  setupFilters();
  fetchPortalData();
});

async function fetchPortalData() {
  const loadingEl = document.getElementById("loading-screen");
  const errorEl = document.getElementById("error-screen");
  const mainEl = document.getElementById("main-content");

  loadingEl.classList.remove("hidden");
  errorEl.classList.add("hidden");
  mainEl.classList.add("hidden");

  try {
    const response = await fetch(API_URL, { redirect: "follow" });
    if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

    const raw = await response.json();
    if (raw.error) throw new Error(raw.error);

    // Ánh xạ dữ liệu từ snake_case của Code.gs
    APP_DATA = {
      updatedAt: pick(raw, "updated_at", "updatedAt"),
      cauHinh: raw.cau_hinh || raw.cauHinh || {},
      deTai: raw.de_tai || raw.deTai || [],
      thongBao: (raw.thong_bao || raw.thong_bao_nckh || raw.thongBao || []).filter(isVisible),
      thoiGianBieu: (raw.thoi_gian_bieu || raw.thoiGianBieu || []).filter(isVisible),
      congTuongTac: (raw.cong_tuong_tac || raw.congTuongTac || []).filter(isVisible),
      seminar: (raw.seminar || raw.seminar_hoi_nghi || []).filter(isVisible),
      vanBan: (raw.van_ban || raw.van_ban_bieu_mau || raw.vanBan || []).filter(isVisible),
      thongKeLichSu: raw.thong_ke_lich_su || raw.thongKeLichSu || []
    };

    renderAllSections();

    loadingEl.classList.add("hidden");
    mainEl.classList.remove("hidden");
  } catch (err) {
    console.error("Lỗi tải dữ liệu:", err);
    loadingEl.classList.add("hidden");
    errorEl.classList.remove("hidden");
    document.getElementById("error-message").textContent =
      `Chi tiết lỗi: ${err.message}. Vui lòng kiểm tra quyền truy cập Web App (Anyone) hoặc kết nối mạng.`;
  }
}

// ==========================================
// 2. ĐIỀU HƯỚNG TAB
// ==========================================
function setupNavigation() {
  const navBtns = document.querySelectorAll(".nav-item");
  navBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const targetTab = btn.getAttribute("data-tab");
      switchTab(targetTab);
    });
  });

  document.querySelectorAll("[data-goto]").forEach(el => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      const target = el.getAttribute("data-goto");
      switchTab(target);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

function switchTab(tabId) {
  document.querySelectorAll(".nav-item").forEach(b => {
    b.classList.toggle("active", b.getAttribute("data-tab") === tabId);
  });
  document.querySelectorAll(".tab-panel").forEach(panel => {
    panel.classList.toggle("active", panel.id === `tab-${tabId}`);
  });
}

// ==========================================
// 3. RENDER TOÀN BỘ GIAO DIỆN
// ==========================================
function renderAllSections() {
  renderConfigAndHeader();
  renderOverviewKPIs();
  renderOverviewCharts();
  renderOverviewWidgets();
  renderThongBaoFull();
  renderThoiGianBieuFull();
  populateDeTaiFilters();
  renderDeTaiTable();
  renderGiaiThuongTab();
  renderSeminarTab();
  renderVanBanTab();
}

// --- 3.1 Cấu hình chung, Header, Marquee & Footer ---
function renderConfigAndHeader() {
  const cfg = APP_DATA.cauHinh;

  const tenTruong = pick(cfg, "ten_truong");
  const tenKhoa = pick(cfg, "ten_khoa");
  const tieuDeCong = pick(cfg, "tieu_de_cong");

  if (tenTruong) {
    document.getElementById("header-ten-truong").textContent = tenTruong;
    document.getElementById("footer-ten-truong").textContent = tenTruong;
  }
  if (tenKhoa) {
    document.getElementById("header-ten-khoa").textContent = tenKhoa;
    document.getElementById("footer-ten-khoa").textContent = tenKhoa;
  }
  if (tieuDeCong) {
    document.getElementById("header-tieu-de").textContent = tieuDeCong;
  }

  const logoHeader = pick(cfg, "logo_header");
  const logoFooter = pick(cfg, "logo_footer") || logoHeader;
  if (logoHeader) {
    const imgH = document.getElementById("header-logo");
    imgH.src = logoHeader;
    imgH.onerror = () => { imgH.style.display = "none"; };
  }
  if (logoFooter) {
    const imgF = document.getElementById("footer-logo");
    imgF.src = logoFooter;
    imgF.onerror = () => { imgF.style.display = "none"; };
  }

  const marqueeMsg = pick(cfg, "thong_bao_chay");
  if (marqueeMsg) {
    document.getElementById("marquee-text").textContent = marqueeMsg;
    document.getElementById("marquee-bar").classList.remove("hidden");
  }

  const diaChi = pick(cfg, "dia_chi", "dia_chi_lien_he");
  if (diaChi) document.getElementById("footer-dia-chi").textContent = diaChi;

  const dienThoai = pick(cfg, "dien_thoai");
  if (dienThoai) document.getElementById("footer-dien-thoai").textContent = dienThoai;

  const email = pick(cfg, "email");
  if (email) document.getElementById("footer-email").textContent = email;

  const fanpage = pick(cfg, "fanpage");
  if (fanpage) {
    const fpEl = document.getElementById("footer-fanpage");
    fpEl.href = fanpage;
    fpEl.textContent = fanpage;
  }

  if (APP_DATA.updatedAt) {
    const d = new Date(APP_DATA.updatedAt);
    document.getElementById("footer-updated").textContent =
      `Dữ liệu đồng bộ tự động lúc ${d.toLocaleString("vi-VN")}`;
  }

  // Nút đăng ký nhanh trên Header từ CMS_Cong_Tuong_Tac
  const firstAction = APP_DATA.congTuongTac[0];
  const headerBtn = document.getElementById("btn-dang-ky-header");
  if (firstAction && pick(firstAction, "link", "link_dang_ky", "lien_ket")) {
    headerBtn.href = pick(firstAction, "link", "link_dang_ky", "lien_ket");
  } else {
    headerBtn.addEventListener("click", (e) => {
      e.preventDefault();
      switchTab("van-ban");
    });
  }
}

// --- 3.2 KPI Tổng quan ---
function renderOverviewKPIs() {
  const list = APP_DATA.deTai;
  const totalDeTai = list.length;

  let totalLuotSV = 0;
  let totalDatGiai = 0;

  list.forEach(dt => {
    // Ưu tiên đếm từ mảng thanh_vien_chi_tiet nếu có
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
  });

  // Đếm công bố từ danh sách đề tài (nếu có trường công khai) hoặc số bài DOI/công bố
  const totalCongBo = list.filter(dt => {
    const cb = pick(dt, "cong_bo", "bai_bao", "link_tai_lieu", "thong_tin_bo_sung");
    return typeof cb === "string" && cb.trim() !== "" && cb.trim() !== "-";
  }).length;

  animateNumber("kpi-tong-de-tai", totalDeTai);
  animateNumber("kpi-luot-sv", totalLuotSV);
  animateNumber("kpi-dat-giai", totalDatGiai);
  animateNumber("kpi-cong-bo", totalCongBo);
}

function animateNumber(elId, target) {
  const el = document.getElementById(elId);
  if (!el) return;
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

// --- 3.3 Biểu đồ Chart.js ---
function renderOverviewCharts() {
  const list = APP_DATA.deTai;

  // 1. Gom nhóm theo niên khoá (kết hợp cả thống kê lịch sử nếu có)
  const yearMap = {};
  if (Array.isArray(APP_DATA.thongKeLichSu)) {
    APP_DATA.thongKeLichSu.forEach(item => {
      const y = String(pick(item, "nien_khoa", "Niên khoá", "Niên khóa")).trim();
      const sl = Number(pick(item, "sl_de_tai", "SL đề tài")) || 0;
      if (y && sl > 0) yearMap[y] = sl;
    });
  }

  list.forEach(dt => {
    const y = String(pick(dt, "nien_khoa", "Niên khóa", "Niên khoá")).trim() || "Khác";
    // Nếu niên khóa này có trong danh sách chi tiết thì đếm chính xác từ danh sách
    if (!yearMap[`__counted_${y}`]) {
      yearMap[y] = 0;
      yearMap[`__counted_${y}`] = true;
    }
    yearMap[y] += 1;
  });

  const years = Object.keys(yearMap).filter(k => !k.startsWith("__counted_")).sort();
  const yearCounts = years.map(y => yearMap[y]);

  const ctxYear = document.getElementById("chart-nien-khoa");
  if (chartNienKhoaInstance) chartNienKhoaInstance.destroy();
  chartNienKhoaInstance = new Chart(ctxYear, {
    type: "bar",
    data: {
      labels: years,
      datasets: [{
        label: "Số lượng đề tài",
        data: yearCounts,
        backgroundColor: "#144587",
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

  // 2. Gom nhóm theo Bộ môn / Lĩnh vực
  const deptMap = {};
  list.forEach(dt => {
    const d = String(pick(dt, "bo_mon", "Bộ môn / Lĩnh vực")).trim() || "Chưa phân loại";
    deptMap[d] = (deptMap[d] || 0) + 1;
  });
  const depts = Object.keys(deptMap);
  const deptCounts = depts.map(d => deptMap[d]);

  const palette = ["#144587", "#0066b3", "#b81c22", "#d97706", "#059669", "#7c3aed", "#0891b2"];
  const ctxDept = document.getElementById("chart-bo-mon");
  if (chartBoMonInstance) chartBoMonInstance.destroy();
  chartBoMonInstance = new Chart(ctxDept, {
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

// --- 3.4 Widget Trang chủ ---
function renderOverviewWidgets() {
  // 1. Cổng tương tác (CMS_Cong_Tuong_Tac)
  const actionsEl = document.getElementById("hero-actions");
  if (APP_DATA.congTuongTac.length === 0) {
    actionsEl.innerHTML = "";
  } else {
    actionsEl.innerHTML = APP_DATA.congTuongTac.map(item => {
      const tagColor = mapTagColor(pick(item, "mau_nhan", "Màu nhãn"));
      const btnStyle = String(pick(item, "kieu_nut", "kieu_nut_bam", "Kiểu nút bấm")).toLowerCase();
      const link = pick(item, "link", "link_dang_ky", "lien_ket", "Link đăng ký / Liên kết");
      const btnText = pick(item, "chu_nut", "chu_tren_nut_bam", "Chữ trên nút bấm") || "Xem chi tiết";
      const nhan = pick(item, "nhan_phan_loai", "nhan", "Nhãn phân loại") || "THÔNG TIN";
      const tieuDe = pick(item, "tieu_de", "tieu_de_the", "Tiêu đề thẻ");
      const moTa = pick(item, "noi_dung", "noi_dung_mo_ta", "Nội dung mô tả");

      let actionHtml = "";
      if (btnStyle.includes("ghi chú") || !link) {
        actionHtml = `<span class="action-note"><i class="fa-solid fa-circle-info"></i> ${escapeHtml(btnText)}</span>`;
      } else {
        const cls = btnStyle.includes("đỏ") ? "btn btn-red" : "btn btn-outline-primary";
        const isInternal = link.startsWith("#");
        const targetTab = link.replace("#", "").replace("van-ban-bieu-mau", "van-ban");
        actionHtml = isInternal
          ? `<button class="${cls}" onclick="switchTab('${escapeHtml(targetTab)}')">${escapeHtml(btnText)} <i class="fa-solid fa-arrow-right"></i></button>`
          : `<a href="${escapeHtml(link)}" target="_blank" rel="noopener" class="${cls}">${escapeHtml(btnText)} <i class="fa-solid fa-arrow-up-right-from-square"></i></a>`;
      }

      return `
        <div class="action-card">
          <span class="action-tag ${tagColor}">${escapeHtml(nhan)}</span>
          <h4>${escapeHtml(tieuDe)}</h4>
          <p>${escapeHtml(moTa)}</p>
          ${actionHtml}
        </div>
      `;
    }).join("");
  }

  // 2. Thông báo nổi bật trên trang chủ
  const tbHome = document.getElementById("home-thong-bao-list");
  const sortedTB = [...APP_DATA.thongBao].sort((a, b) => {
    const pinA = String(pick(a, "ghim_noi_bat", "Ghim nổi bật")).toLowerCase() === "có" ? 1 : 0;
    const pinB = String(pick(b, "ghim_noi_bat", "Ghim nổi bật")).toLowerCase() === "có" ? 1 : 0;
    return pinB - pinA;
  }).slice(0, 4);

  tbHome.innerHTML = sortedTB.length === 0
    ? `<p class="empty-state">Chưa có thông báo mới.</p>`
    : sortedTB.map(tb => {
        const isPin = String(pick(tb, "ghim_noi_bat", "Ghim nổi bật")).toLowerCase() === "có";
        const phanLoai = pick(tb, "phan_loai", "Phân loại") || "Thông báo";
        const ngayDang = pick(tb, "ngay_dang", "Ngày đăng");
        const tieuDe = pick(tb, "tieu_de", "tieu_de_thong_bao", "Tiêu đề thông báo");
        const tomTat = pick(tb, "tom_tat", "tom_tat_ngan", "Tóm tắt ngắn");
        return `
          <div class="mini-item ${isPin ? "pinned" : ""}">
            <div class="mini-meta">
              ${isPin ? `<span class="badge badge-red"><i class="fa-solid fa-thumbtack"></i> Nổi bật</span>` : ""}
              <span class="badge badge-blue">${escapeHtml(phanLoai)}</span>
              <span><i class="fa-regular fa-calendar"></i> ${escapeHtml(ngayDang)}</span>
            </div>
            <h5>${escapeHtml(tieuDe)}</h5>
            <p>${escapeHtml(tomTat)}</p>
          </div>
        `;
      }).join("");

  // 3. Lịch trình sắp tới trên trang chủ
  const lichHome = document.getElementById("home-lich-list");
  const topLich = APP_DATA.thoiGianBieu.slice(0, 4);
  lichHome.innerHTML = topLich.length === 0
    ? `<p class="empty-state">Chưa có lịch trình công bố.</p>`
    : topLich.map(item => {
        const ngayBD = pick(item, "ngay_bat_dau", "Ngày bắt đầu");
        const gio = pick(item, "gio_cu_the", "Giờ cụ thể");
        const tenHD = pick(item, "ten_hoat_dong", "Tên hoạt động");
        const diaDiem = pick(item, "dia_diem", "Địa điểm");
        return `
          <div class="mini-item">
            <div class="mini-meta">
              <span class="badge badge-amber"><i class="fa-regular fa-clock"></i> ${escapeHtml(ngayBD)} ${gio ? `(${escapeHtml(gio)})` : ""}</span>
            </div>
            <h5>${escapeHtml(tenHD)}</h5>
            <p><i class="fa-solid fa-location-dot"></i> ${escapeHtml(diaDiem || "Khoa Hoá học")}</p>
          </div>
        `;
      }).join("");
}

// --- 3.5 Tab Thông báo NCKH ---
function renderThongBaoFull() {
  const catFilter = document.getElementById("tb-filter-cat").value.toLowerCase();
  const keyword = document.getElementById("tb-search").value.trim().toLowerCase();
  const container = document.getElementById("thong-bao-full-list");

  const filtered = APP_DATA.thongBao.filter(tb => {
    const cat = String(pick(tb, "phan_loai", "Phân loại")).toLowerCase();
    const text = `${pick(tb, "tieu_de", "tieu_de_thong_bao")} ${pick(tb, "tom_tat", "tom_tat_ngan")} ${pick(tb, "noi_dung", "noi_dung_chi_tiet")}`.toLowerCase();
    return (!catFilter || cat.includes(catFilter)) && (!keyword || text.includes(keyword));
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state">Không tìm thấy thông báo phù hợp.</div>`;
    return;
  }

  container.innerHTML = filtered.map(tb => {
    const isPin = String(pick(tb, "ghim_noi_bat", "Ghim nổi bật")).toLowerCase() === "có";
    const link = pick(tb, "link", "link_dinh_kem", "link_dang_ky", "Link đính kèm / Đăng ký");
    const btnText = pick(tb, "ten_nut", "ten_nut_lien_ket", "Tên nút liên kết") || "Xem chi tiết / Đăng ký";
    const hanMoc = pick(tb, "ngay_su_kien", "han_moc", "Ngày sự kiện / Hạn mốc");
    const phanLoai = pick(tb, "phan_loai", "Phân loại") || "Thông báo";
    const ngayDang = pick(tb, "ngay_dang", "Ngày đăng");
    const tieuDe = pick(tb, "tieu_de", "tieu_de_thong_bao", "Tiêu đề thông báo");
    const noiDung = pick(tb, "noi_dung", "noi_dung_chi_tiet") || pick(tb, "tom_tat", "tom_tat_ngan");

    return `
      <article class="notice-card ${isPin ? "pinned" : ""}">
        <div class="notice-header">
          <div class="notice-badges">
            ${isPin ? `<span class="badge badge-red"><i class="fa-solid fa-thumbtack"></i> Ghim nổi bật</span>` : ""}
            <span class="badge badge-blue">${escapeHtml(phanLoai)}</span>
            ${hanMoc ? `<span class="badge badge-amber"><i class="fa-solid fa-hourglass-half"></i> Mốc: ${escapeHtml(hanMoc)}</span>` : ""}
          </div>
          <span style="font-size:0.82rem; color:var(--text-muted);"><i class="fa-regular fa-calendar"></i> Đăng ngày: ${escapeHtml(ngayDang)}</span>
        </div>
        <h3>${escapeHtml(tieuDe)}</h3>
        <p style="white-space: pre-line;">${escapeHtml(noiDung)}</p>
        ${link ? `
          <div class="notice-footer">
            <a href="${escapeHtml(link)}" target="_blank" rel="noopener" class="btn btn-primary btn-sm">
              <i class="fa-solid fa-arrow-up-right-from-square"></i> ${escapeHtml(btnText)}
            </a>
          </div>
        ` : ""}
      </article>
    `;
  }).join("");
}

// --- 3.6 Tab Thời gian biểu ---
function renderThoiGianBieuFull() {
  const catFilter = document.getElementById("lich-filter-cat").value.toLowerCase();
  const keyword = document.getElementById("lich-search").value.trim().toLowerCase();
  const container = document.getElementById("lich-timeline-list");

  const filtered = APP_DATA.thoiGianBieu.filter(item => {
    const cat = String(pick(item, "phan_loai", "Phân loại")).toLowerCase();
    const text = `${pick(item, "ten_hoat_dong")} ${pick(item, "dia_diem")} ${pick(item, "noi_dung", "ghi_chu")}`.toLowerCase();
    return (!catFilter || cat.includes(catFilter)) && (!keyword || text.includes(keyword));
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state">Không tìm thấy mốc thời gian phù hợp.</div>`;
    return;
  }

  container.innerHTML = filtered.map(item => {
    const start = pick(item, "ngay_bat_dau", "Ngày bắt đầu");
    const end = pick(item, "ngay_ket_thuc", "Ngày kết thúc");
    const dateRange = end && end !== start ? `${start} – ${end}` : start;
    const link = pick(item, "link", "link_lien_ket", "Link liên kết");
    const phanLoai = pick(item, "phan_loai", "Phân loại") || "Sự kiện";
    const buoi = pick(item, "buoi_ca", "Buổi / Ca");
    const gio = pick(item, "gio_cu_the", "Giờ cụ thể");
    const tenHD = pick(item, "ten_hoat_dong", "Tên hoạt động");
    const noiDung = pick(item, "noi_dung", "ghi_chu", "Nội dung / Ghi chú");
    const diaDiem = pick(item, "dia_diem", "Địa điểm");
    const phuTrach = pick(item, "don_vi_phu_trach", "phu_trach", "Đơn vị / Phụ trách");

    return `
      <div class="timeline-card">
        <div class="timeline-date">
          <span class="badge badge-blue" style="margin-bottom:6px;">${escapeHtml(phanLoai)}</span>
          <div class="date-main">${escapeHtml(dateRange)}</div>
          <div class="date-sub">${escapeHtml(buoi)} ${gio ? `• ${escapeHtml(gio)}` : ""}</div>
        </div>
        <div class="timeline-body">
          <h4>${escapeHtml(tenHD)}</h4>
          ${noiDung ? `<p>${escapeHtml(noiDung)}</p>` : ""}
          <div class="timeline-meta">
            ${diaDiem ? `<span><i class="fa-solid fa-location-dot"></i> ${escapeHtml(diaDiem)}</span>` : ""}
            ${phuTrach ? `<span><i class="fa-solid fa-user-tie"></i> ${escapeHtml(phuTrach)}</span>` : ""}
            ${link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener" style="color:var(--primary); font-weight:600;"><i class="fa-solid fa-link"></i> Tham gia / Tài liệu</a>` : ""}
          </div>
        </div>
      </div>
    `;
  }).join("");
}

// --- 3.7 Tab Đề tài SV NCKH ---
function populateDeTaiFilters() {
  const yearSet = new Set();
  const deptSet = new Set();

  APP_DATA.deTai.forEach(dt => {
    const y = String(pick(dt, "nien_khoa", "Niên khóa", "Niên khoá")).trim();
    const d = String(pick(dt, "bo_mon", "Bộ môn / Lĩnh vực")).trim();
    if (y) yearSet.add(y);
    if (d) deptSet.add(d);
  });

  const yearSel = document.getElementById("dt-filter-year");
  const gtYearSel = document.getElementById("gt-filter-year");
  [...yearSet].sort().reverse().forEach(y => {
    yearSel.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(y)}">${escapeHtml(y)}</option>`);
    gtYearSel.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(y)}">${escapeHtml(y)}</option>`);
  });

  const deptSel = document.getElementById("dt-filter-dept");
  [...deptSet].sort().forEach(d => {
    deptSel.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`);
  });
}

function renderDeTaiTable() {
  const yearF = document.getElementById("dt-filter-year").value;
  const deptF = document.getElementById("dt-filter-dept").value;
  const statusF = document.getElementById("dt-filter-status").value.toLowerCase();
  const awardF = document.getElementById("dt-filter-award").value;
  const kw = document.getElementById("dt-search").value.trim().toLowerCase();

  const filtered = APP_DATA.deTai.filter(dt => {
    const y = String(pick(dt, "nien_khoa", "Niên khóa", "Niên khoá")).trim();
    const d = String(pick(dt, "bo_mon", "Bộ môn / Lĩnh vực")).trim();
    const st = String(pick(dt, "trang_thai", "Trạng thái")).toLowerCase();
    const gk = cleanAward(pick(dt, "giai_khoa", "Giải cấp Khoa"));
    const gt = cleanAward(pick(dt, "giai_truong", "Giải cấp Trường"));
    const gb = cleanAward(pick(dt, "giai_bo", "Giải cấp Bộ"));

    if (yearF && y !== yearF) return false;
    if (deptF && d !== deptF) return false;
    if (statusF && !st.includes(statusF)) return false;
    if (awardF === "bo" && !gb) return false;
    if (awardF === "truong" && !gt) return false;
    if (awardF === "khoa" && !gk) return false;

    if (kw) {
      const fullText = `${pick(dt, "ten_de_tai")} ${pick(dt, "sv_chu_nhiem")} ${pick(dt, "sv_tham_gia")} ${pick(dt, "gvhd")} ${pick(dt, "tu_khoa")}`.toLowerCase();
      if (!fullText.includes(kw)) return false;
    }
    return true;
  });

  document.getElementById("dt-count-label").textContent = `Hiển thị ${filtered.length} / ${APP_DATA.deTai.length} đề tài`;
  const tbody = document.getElementById("de-tai-tbody");

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Không có đề tài nào khớp với điều kiện lọc.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(dt => {
    const idx = APP_DATA.deTai.indexOf(dt);
    const nienKhoa = pick(dt, "nien_khoa", "Niên khóa");
    const tenDeTai = pick(dt, "ten_de_tai", "Tên đề tài");
    const boMon = pick(dt, "bo_mon", "Bộ môn / Lĩnh vực");
    const svCN = pick(dt, "sv_chu_nhiem", "SV chủ nhiệm");
    const svTG = pick(dt, "sv_tham_gia", "SV tham gia");
    const gvhd = pick(dt, "gvhd", "Giảng viên hướng dẫn");
    const trangThai = pick(dt, "trang_thai", "Trạng thái") || "Đang thực hiện";
    const awardsHtml = renderAwardBadges(dt);

    return `
      <tr>
        <td><strong>${escapeHtml(nienKhoa)}</strong></td>
        <td>
          <div class="topic-title-cell" onclick="openDeTaiModal(${idx})">${escapeHtml(tenDeTai)}</div>
          <div class="topic-sub-cell">${escapeHtml(boMon)}</div>
        </td>
        <td>
          <div><strong>${escapeHtml(svCN)}</strong></div>
          ${svTG && svTG !== "-" ? `<div class="topic-sub-cell">TV: ${escapeHtml(svTG)}</div>` : ""}
        </td>
        <td>${escapeHtml(gvhd)}</td>
        <td>${awardsHtml || `<span style="color:var(--text-muted); font-size:0.82rem;">—</span>`}</td>
        <td><span class="badge ${trangThai.toLowerCase().includes("nghiệm thu") ? "badge-green" : "badge-blue"}">${escapeHtml(trangThai)}</span></td>
        <td>
          <button class="btn btn-outline-primary btn-sm" onclick="openDeTaiModal(${idx})">
            <i class="fa-solid fa-eye"></i> Chi tiết
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

function openDeTaiModal(index) {
  const dt = APP_DATA.deTai[index];
  if (!dt) return;

  document.getElementById("modal-title").textContent = pick(dt, "ten_de_tai", "Tên đề tài");

  // Xây dựng danh sách thành viên chi tiết
  let membersHtml = "";
  if (Array.isArray(dt.thanh_vien_chi_tiet) && dt.thanh_vien_chi_tiet.length > 0) {
    membersHtml = `<ul style="margin:6px 0 0 18px;">` +
      dt.thanh_vien_chi_tiet.map(m => {
        const vaiTro = pick(m, "vai_tro", "Vai trò") || "Thành viên";
        const hoTen = pick(m, "ho_ten", "ho_va_ten_sv", "ten_sv", "Họ và tên SV");
        const nganh = pick(m, "nganh", "Ngành");
        return `<li><strong>${escapeHtml(vaiTro)}:</strong> ${escapeHtml(hoTen)}${nganh ? ` (${escapeHtml(nganh)})` : ""}</li>`;
      }).join("") + `</ul>`;
  } else {
    membersHtml = `
      <div><strong>SV chủ nhiệm:</strong> ${escapeHtml(pick(dt, "sv_chu_nhiem", "SV chủ nhiệm"))}</div>
      <div><strong>SV tham gia:</strong> ${escapeHtml(pick(dt, "sv_tham_gia", "SV tham gia") || "Không có")}</div>
    `;
  }

  const awardsHtml = renderAwardBadges(dt);
  const linkQD = pick(dt, "link_tai_lieu", "Link QĐ công nhận / Kỷ yếu");
  const tomTat = pick(dt, "tom_tat", "Tóm tắt đề tài");

  document.getElementById("modal-body").innerHTML = `
    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:12px; background:var(--bg-body); padding:14px; border-radius:8px; margin-bottom:16px;">
      <div><small style="color:var(--text-muted);">Niên khoá</small><br><strong>${escapeHtml(pick(dt, "nien_khoa"))}</strong></div>
      <div><small style="color:var(--text-muted);">Mã đề tài</small><br><strong>${escapeHtml(pick(dt, "ma_so") || "—")}</strong></div>
      <div><small style="color:var(--text-muted);">Bộ môn / Lĩnh vực</small><br><strong>${escapeHtml(pick(dt, "bo_mon") || "—")}</strong></div>
      <div><small style="color:var(--text-muted);">Trạng thái</small><br><strong>${escapeHtml(pick(dt, "trang_thai") || "—")}</strong></div>
    </div>

    <div style="margin-bottom:14px;">
      <h4 style="color:var(--primary); margin-bottom:4px;"><i class="fa-solid fa-chalkboard-user"></i> Giảng viên hướng dẫn</h4>
      <p style="font-weight:600;">${escapeHtml(pick(dt, "gvhd"))}</p>
    </div>

    <div style="margin-bottom:14px;">
      <h4 style="color:var(--primary); margin-bottom:4px;"><i class="fa-solid fa-users"></i> Nhóm sinh viên thực hiện</h4>
      ${membersHtml}
    </div>

    ${awardsHtml ? `
      <div style="margin-bottom:14px;">
        <h4 style="color:var(--primary); margin-bottom:6px;"><i class="fa-solid fa-trophy"></i> Thành tích & Giải thưởng</h4>
        <div>${awardsHtml}</div>
      </div>
    ` : ""}

    ${tomTat ? `
      <div style="margin-bottom:14px;">
        <h4 style="color:var(--primary); margin-bottom:4px;"><i class="fa-solid fa-align-left"></i> Tóm tắt nội dung nghiên cứu</h4>
        <p style="white-space:pre-line; background:#f8fafc; padding:12px; border-radius:8px; border:1px solid var(--border);">${escapeHtml(tomTat)}</p>
      </div>
    ` : ""}

    ${linkQD && linkQD !== "-" ? `
      <div style="margin-top:16px;">
        <a href="${escapeHtml(linkQD)}" target="_blank" rel="noopener" class="btn btn-primary">
          <i class="fa-solid fa-file-pdf"></i> Xem Quyết định công nhận / Kỷ yếu
        </a>
      </div>
    ` : ""}
  `;

  document.getElementById("detail-modal").classList.remove("hidden");
}

function closeModal() {
  document.getElementById("detail-modal").classList.add("hidden");
}

// --- 3.8 Tab Công trình & Giải thưởng ---
function renderGiaiThuongTab() {
  const yearF = document.getElementById("gt-filter-year").value;
  const levelF = document.getElementById("gt-filter-level").value;
  const kw = document.getElementById("gt-search").value.trim().toLowerCase();
  const container = document.getElementById("giai-thuong-list");

  const awardItems = APP_DATA.deTai.filter(dt => {
    const gk = cleanAward(pick(dt, "giai_khoa"));
    const gt = cleanAward(pick(dt, "giai_truong"));
    const gb = cleanAward(pick(dt, "giai_bo"));
    if (!gk && !gt && !gb) return false;

    if (yearF && String(pick(dt, "nien_khoa")).trim() !== yearF) return false;
    if (levelF === "bo" && !gb) return false;
    if (levelF === "truong" && !gt) return false;
    if (levelF === "khoa" && !gk) return false;

    if (kw) {
      const txt = `${pick(dt, "ten_de_tai")} ${pick(dt, "sv_chu_nhiem")} ${pick(dt, "sv_tham_gia")} ${pick(dt, "gvhd")}`.toLowerCase();
      if (!txt.includes(kw)) return false;
    }
    return true;
  });

  if (awardItems.length === 0) {
    container.innerHTML = `<div class="empty-state">Chưa tìm thấy đề tài đạt giải phù hợp.</div>`;
    return;
  }

  container.innerHTML = awardItems.map(dt => {
    const idx = APP_DATA.deTai.indexOf(dt);
    return `
      <div class="award-card">
        <div class="award-icon"><i class="fa-solid fa-award"></i></div>
        <div class="award-info">
          <div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:6px;">
            <span class="badge badge-blue">${escapeHtml(pick(dt, "nien_khoa"))}</span>
            ${renderAwardBadges(dt)}
          </div>
          <h4>${escapeHtml(pick(dt, "ten_de_tai"))}</h4>
          <p><strong>SV chủ nhiệm:</strong> ${escapeHtml(pick(dt, "sv_chu_nhiem"))} • <strong>GVHD:</strong> ${escapeHtml(pick(dt, "gvhd"))}</p>
        </div>
        <div>
          <button class="btn btn-outline-primary btn-sm" onclick="openDeTaiModal(${idx})">Xem hồ sơ</button>
        </div>
      </div>
    `;
  }).join("");
}

// --- 3.9 Tab Seminar & Hội nghị ---
function renderSeminarTab() {
  const statusF = document.getElementById("sem-filter-status").value.toLowerCase();
  const kw = document.getElementById("sem-search").value.trim().toLowerCase();
  const container = document.getElementById("seminar-list");

  const filtered = APP_DATA.seminar.filter(s => {
    const st = String(pick(s, "trang_thai", "Trạng thái")).toLowerCase();
    const txt = `${pick(s, "ten_su_kien")} ${pick(s, "dien_gia", "dien_gia_don_vi")} ${pick(s, "loai_hoat_dong")}`.toLowerCase();
    return (!statusF || st.includes(statusF)) && (!kw || txt.includes(kw));
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state">Chưa có sự kiện seminar / hội nghị phù hợp.</div>`;
    return;
  }

  container.innerHTML = filtered.map(s => {
    const st = pick(s, "trang_thai", "Trạng thái") || "Sắp diễn ra";
    const isPast = st.toLowerCase().includes("đã");
    const regLink = pick(s, "link_dang_ky", "Link đăng ký (Form)");
    const docLink = pick(s, "link_tai_lieu", "Link tài liệu / Kỷ yếu");
    const thoiGian = pick(s, "thoi_gian", "ngay_bat_dau", "Thời gian");

    return `
      <div class="seminar-card">
        <div class="seminar-top">
          <span class="badge ${isPast ? "badge-green" : "badge-red"}">${escapeHtml(st)}</span>
          <span class="badge badge-blue">${escapeHtml(pick(s, "loai_hoat_dong") || "Chuyên đề")}</span>
        </div>
        <h3>${escapeHtml(pick(s, "ten_su_kien"))}</h3>
        <div class="seminar-speaker"><i class="fa-solid fa-microphone-lines"></i> ${escapeHtml(pick(s, "dien_gia", "dien_gia_don_vi"))}</div>
        <p>${escapeHtml(pick(s, "tom_tat", "tom_tat_noi_dung"))}</p>
        <div class="seminar-meta">
          <div><i class="fa-regular fa-clock"></i> <strong>Thời gian:</strong> ${escapeHtml(thoiGian)}</div>
          <div><i class="fa-solid fa-location-dot"></i> <strong>Địa điểm:</strong> ${escapeHtml(pick(s, "dia_diem"))}</div>
        </div>
        <div class="seminar-actions">
          ${!isPast && regLink ? `<a href="${escapeHtml(regLink)}" target="_blank" rel="noopener" class="btn btn-red btn-sm"><i class="fa-solid fa-pen-to-square"></i> Đăng ký tham dự</a>` : ""}
          ${docLink ? `<a href="${escapeHtml(docLink)}" target="_blank" rel="noopener" class="btn btn-outline-primary btn-sm"><i class="fa-solid fa-book-open"></i> Tài liệu / Kỷ yếu</a>` : ""}
        </div>
      </div>
    `;
  }).join("");
}

// --- 3.10 Tab Văn bản & Biểu mẫu ---
function renderVanBanTab() {
  const catF = document.getElementById("vb-filter-cat").value.toLowerCase();
  const kw = document.getElementById("vb-search").value.trim().toLowerCase();
  const container = document.getElementById("van-ban-list");

  const filtered = APP_DATA.vanBan.filter(v => {
    const cat = String(pick(v, "phan_loai", "Phân loại")).toLowerCase();
    const txt = `${pick(v, "ten_van_ban", "ten")} ${cat}`.toLowerCase();
    return (!catF || cat.includes(catF)) && (!kw || txt.includes(kw));
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state">Chưa tìm thấy văn bản / biểu mẫu phù hợp.</div>`;
    return;
  }

  container.innerHTML = filtered.map(v => {
    const fmt = String(pick(v, "dinh_dang", "Định dạng")).toUpperCase();
    let iconCls = "fa-file-lines";
    let boxCls = "doc-other";
    if (fmt.includes("PDF")) { iconCls = "fa-file-pdf"; boxCls = "doc-pdf"; }
    else if (fmt.includes("RAR") || fmt.includes("ZIP")) { iconCls = "fa-file-zipper"; boxCls = "doc-rar"; }
    else if (fmt.includes("FOLDER")) { iconCls = "fa-folder-open"; boxCls = "doc-folder"; }

    const link = pick(v, "link", "link_tai", "link_tai_xem", "Link tải / Xem") || "#";

    return `
      <div class="doc-card">
        <div class="doc-icon ${boxCls}"><i class="fa-solid ${iconCls}"></i></div>
        <div class="doc-info">
          <h4>${escapeHtml(pick(v, "ten_van_ban", "ten", "Tên văn bản / Biểu mẫu"))}</h4>
          <p>${escapeHtml(pick(v, "phan_loai", "Phân loại"))} ${fmt ? `• Định dạng: <strong>${escapeHtml(fmt)}</strong>` : ""}</p>
        </div>
        <a href="${escapeHtml(link)}" target="_blank" rel="noopener" class="btn btn-primary btn-sm">
          <i class="fa-solid fa-download"></i> Mở / Tải về
        </a>
      </div>
    `;
  }).join("");
}

// ==========================================
// 4. LẮNG NGHE BỘ LỌC & HÀM TIỆN ÍCH
// ==========================================
function setupFilters() {
  document.getElementById("tb-filter-cat").addEventListener("change", renderThongBaoFull);
  document.getElementById("tb-search").addEventListener("input", renderThongBaoFull);

  document.getElementById("lich-filter-cat").addEventListener("change", renderThoiGianBieuFull);
  document.getElementById("lich-search").addEventListener("input", renderThoiGianBieuFull);

  document.getElementById("dt-filter-year").addEventListener("change", renderDeTaiTable);
  document.getElementById("dt-filter-dept").addEventListener("change", renderDeTaiTable);
  document.getElementById("dt-filter-status").addEventListener("change", renderDeTaiTable);
  document.getElementById("dt-filter-award").addEventListener("change", renderDeTaiTable);
  document.getElementById("dt-search").addEventListener("input", renderDeTaiTable);

  document.getElementById("gt-filter-year").addEventListener("change", renderGiaiThuongTab);
  document.getElementById("gt-filter-level").addEventListener("change", renderGiaiThuongTab);
  document.getElementById("gt-search").addEventListener("input", renderGiaiThuongTab);

  document.getElementById("sem-filter-status").addEventListener("change", renderSeminarTab);
  document.getElementById("sem-search").addEventListener("input", renderSeminarTab);

  document.getElementById("vb-filter-cat").addEventListener("change", renderVanBanTab);
  document.getElementById("vb-search").addEventListener("input", renderVanBanTab);

  document.getElementById("detail-modal").addEventListener("click", (e) => {
    if (e.target.id === "detail-modal") closeModal();
  });
}

function cleanAward(val) {
  const s = String(val || "").trim();
  if (!s || s === "-" || s === "—" || s.toLowerCase() === "không") return "";
  return s;
}

function renderAwardBadges(dt) {
  const gk = cleanAward(pick(dt, "giai_khoa"));
  const gt = cleanAward(pick(dt, "giai_truong"));
  const gb = cleanAward(pick(dt, "giai_bo"));
  let html = "";
  if (gb) html += `<span class="badge badge-red"><i class="fa-solid fa-medal"></i> Giải ${escapeHtml(gb)} cấp Bộ</span> `;
  if (gt) html += `<span class="badge badge-amber"><i class="fa-solid fa-trophy"></i> Giải ${escapeHtml(gt)} cấp Trường</span> `;
  if (gk) html += `<span class="badge badge-blue"><i class="fa-solid fa-star"></i> Giải ${escapeHtml(gk)} cấp Khoa</span> `;
  return html;
}

function mapTagColor(colorText) {
  const c = String(colorText || "").toLowerCase();
  if (c.includes("đỏ") || c.includes("red")) return "tag-red";
  if (c.includes("vàng") || c.includes("amber")) return "tag-amber";
  return "tag-blue";
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
