// =========================================================================
// CẤU HÌNH KẾT NỐI API GOOGLE APPS SCRIPT
// =========================================================================
const API_URL = "https://script.google.com/macros/s/AKfycbz89h-27T4L45tL1uS3O87q-w2f5h42wR8w5s/exec";

// Biến lưu trữ dữ liệu toàn cục
let globalData = {
    deTai: [],
    thanhVien: [],
    seminar: [],
    vanBan: [],
    thongBao: [],
    thoiGianBieu: [],
    congTuongTac: [],
    cauHinh: {}
};

// Danh sách lịch hợp nhất từ 3 nguồn cho Tab Thời gian biểu
let unifiedScheduleEvents = [];

// Trạng thái điều khiển Thời gian biểu
let scheduleState = {
    view: 'week', // 'week' | 'month' | 'list'
    currentDate: new Date()
};

// Trạng thái cuộn dọc tự động cho Thông báo
let autoScrollState = {
    overviewPaused: false,
    overviewHovering: false,
    overviewTimer: null,
    overviewAccum: 0,
    tabEnabled: false,
    tabHovering: false,
    tabTimer: null,
    tabAccum: 0
};

let chartNienKhoaInstance = null;
let chartLinhVucInstance = null;

// =========================================================================
// 1. CHUẨN HOÁ CHÍNH TẢ ("Hoá", "Khoá") & TIỆN ÍCH AN TOÀN DỮ LIỆU
// =========================================================================
function normalizeSpelling(text) {
    if (typeof text !== 'string' || !text) return text;
    // Bỏ qua chuỗi là URL, email hoặc mã neo nội bộ để tránh làm sai lệch liên kết
    if (/^(https?:\/\/|mailto:|tel:|#)/i.test(text.trim())) {
        return text;
    }
    return text
        .replace(/Hóa/g, 'Hoá')
        .replace(/hóa/g, 'hoá')
        .replace(/HÓA/g, 'HOÁ')
        .replace(/Khóa/g, 'Khoá')
        .replace(/khóa/g, 'khoá')
        .replace(/KHÓA/g, 'KHÓA');
}

function normalizeDataRecursive(value) {
    if (typeof value === 'string') {
        return normalizeSpelling(value);
    }
    if (Array.isArray(value)) {
        return value.map(item => normalizeDataRecursive(item));
    }
    if (value && typeof value === 'object') {
        const result = {};
        for (const [k, v] of Object.entries(value)) {
            const normKey = normalizeSpelling(k);
            result[normKey] = normalizeDataRecursive(v);
        }
        return result;
    }
    return value;
}

function normalizeDOMText(rootNode) {
    if (!rootNode) return;
    const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while ((node = walker.nextNode())) {
        if (node.nodeValue && /[Hh]óa|HÓA|[Kk]hóa|KHÓA/.test(node.nodeValue)) {
            node.nodeValue = normalizeSpelling(node.nodeValue);
        }
    }
    document.title = normalizeSpelling(document.title);
}

function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function isRowVisible(val) {
    if (val === undefined || val === null || String(val).trim() === '') return true;
    const v = String(val).trim().toLowerCase();
    return !['không', 'khong', 'ẩn', 'an', 'false', '0', 'no'].includes(v);
}

// =========================================================================
// 2. TIỆN ÍCH XỬ LÝ NGÀY THÁNG CHUẨN VIỆT NAM (TRÁNH LỆCH MÚI GIỜ UTC+7)
// =========================================================================
function parseVNDate(input) {
    if (!input) return null;
    if (input instanceof Date && !isNaN(input)) {
        return new Date(input.getFullYear(), input.getMonth(), input.getDate());
    }
    const str = String(input).trim();
    if (!str) return null;

    // 1. Chuỗi ISO từ Google Sheets (VD: 2026-11-22T17:00:00.000Z)
    if (/^\d{4}-\d{2}-\d{2}T/.test(str)) {
        const d = new Date(str);
        if (!isNaN(d)) {
            // Chuyển sang giờ Việt Nam (UTC+7)
            const vnTime = new Date(d.getTime() + (7 * 60 + d.getTimezoneOffset()) * 60000);
            return new Date(vnTime.getFullYear(), vnTime.getMonth(), vnTime.getDate());
        }
    }

    // 2. Định dạng dd/mm/yyyy hoặc d/m/yyyy hoặc dd-mm-yyyy
    const vnMatch = str.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (vnMatch) {
        const day = parseInt(vnMatch[1], 10);
        const month = parseInt(vnMatch[2], 10) - 1;
        const year = parseInt(vnMatch[3], 10);
        const d = new Date(year, month, day);
        if (d.getFullYear() === year && d.getMonth() === month && d.getDate() === day) {
            return d;
        }
    }

    // 3. Định dạng yyyy-mm-dd
    const isoMatch = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (isoMatch) {
        const year = parseInt(isoMatch[1], 10);
        const month = parseInt(isoMatch[2], 10) - 1;
        const day = parseInt(isoMatch[3], 10);
        return new Date(year, month, day);
    }

    return null;
}

function formatVNDate(dateObj) {
    if (!dateObj || !(dateObj instanceof Date) || isNaN(dateObj)) return '';
    const dd = String(dateObj.getDate()).padStart(2, '0');
    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
    const yyyy = dateObj.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}

function isSameDay(d1, d2) {
    if (!d1 || !d2) return false;
    return d1.getFullYear() === d2.getFullYear() &&
           d1.getMonth() === d2.getMonth() &&
           d1.getDate() === d2.getDate();
}

function isDateInRange(targetDate, startDate, endDate) {
    if (!targetDate || !startDate) return false;
    const t = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate()).getTime();
    const s = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()).getTime();
    const e = endDate
        ? new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()).getTime()
        : s;
    return t >= s && t <= Math.max(s, e);
}

// =========================================================================
// 3. KHỞI TẠO & TẢI DỮ LIỆU TỪ GOOGLE SHEETS
// =========================================================================
document.addEventListener("DOMContentLoaded", () => {
    normalizeDOMText(document.body);
    fetchPortalData();
});

async function fetchPortalData() {
    try {
        const response = await fetch(API_URL);
        const rawJson = await response.json();
        const data = normalizeDataRecursive(rawJson);

        // Xử lý dữ liệu Đề tài (Bỏ qua dòng ghi chú CÔNG KHAI / NỘI BỘ)
        const rawDeTai = data.deTai || [];
        globalData.deTai = rawDeTai.filter(item => {
            const nienKhoa = String(item["Niên khoá"] || "").trim();
            const tenDeTai = String(item["Tên đề tài"] || "").trim();
            return nienKhoa !== "" && nienKhoa !== "CÔNG KHAI" && tenDeTai !== "";
        });

        // Xử lý dữ liệu Thành viên
        const rawThanhVien = data.thanhVien || [];
        globalData.thanhVien = rawThanhVien.filter(item => {
            const nienKhoa = String(item["Niên khoá"] || "").trim();
            return nienKhoa !== "" && nienKhoa !== "CÔNG KHAI";
        });

        // Xử lý dữ liệu Seminar
        const rawSeminar = data.seminar || [];
        globalData.seminar = rawSeminar.filter(item => {
            const ten = String(item["Tên sự kiện"] || "").trim();
            return ten !== "" && ten !== "CÔNG KHAI";
        });

        // Xử lý dữ liệu Văn bản
        const rawVanBan = data.vanBan || [];
        globalData.vanBan = rawVanBan.filter(item => {
            const ten = String(item["Tên văn bản / Biểu mẫu"] || "").trim();
            return ten !== "" && ten !== "CÔNG KHAI";
        });

        // Xử lý dữ liệu Thông báo NCKH (CMS_ThongBao_NCKH)
        const rawThongBao = data.thongBao || data.thongBaoNCKH || data.CMS_ThongBao_NCKH || [];
        globalData.thongBao = rawThongBao
            .filter(item => {
                const title = String(item["Tiêu đề thông báo"] || "").trim();
                return title !== "" && title !== "CÔNG KHAI" && isRowVisible(item["Hiển thị"]);
            })
            .sort((a, b) => {
                const pinA = String(a["Ghim nổi bật"] || "").trim().toLowerCase() === 'có' ? 1 : 0;
                const pinB = String(b["Ghim nổi bật"] || "").trim().toLowerCase() === 'có' ? 1 : 0;
                if (pinA !== pinB) return pinB - pinA;
                const dateA = parseVNDate(a["Ngày đăng"]);
                const dateB = parseVNDate(b["Ngày đăng"]);
                if (dateA && dateB) return dateB - dateA;
                return 0;
            });

        // Xử lý dữ liệu Thời gian biểu nhập trực tiếp (CMS_ThoiGianBieu)
        const rawThoiGianBieu = data.thoiGianBieu || data.lichHoatDong || data.CMS_ThoiGianBieu || [];
        globalData.thoiGianBieu = rawThoiGianBieu.filter(item => {
            const ten = String(item["Tên hoạt động"] || "").trim();
            return ten !== "" && ten !== "CÔNG KHAI" && isRowVisible(item["Hiển thị"]);
        });

        // Xử lý dữ liệu Cổng Tương tác (CMS_Cong_Tuong_Tac)
        const rawCongTuongTac = data.congTuongTac || data.tuongTac || data.CMS_Cong_Tuong_Tac || [];
        globalData.congTuongTac = rawCongTuongTac
            .filter(item => {
                const title = String(item["Tiêu đề thẻ"] || "").trim();
                return title !== "" && title !== "CÔNG KHAI" && isRowVisible(item["Hiển thị"]);
            })
            .sort((a, b) => (parseInt(a["Thứ tự"], 10) || 99) - (parseInt(b["Thứ tự"], 10) || 99));

        // Xử lý Cấu hình Hệ thống (Hỗ trợ cả dạng Object key-value lẫn mảng dòng từ CMS_CauHinh_HeThong)
        const rawCauHinh = data.cauHinh || data.CMS_CauHinh_HeThong || {};
        if (Array.isArray(rawCauHinh)) {
            const cfgMap = {};
            rawCauHinh.forEach(row => {
                const key = String(row["Mã cấu hình"] || "").trim();
                const val = row["Giá trị hiển thị trên Web"];
                if (key && val !== undefined && val !== null && String(val).trim() !== "") {
                    cfgMap[key] = String(val).trim();
                }
            });
            globalData.cauHinh = cfgMap;
        } else {
            globalData.cauHinh = rawCauHinh;
        }

        // Xây dựng dữ liệu hợp nhất cho Thời gian biểu
        buildUnifiedSchedule();

        // Cập nhật giao diện
        applySystemConfig();
        renderKPIs();
        renderCharts();
        renderCongTuongTac();
        renderOverviewThongBao();
        renderOverviewSchedule();
        initThongBaoFilters();
        renderThongBaoTab();
        initScheduleFilters();
        renderScheduleView();
        initFilters();
        applyFilters();
        renderCongTrinh();
        renderSeminar();
        renderVanBan();

        // Ẩn màn hình loading, hiển thị trang chính
        document.getElementById("loading-screen").classList.add("hidden");
        document.getElementById("main-content").classList.remove("hidden");

        // Bắt đầu cuộn dọc tự động cho khung Thông báo trên Tổng quan
        startOverviewAutoScroll();

    } catch (error) {
        console.error("Lỗi khi tải dữ liệu:", error);
        document.getElementById("loading-screen").innerHTML = `
            <div class="text-center p-6 bg-red-50 border border-red-200 rounded-xl max-w-md">
                <i class="fa-solid fa-triangle-exclamation text-3xl text-[#C8102E] mb-2"></i>
                <h3 class="font-bold text-slate-800">Không thể kết nối cơ sở dữ liệu</h3>
                <p class="text-xs text-slate-600 mt-1">Vui lòng kiểm tra kết nối mạng hoặc đường dẫn Google Apps Script API.</p>
                <button onclick="location.reload()" class="mt-4 px-4 py-2 bg-[#0B3C78] text-white text-xs font-semibold rounded-lg">Thử lại</button>
            </div>
        `;
    }
}

// =========================================================================
// 4. ÁP DỤNG CẤU HÌNH HỆ THỐNG TỪ GOOGLE SHEETS
// =========================================================================
function applySystemConfig() {
    const cfg = globalData.cauHinh || {};
    if (cfg.ten_khoa) {
        const el = document.getElementById("header-ten-khoa");
        if (el) el.textContent = normalizeSpelling(cfg.ten_khoa);
    }
    if (cfg.ten_truong) {
        const el = document.getElementById("header-ten-truong");
        if (el) el.textContent = normalizeSpelling(cfg.ten_truong);
    }
    if (cfg.tieu_de_cong) {
        const el = document.getElementById("header-tieu-de");
        if (el) el.textContent = normalizeSpelling(cfg.tieu_de_cong);
    }
    if (cfg.logo_header) {
        const img = document.getElementById("header-logo");
        if (img) img.src = cfg.logo_header;
    }
    if (cfg.tieu_de_banner) {
        const el = document.getElementById("banner-title");
        if (el) el.textContent = normalizeSpelling(cfg.tieu_de_banner);
    }
    if (cfg.mo_ta_banner) {
        const el = document.getElementById("banner-desc");
        if (el) el.textContent = normalizeSpelling(cfg.mo_ta_banner);
    }
    if (cfg.dia_chi_lien_he) {
        const el = document.getElementById("footer-dia-chi");
        if (el) el.textContent = `Địa chỉ: ${normalizeSpelling(cfg.dia_chi_lien_he)}`;
    }
    if (cfg.ten_khoa && cfg.ten_truong) {
        const el = document.getElementById("footer-ten-don-vi");
        if (el) el.textContent = normalizeSpelling(`${cfg.ten_khoa} - ${cfg.ten_truong}`);
    }
    if (cfg.link_dang_ky_nhanh) {
        const btn = document.getElementById("btn-dang-ky-header");
        if (btn) {
            btn.href = cfg.link_dang_ky_nhanh;
            if (!cfg.link_dang_ky_nhanh.startsWith("#")) {
                btn.target = "_blank";
                btn.removeAttribute("onclick");
            }
        }
    }

    // Cập nhật huy hiệu số lượng thông báo
    const badge = document.getElementById("nav-tb-badge");
    if (badge && globalData.thongBao.length > 0) {
        badge.textContent = globalData.thongBao.length;
        badge.classList.remove("hidden");
    }

    // Cấu hình tự động cuộn từ sheet (nếu có)
    if (cfg.tu_dong_cuon_thong_bao && ['tắt', 'tat', 'false', '0', 'không'].includes(String(cfg.tu_dong_cuon_thong_bao).trim().toLowerCase())) {
        autoScrollState.overviewPaused = true;
        updateOverviewScrollButton();
    }
}

// =========================================================================
// 5. ĐIỀU HƯỚNG TAB
// =========================================================================
function switchTab(tabId) {
    document.querySelectorAll(".tab-content").forEach(el => el.classList.remove("active"));
    document.querySelectorAll(".nav-btn").forEach(btn => {
        btn.classList.remove("active", "border-[#0B3C78]", "text-[#0B3C78]", "font-semibold");
        btn.classList.add("border-transparent", "text-slate-600", "font-medium");
    });

    const targetSection = document.getElementById(`content-${tabId}`);
    const targetBtn = document.getElementById(`tab-${tabId}`);
    if (targetSection) targetSection.classList.add("active");
    if (targetBtn) {
        targetBtn.classList.add("active", "border-[#0B3C78]", "text-[#0B3C78]", "font-semibold");
        targetBtn.classList.remove("border-transparent", "text-slate-600", "font-medium");
    }
}

// =========================================================================
// 6. THỐNG KÊ KPI & BIỂU ĐỒ (TAB TỔNG QUAN)
// =========================================================================
function renderKPIs() {
    const deTai = globalData.deTai;
    const tongDeTai = deTai.length;

    let tongSV = globalData.thanhVien.length;
    if (tongSV === 0) {
        deTai.forEach(dt => {
            if (dt["SV chủ nhiệm"]) tongSV += 1;
            if (dt["SV tham gia"]) {
                tongSV += String(dt["SV tham gia"]).split(/[,;]/).filter(s => s.trim() !== "").length;
            }
        });
    }

    const tongGiai = deTai.filter(dt => {
        const k = String(dt["Giải cấp Khoa"] || "").trim();
        const t = String(dt["Giải cấp Trường"] || "").trim();
        const b = String(dt["Giải cấp Bộ"] || "").trim();
        return (k !== "" && k !== "-") || (t !== "" && t !== "-") || (b !== "" && b !== "-");
    }).length;

    const tongBaiBao = deTai.filter(dt => {
        const qt = String(dt["Bài báo khoa học quốc tế"] || "").trim();
        const tn = String(dt["Bài báo khoa học trong nước"] || "").trim();
        return (qt !== "" && qt !== "-") || (tn !== "" && tn !== "-");
    }).length;

    document.getElementById("kpi-tong-de-tai").textContent = tongDeTai;
    document.getElementById("kpi-tong-sv").textContent = tongSV;
    document.getElementById("kpi-tong-giai").textContent = tongGiai;
    document.getElementById("kpi-tong-bai-bao").textContent = tongBaiBao;
}

function renderCharts() {
    const deTai = globalData.deTai;

    const countByYear = {};
    deTai.forEach(dt => {
        const nk = String(dt["Niên khoá"] || "Khác").trim();
        countByYear[nk] = (countByYear[nk] || 0) + 1;
    });
    const sortedYears = Object.keys(countByYear).sort();

    const ctx1 = document.getElementById("chart-nien-khoa").getContext("2d");
    if (chartNienKhoaInstance) chartNienKhoaInstance.destroy();
    chartNienKhoaInstance = new Chart(ctx1, {
        type: 'bar',
        data: {
            labels: sortedYears,
            datasets: [{
                label: 'Số lượng đề tài',
                data: sortedYears.map(y => countByYear[y]),
                backgroundColor: '#0B3C78',
                borderRadius: 6,
                barThickness: 38
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, ticks: { stepSize: 5 }, grid: { color: '#f1f5f9' } },
                x: { grid: { display: false } }
            }
        }
    });

    const countByField = {};
    deTai.forEach(dt => {
        const bm = String(dt["Bộ môn / Lĩnh vực"] || "Chưa phân loại").trim();
        countByField[bm] = (countByField[bm] || 0) + 1;
    });
    const fields = Object.keys(countByField);
    const palette = ['#0B3C78', '#C8102E', '#059669', '#D97706', '#6366F1', '#0891B2'];

    const ctx2 = document.getElementById("chart-linh-vuc").getContext("2d");
    if (chartLinhVucInstance) chartLinhVucInstance.destroy();
    chartLinhVucInstance = new Chart(ctx2, {
        type: 'doughnut',
        data: {
            labels: fields,
            datasets: [{
                data: fields.map(f => countByField[f]),
                backgroundColor: palette.slice(0, fields.length),
                borderWidth: 2,
                borderColor: '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } }
            }
        }
    });
}

// =========================================================================
// 7. CỔNG TƯƠNG TÁC ĐỘNG TỪ GOOGLE SHEETS (CMS_Cong_Tuong_Tac)
// =========================================================================
function renderCongTuongTac() {
    const container = document.getElementById("cong-tuong-tac-grid");
    if (!container) return;

    let cards = globalData.congTuongTac;
    // Fallback mặc định nếu sheet chưa nhập dữ liệu
    if (!cards || cards.length === 0) {
        cards = [
            {
                "Nhãn phân loại": "DÀNH CHO SINH VIÊN",
                "Màu nhãn": "Đỏ",
                "Tiêu đề thẻ": "Đăng ký Ý tưởng & Đề xuất Đề tài NCKH",
                "Nội dung mô tả": "Gửi phiếu đăng ký đề tài mới, tìm kiếm giảng viên hướng dẫn phù hợp theo chuyên ngành.",
                "Chữ trên nút bấm": "Gửi đăng ký / Liên hệ Trợ lý NCKH",
                "Link đăng ký / Liên kết": "mailto:khoahoahoc@hcmue.edu.vn?subject=[NCKH]%20Đăng%20ký%20đề%20tài%20mới",
                "Kiểu nút bấm": "Nút đỏ nổi bật"
            },
            {
                "Nhãn phân loại": "TIẾN ĐỘ & NGHIỆM THU",
                "Màu nhãn": "Xanh",
                "Tiêu đề thẻ": "Nộp Báo cáo Tiến độ & Hồ sơ Nghiệm thu",
                "Nội dung mô tả": "Kênh tiếp nhận bản mềm thuyết minh, báo cáo tổng kết và minh chứng công bố khoa học của nhóm nghiên cứu.",
                "Chữ trên nút bấm": "Hướng dẫn nộp hồ sơ",
                "Link đăng ký / Liên kết": "#tab-van-ban",
                "Kiểu nút bấm": "Nút viền xanh"
            },
            {
                "Nhãn phân loại": "LỘ TRÌNH NÂNG CẤP MỨC 2",
                "Màu nhãn": "Vàng",
                "Tiêu đề thẻ": "Không gian Giảng viên & Hồ sơ Hướng nghiên cứu",
                "Nội dung mô tả": "Phân hệ dành riêng cho Giảng viên Khoa Hoá học cập nhật hướng nghiên cứu chính, công bố quốc tế và nhận sinh viên.",
                "Chữ trên nút bấm": "Kiến trúc dữ liệu đã sẵn sàng kích hoạt",
                "Link đăng ký / Liên kết": "",
                "Kiểu nút bấm": "Chỉ hiện dòng ghi chú"
            }
        ];
    }

    container.innerHTML = cards.map(card => {
        const label = escapeHTML(card["Nhãn phân loại"] || "THÔNG TIN");
        const colorRaw = String(card["Màu nhãn"] || "Xanh").trim().toLowerCase();
        const title = escapeHTML(card["Tiêu đề thẻ"] || "");
        const desc = escapeHTML(card["Nội dung mô tả"] || "");
        const btnText = escapeHTML(card["Chữ trên nút bấm"] || "Xem chi tiết");
        const link = String(card["Link đăng ký / Liên kết"] || "").trim();
        const btnStyleRaw = String(card["Kiểu nút bấm"] || "Nút viền xanh").trim().toLowerCase();

        // Map màu nhãn & viền trên thẻ
        let borderTopClass = "border-t-[#0B3C78]";
        let badgeClass = "bg-[#EBF3FA] text-[#0B3C78]";
        if (colorRaw.includes("đỏ") || colorRaw.includes("do")) {
            borderTopClass = "border-t-[#C8102E]";
            badgeClass = "bg-red-50 text-[#C8102E]";
        } else if (colorRaw.includes("vàng") || colorRaw.includes("vang") || colorRaw.includes("cam")) {
            borderTopClass = "border-t-[#D97706]";
            badgeClass = "bg-amber-50 text-amber-700";
        } else if (colorRaw.includes("lá") || colorRaw.includes("la") || colorRaw.includes("lục")) {
            borderTopClass = "border-t-emerald-600";
            badgeClass = "bg-emerald-50 text-emerald-700";
        } else if (colorRaw.includes("tím") || colorRaw.includes("tim")) {
            borderTopClass = "border-t-purple-600";
            badgeClass = "bg-purple-50 text-purple-700";
        }

        // Xử lý hành động liên kết nội bộ (#tab-... hoặc #van-ban-bieu-mau) vs liên kết ngoài
        let actionHTML = "";
        if (!link || btnStyleRaw.includes("ghi chú") || btnStyleRaw.includes("ghi chu")) {
            actionHTML = `
                <div class="text-xs text-slate-400 italic flex items-center gap-1.5 pt-2 border-t border-slate-100">
                    <i class="fa-solid fa-circle-info"></i> ${btnText}
                </div>
            `;
        } else {
            let btnClass = "inline-flex items-center justify-center w-full py-2.5 px-4 bg-[#EBF3FA] hover:bg-blue-100 text-[#0B3C78] text-xs font-bold rounded-lg transition border border-blue-200";
            let iconHTML = `<i class="fa-solid fa-arrow-up-right-from-square mr-2"></i>`;

            if (btnStyleRaw.includes("đỏ nổi") || btnStyleRaw.includes("do noi")) {
                btnClass = "inline-flex items-center justify-center w-full py-2.5 px-4 bg-[#C8102E] hover:bg-red-700 text-white text-xs font-bold rounded-lg transition shadow-xs";
                iconHTML = `<i class="fa-solid fa-paper-plane mr-2"></i>`;
            } else if (btnStyleRaw.includes("xanh nổi") || btnStyleRaw.includes("xanh noi")) {
                btnClass = "inline-flex items-center justify-center w-full py-2.5 px-4 bg-[#0B3C78] hover:bg-[#072752] text-white text-xs font-bold rounded-lg transition shadow-xs";
                iconHTML = `<i class="fa-solid fa-arrow-right mr-2"></i>`;
            } else if (btnStyleRaw.includes("viền đỏ") || btnStyleRaw.includes("vien do")) {
                btnClass = "inline-flex items-center justify-center w-full py-2.5 px-4 bg-red-50 hover:bg-red-100 text-[#C8102E] text-xs font-bold rounded-lg transition border border-red-200";
            }

            // Nếu là neo nội bộ chuyển tab
            if (link.startsWith("#")) {
                let targetTab = "van-ban";
                if (link.includes("thong-bao")) targetTab = "thong-bao";
                else if (link.includes("thoi-gian-bieu") || link.includes("lich")) targetTab = "thoi-gian-bieu";
                else if (link.includes("de-tai")) targetTab = "de-tai";
                else if (link.includes("seminar")) targetTab = "seminar";
                else if (link.includes("cong-trinh")) targetTab = "cong-trinh";

                actionHTML = `
                    <button onclick="switchTab('${targetTab}')" class="${btnClass}">
                        <i class="fa-solid fa-folder-open mr-2"></i> ${btnText}
                    </button>
                `;
            } else {
                const isMail = link.startsWith("mailto:");
                actionHTML = `
                    <a href="${escapeHTML(link)}" ${isMail ? '' : 'target="_blank" rel="noopener noreferrer"'} class="${btnClass}">
                        ${iconHTML} ${btnText}
                    </a>
                `;
            }
        }

        return `
            <div class="bg-white rounded-xl border-t-4 ${borderTopClass} border-x border-b border-slate-200 p-6 shadow-sm flex flex-col justify-between hover:shadow-md transition">
                <div>
                    <span class="text-[11px] font-bold ${badgeClass} px-2.5 py-1 rounded uppercase tracking-wider">${label}</span>
                    <h4 class="text-base font-bold text-slate-800 mt-3">${title}</h4>
                    <p class="text-xs text-slate-500 mt-2 leading-relaxed">${desc}</p>
                </div>
                <div class="mt-5">
                    ${actionHTML}
                </div>
            </div>
        `;
    }).join("");
}

// =========================================================================
// 8. THÔNG BÁO NCKH (TỔNG QUAN CUỘN DỌC TỰ ĐỘNG + TAB THẺ + MODAL CHI TIẾT)
// =========================================================================
function renderOverviewThongBao() {
    const container = document.getElementById("overview-tb-scroll");
    if (!container) return;

    const list = globalData.thongBao;
    if (!list || list.length === 0) {
        container.innerHTML = `
            <div class="py-10 text-center text-slate-400 text-xs">
                <i class="fa-regular fa-bell-slash text-2xl mb-2 block"></i>
                Hiện chưa có thông báo nghiên cứu khoa học nào được đăng tải.
            </div>
        `;
        return;
    }

    container.innerHTML = list.map((tb, idx) => {
        const isPinned = String(tb["Ghim nổi bật"] || "").trim().toLowerCase() === 'có';
        const ngayDang = formatVNDate(parseVNDate(tb["Ngày đăng"])) || escapeHTML(tb["Ngày đăng"] || "");
        const phanLoai = escapeHTML(tb["Phân loại"] || "Thông báo");
        const tieuDe = escapeHTML(tb["Tiêu đề thông báo"] || "");
        const tomTat = escapeHTML(tb["Tóm tắt ngắn"] || "");
        const hanMoc = formatVNDate(parseVNDate(tb["Ngày sự kiện / Hạn mốc"])) || escapeHTML(tb["Ngày sự kiện / Hạn mốc"] || "");

        return `
            <div onclick="openThongBaoDetail(${idx})" class="group p-3.5 rounded-xl border ${isPinned ? 'border-red-200 bg-red-50/30' : 'border-slate-100 bg-slate-50/50'} hover:bg-[#EBF3FA]/50 hover:border-blue-200 transition cursor-pointer">
                <div class="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                    <div class="flex flex-wrap items-center gap-1.5">
                        ${isPinned ? `<span class="text-[10px] font-bold bg-[#C8102E] text-white px-2 py-0.5 rounded"><i class="fa-solid fa-thumbtack mr-1"></i>Ghim</span>` : ''}
                        <span class="text-[10px] font-bold bg-white border border-slate-200 text-[#0B3C78] px-2 py-0.5 rounded">${phanLoai}</span>
                        ${hanMoc ? `<span class="text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded"><i class="fa-regular fa-clock mr-1"></i>Mốc: ${hanMoc}</span>` : ''}
                    </div>
                    <span class="text-[11px] text-slate-400 font-medium">${ngayDang}</span>
                </div>
                <h4 class="text-sm font-bold text-slate-800 group-hover:text-[#0B3C78] transition leading-snug">${tieuDe}</h4>
                ${tomTat ? `<p class="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">${tomTat}</p>` : ''}
            </div>
        `;
    }).join("");

    // Gắn sự kiện tạm dừng khi rê chuột / chạm vào khung cuộn
    container.onmouseenter = () => { autoScrollState.overviewHovering = true; };
    container.onmouseleave = () => { autoScrollState.overviewHovering = false; };
    container.ontouchstart = () => { autoScrollState.overviewHovering = true; };
    container.ontouchend = () => {
        setTimeout(() => { autoScrollState.overviewHovering = false; }, 1500);
    };
}

function startOverviewAutoScroll() {
    const container = document.getElementById("overview-tb-scroll");
    if (!container) return;
    if (autoScrollState.overviewTimer) cancelAnimationFrame(autoScrollState.overviewTimer);

    let pauseAtEndUntil = 0;

    function step(timestamp) {
        if (!autoScrollState.overviewPaused && !autoScrollState.overviewHovering) {
            const maxScroll = container.scrollHeight - container.clientHeight;
            if (maxScroll > 10 && timestamp > pauseAtEndUntil) {
                autoScrollState.overviewAccum += 0.35; // Tốc độ cuộn mượt ~21px/giây
                if (autoScrollState.overviewAccum >= 1) {
                    const px = Math.floor(autoScrollState.overviewAccum);
                    autoScrollState.overviewAccum -= px;
                    container.scrollTop += px;

                    if (container.scrollTop >= maxScroll - 1) {
                        pauseAtEndUntil = timestamp + 2200; // Dừng 2.2s ở cuối rồi quay lại đầu
                        setTimeout(() => {
                            if (!autoScrollState.overviewHovering && !autoScrollState.overviewPaused) {
                                container.scrollTo({ top: 0, behavior: 'smooth' });
                            }
                        }, 1800);
                    }
                }
            }
        }
        autoScrollState.overviewTimer = requestAnimationFrame(step);
    }

    autoScrollState.overviewTimer = requestAnimationFrame(step);
}

function toggleAutoScroll() {
    autoScrollState.overviewPaused = !autoScrollState.overviewPaused;
    updateOverviewScrollButton();
}

function updateOverviewScrollButton() {
    const btn = document.getElementById("btn-toggle-auto-scroll");
    if (!btn) return;
    if (autoScrollState.overviewPaused) {
        btn.innerHTML = `<i class="fa-solid fa-play text-[10px] text-emerald-600"></i><span>Tiếp tục cuộn</span>`;
    } else {
        btn.innerHTML = `<i class="fa-solid fa-pause text-[10px]"></i><span>Tạm dừng</span>`;
    }
}

function initThongBaoFilters() {
    const select = document.getElementById("tb-filter-loai");
    if (!select) return;
    const types = [...new Set(globalData.thongBao.map(tb => String(tb["Phân loại"] || "").trim()).filter(Boolean))];
    select.innerHTML = `<option value="ALL">Tất cả phân loại (${globalData.thongBao.length})</option>`;
    types.forEach(t => {
        select.innerHTML += `<option value="${escapeHTML(t)}">${escapeHTML(t)}</option>`;
    });
}

function renderThongBaoTab() {
    const grid = document.getElementById("thong-bao-grid");
    if (!grid) return;

    const search = (document.getElementById("tb-search")?.value || "").toLowerCase().trim();
    const loai = document.getElementById("tb-filter-loai")?.value || "ALL";
    const onlyPinned = document.getElementById("tb-filter-pinned")?.checked || false;

    const filtered = globalData.thongBao
        .map((tb, originalIndex) => ({ tb, originalIndex }))
        .filter(({ tb }) => {
            const isPinned = String(tb["Ghim nổi bật"] || "").trim().toLowerCase() === 'có';
            if (onlyPinned && !isPinned) return false;
            if (loai !== "ALL" && String(tb["Phân loại"] || "").trim() !== loai) return false;
            if (search) {
                const hay = [
                    tb["Mã thông báo"],
                    tb["Tiêu đề thông báo"],
                    tb["Tóm tắt ngắn"],
                    tb["Nội dung chi tiết"],
                    tb["Phân loại"]
                ].join(" ").toLowerCase();
                if (!hay.includes(search)) return false;
            }
            return true;
        });

    if (filtered.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full bg-white p-12 rounded-xl border border-slate-200 text-center text-slate-500">
                <i class="fa-regular fa-newspaper text-4xl text-slate-300 mb-3 block"></i>
                <p class="font-medium text-sm">Không tìm thấy thông báo nào phù hợp.</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = filtered.map(({ tb, originalIndex }) => {
        const isPinned = String(tb["Ghim nổi bật"] || "").trim().toLowerCase() === 'có';
        const maTB = escapeHTML(tb["Mã thông báo"] || "");
        const ngayDang = formatVNDate(parseVNDate(tb["Ngày đăng"])) || escapeHTML(tb["Ngày đăng"] || "");
        const phanLoai = escapeHTML(tb["Phân loại"] || "Thông báo chung");
        const tieuDe = escapeHTML(tb["Tiêu đề thông báo"] || "");
        const tomTat = escapeHTML(tb["Tóm tắt ngắn"] || tb["Nội dung chi tiết"] || "");
        const hanMoc = formatVNDate(parseVNDate(tb["Ngày sự kiện / Hạn mốc"])) || escapeHTML(tb["Ngày sự kiện / Hạn mốc"] || "");
        const buoiCa = escapeHTML(tb["Buổi / Ca"] || "");
        const link = String(tb["Link đính kèm / Đăng ký"] || "").trim();
        const linkLabel = escapeHTML(tb["Tên nút liên kết"] || "Xem tài liệu đính kèm");

        return `
            <article class="bg-white rounded-xl border ${isPinned ? 'border-red-200 ring-1 ring-red-100' : 'border-slate-200'} p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between">
                <div>
                    <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
                        <div class="flex flex-wrap items-center gap-1.5">
                            ${isPinned ? `<span class="text-[11px] font-bold bg-[#C8102E] text-white px-2.5 py-0.5 rounded-full"><i class="fa-solid fa-thumbtack mr-1"></i>Ghim nổi bật</span>` : ''}
                            <span class="text-[11px] font-bold bg-[#EBF3FA] text-[#0B3C78] px-2.5 py-0.5 rounded-full">${phanLoai}</span>
                            ${maTB ? `<span class="text-[11px] font-mono text-slate-400">#${maTB}</span>` : ''}
                        </div>
                        <span class="text-xs text-slate-400"><i class="fa-regular fa-calendar mr-1"></i>${ngayDang}</span>
                    </div>

                    <h3 onclick="openThongBaoDetail(${originalIndex})" class="text-base font-bold text-slate-900 hover:text-[#0B3C78] cursor-pointer transition leading-snug">
                        ${tieuDe}
                    </h3>

                    ${hanMoc ? `
                        <div class="mt-2.5 inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg">
                            <i class="fa-solid fa-clock"></i>
                            <span>Thời gian / Hạn mốc: ${hanMoc}${buoiCa ? ` (${buoiCa})` : ''}</span>
                        </div>
                    ` : ''}

                    <p class="text-xs text-slate-600 mt-3 line-clamp-3 leading-relaxed">${tomTat}</p>
                </div>

                <div class="mt-5 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                    <button onclick="openThongBaoDetail(${originalIndex})" class="inline-flex items-center gap-1.5 text-xs font-bold text-[#0B3C78] hover:text-[#072752] py-1.5 px-3 rounded-lg bg-[#EBF3FA] hover:bg-blue-100 transition">
                        <i class="fa-solid fa-book-open"></i> Đọc chi tiết
                    </button>
                    ${link ? `
                        <a href="${escapeHTML(link)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 text-xs font-semibold text-[#C8102E] hover:underline py-1.5 px-2">
                            <i class="fa-solid fa-arrow-up-right-from-square"></i> ${linkLabel}
                        </a>
                    ` : ''}
                </div>
            </article>
        `;
    }).join("");
}

function toggleTabTbAutoScroll() {
    const container = document.getElementById("thong-bao-scroll-container");
    const btn = document.getElementById("btn-tb-tab-autoscroll");
    if (!container || !btn) return;

    autoScrollState.tabEnabled = !autoScrollState.tabEnabled;
    if (autoScrollState.tabEnabled) {
        btn.innerHTML = `<i class="fa-solid fa-arrows-up-down text-emerald-600"></i><span>Cuộn tự động: Bật</span>`;
        container.onmouseenter = () => { autoScrollState.tabHovering = true; };
        container.onmouseleave = () => { autoScrollState.tabHovering = false; };

        function stepTab() {
            if (!autoScrollState.tabEnabled) return;
            if (!autoScrollState.tabHovering) {
                const maxScroll = container.scrollHeight - container.clientHeight;
                if (maxScroll > 10) {
                    autoScrollState.tabAccum += 0.4;
                    if (autoScrollState.tabAccum >= 1) {
                        const px = Math.floor(autoScrollState.tabAccum);
                        autoScrollState.tabAccum -= px;
                        container.scrollTop += px;
                        if (container.scrollTop >= maxScroll - 1) {
                            container.scrollTop = 0;
                        }
                    }
                }
            }
            autoScrollState.tabTimer = requestAnimationFrame(stepTab);
        }
        autoScrollState.tabTimer = requestAnimationFrame(stepTab);
    } else {
        btn.innerHTML = `<i class="fa-solid fa-arrows-up-down text-[#0B3C78]"></i><span>Cuộn tự động: Tắt</span>`;
        if (autoScrollState.tabTimer) cancelAnimationFrame(autoScrollState.tabTimer);
    }
}

function openThongBaoDetail(index) {
    const tb = globalData.thongBao[index];
    if (!tb) return;

    const isPinned = String(tb["Ghim nổi bật"] || "").trim().toLowerCase() === 'có';
    const ngayDang = formatVNDate(parseVNDate(tb["Ngày đăng"])) || tb["Ngày đăng"] || "";
    const hanMoc = formatVNDate(parseVNDate(tb["Ngày sự kiện / Hạn mốc"])) || tb["Ngày sự kiện / Hạn mốc"] || "";
    const buoiCa = tb["Buổi / Ca"] || "";

    const metaParts = [];
    if (tb["Mã thông báo"]) metaParts.push(`<span><i class="fa-solid fa-hashtag mr-1 text-slate-400"></i>Mã: <strong>${escapeHTML(tb["Mã thông báo"])}</strong></span>`);
    if (ngayDang) metaParts.push(`<span><i class="fa-regular fa-calendar mr-1 text-slate-400"></i>Ngày đăng: <strong>${escapeHTML(ngayDang)}</strong></span>`);
    if (hanMoc) metaParts.push(`<span class="text-amber-700"><i class="fa-solid fa-clock mr-1"></i>Thời gian / Hạn mốc: <strong>${escapeHTML(hanMoc)}${buoiCa ? ` (${escapeHTML(buoiCa)})` : ''}</strong></span>`);

    openArticleModal({
        category: tb["Phân loại"] || "Thông báo NCKH",
        pinned: isPinned,
        title: tb["Tiêu đề thông báo"] || "",
        metaHTML: metaParts.join(""),
        summary: tb["Tóm tắt ngắn"] || "",
        body: tb["Nội dung chi tiết"] || tb["Tóm tắt ngắn"] || "Đang cập nhật nội dung chi tiết.",
        actionLink: tb["Link đính kèm / Đăng ký"] || "",
        actionText: tb["Tên nút liên kết"] || "Mở liên kết đính kèm"
    });
}

function openArticleModal({ category, pinned, title, metaHTML, summary, body, actionLink, actionText }) {
    document.getElementById("article-modal-category").textContent = category || "Thông tin";
    const pinEl = document.getElementById("article-modal-pinned");
    if (pinned) pinEl.classList.remove("hidden");
    else pinEl.classList.add("hidden");

    document.getElementById("article-modal-title").textContent = title || "";
    document.getElementById("article-modal-meta").innerHTML = metaHTML || "";

    const sumBox = document.getElementById("article-modal-summary-box");
    const sumEl = document.getElementById("article-modal-summary");
    if (summary && String(summary).trim() !== "" && String(summary).trim() !== String(body).trim()) {
        sumEl.textContent = summary;
        sumBox.classList.remove("hidden");
    } else {
        sumBox.classList.add("hidden");
    }

    document.getElementById("article-modal-body").textContent = body || "";

    const actionWrap = document.getElementById("article-modal-action-wrap");
    const actionBtn = document.getElementById("article-modal-action-btn");
    const actionTextEl = document.getElementById("article-modal-action-text");
    if (actionLink && String(actionLink).trim() !== "") {
        actionBtn.href = String(actionLink).trim();
        actionTextEl.textContent = actionText || "Xem liên kết đính kèm";
        actionWrap.classList.remove("hidden");
    } else {
        actionWrap.classList.add("hidden");
    }

    document.getElementById("article-detail-modal").classList.remove("hidden");
}

function closeArticleModal() {
    document.getElementById("article-detail-modal").classList.add("hidden");
}

// =========================================================================
// 9. THỜI GIAN BIỂU TÍCH HỢP 3 NGUỒN (TUẦN / THÁNG / DANH SÁCH)
// =========================================================================
function normalizeSessionPeriod(rawSession) {
    const s = String(rawSession || "").trim().toLowerCase();
    if (!s) return "Cả ngày";
    if (s.includes("sáng") || s.includes("sang")) return "Sáng";
    if (s.includes("chiều") || s.includes("chieu")) return "Chiều";
    if (s.includes("tối") || s.includes("toi")) return "Tối";
    return "Cả ngày";
}

function buildUnifiedSchedule() {
    const events = [];

    // Nguồn 1: Nhập trực tiếp từ CMS_ThoiGianBieu
    globalData.thoiGianBieu.forEach((row, idx) => {
        const start = parseVNDate(row["Ngày bắt đầu"]);
        if (!start) return;
        const end = parseVNDate(row["Ngày kết thúc"]) || start;
        events.push({
            id: row["Mã lịch"] || `TG-${idx + 1}`,
            source: "MANUAL",
            sourceLabel: "Lịch hoạt động NCKH",
            startDate: start,
            endDate: end,
            session: normalizeSessionPeriod(row["Buổi / Ca"]),
            rawSession: row["Buổi / Ca"] || "",
            timeDetail: row["Giờ cụ thể"] || row["Buổi / Ca"] || "",
            category: row["Phân loại"] || "Hoạt động NCKH",
            title: row["Tên hoạt động"] || "",
            location: row["Địa điểm"] || "",
            organizer: row["Đơn vị / Phụ trách"] || "",
            description: row["Nội dung / Ghi chú"] || "",
            link: row["Link liên kết"] || ""
        });
    });

    // Nguồn 2: Tự động đồng bộ từ CMS_Seminar_HoiNghi
    globalData.seminar.forEach((sem, idx) => {
        const start = parseVNDate(sem["Ngày bắt đầu"]) || parseVNDate(sem["Thời gian"]);
        if (!start) return;
        const end = parseVNDate(sem["Ngày kết thúc"]) || start;
        events.push({
            id: sem["Mã sự kiện"] || `SEM-${idx + 1}`,
            source: "SEMINAR",
            sourceLabel: "Seminar & Hội thảo",
            startDate: start,
            endDate: end,
            session: normalizeSessionPeriod(sem["Buổi / Ca"] || sem["Thời gian"]),
            rawSession: sem["Buổi / Ca"] || "",
            timeDetail: sem["Thời gian"] || sem["Buổi / Ca"] || "",
            category: sem["Loại hoạt động"] || "Seminar & Hội thảo",
            title: sem["Tên sự kiện"] || "",
            location: sem["Địa điểm"] || "",
            organizer: sem["Diễn giả / Đơn vị tổ chức"] || "",
            description: sem["Tóm tắt nội dung"] || "",
            link: sem["Link đăng ký (Form)"] || sem["Link tài liệu / Kỷ yếu"] || ""
        });
    });

    // Nguồn 3: Tự động đồng bộ hạn mốc/sự kiện từ CMS_ThongBao_NCKH
    globalData.thongBao.forEach((tb, idx) => {
        const start = parseVNDate(tb["Ngày sự kiện / Hạn mốc"]);
        if (!start) return;
        events.push({
            id: tb["Mã thông báo"] || `TB-${idx + 1}`,
            source: "THONGBAO",
            sourceLabel: "Mốc thời gian / Thông báo",
            startDate: start,
            endDate: start,
            session: normalizeSessionPeriod(tb["Buổi / Ca"]),
            rawSession: tb["Buổi / Ca"] || "",
            timeDetail: tb["Buổi / Ca"] || "Hạn mốc / Sự kiện",
            category: tb["Phân loại"] || "Mốc thời gian / Thông báo",
            title: tb["Tiêu đề thông báo"] || "",
            location: "Khoa Hoá học - HCMUE",
            organizer: "Ban Tổ chức / Trợ lý NCKH",
            description: tb["Nội dung chi tiết"] || tb["Tóm tắt ngắn"] || "",
            link: tb["Link đính kèm / Đăng ký"] || ""
        });
    });

    // Sắp xếp tăng dần theo ngày bắt đầu
    events.sort((a, b) => a.startDate - b.startDate);
    unifiedScheduleEvents = events;
}

function getSourceBadgeStyle(source) {
    if (source === "SEMINAR") {
        return {
            dot: "bg-emerald-600",
            card: "bg-emerald-50 border-emerald-200 text-emerald-900 hover:bg-emerald-100/80",
            badge: "bg-emerald-600 text-white"
        };
    }
    if (source === "THONGBAO") {
        return {
            dot: "bg-[#C8102E]",
            card: "bg-red-50 border-red-200 text-red-950 hover:bg-red-100/80",
            badge: "bg-[#C8102E] text-white"
        };
    }
    return {
        dot: "bg-[#0B3C78]",
        card: "bg-[#EBF3FA] border-blue-200 text-[#072752] hover:bg-blue-100/80",
        badge: "bg-[#0B3C78] text-white"
    };
}

function renderOverviewSchedule() {
    const container = document.getElementById("overview-schedule-list");
    if (!container) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Ưu tiên sự kiện từ hôm nay trở đi; nếu ít hơn 4 sự kiện thì bổ sung sự kiện gần nhất
    const upcoming = unifiedScheduleEvents.filter(ev => ev.endDate >= today);
    const displayList = upcoming.length > 0 ? upcoming.slice(0, 6) : unifiedScheduleEvents.slice(-5).reverse();

    if (displayList.length === 0) {
        container.innerHTML = `
            <div class="py-10 text-center text-slate-400 text-xs">
                <i class="fa-regular fa-calendar-xmark text-2xl mb-2 block"></i>
                Chưa có lịch hoạt động nào được cập nhật.
            </div>
        `;
        return;
    }

    container.innerHTML = displayList.map(ev => {
        const style = getSourceBadgeStyle(ev.source);
        const dateStr = isSameDay(ev.startDate, ev.endDate)
            ? formatVNDate(ev.startDate)
            : `${formatVNDate(ev.startDate)} – ${formatVNDate(ev.endDate)}`;
        const evIdx = unifiedScheduleEvents.indexOf(ev);

        return `
            <div onclick="openScheduleEventDetail(${evIdx})" class="p-3 rounded-xl border border-slate-100 bg-slate-50/70 hover:bg-white hover:border-blue-200 hover:shadow-xs transition cursor-pointer flex items-start gap-3">
                <div class="shrink-0 w-12 text-center bg-white border border-slate-200 rounded-lg py-1.5 px-1 shadow-2xs">
                    <span class="block text-[10px] font-bold uppercase text-[#C8102E]">Thg ${ev.startDate.getMonth() + 1}</span>
                    <span class="block text-base font-extrabold text-slate-800 leading-tight">${String(ev.startDate.getDate()).padStart(2, '0')}</span>
                </div>
                <div class="min-w-0 flex-grow">
                    <div class="flex items-center gap-1.5 mb-1">
                        <span class="w-2 h-2 rounded-full ${style.dot}"></span>
                        <span class="text-[10px] font-bold text-slate-500 uppercase truncate">${escapeHTML(ev.sourceLabel)}</span>
                    </div>
                    <h4 class="text-xs font-bold text-slate-800 line-clamp-2 leading-snug">${escapeHTML(ev.title)}</h4>
                    <p class="text-[11px] text-slate-500 mt-1 truncate">
                        <i class="fa-regular fa-clock mr-1"></i>${escapeHTML(dateStr)}${ev.location ? ` • ${escapeHTML(ev.location)}` : ''}
                    </p>
                </div>
            </div>
        `;
    }).join("");
}

function initScheduleFilters() {
    const select = document.getElementById("tgb-filter-type");
    if (!select) return;
    const types = [...new Set(unifiedScheduleEvents.map(e => String(e.category || "").trim()).filter(Boolean))];
    select.innerHTML = `<option value="ALL">Tất cả phân loại hoạt động</option>`;
    types.forEach(t => {
        select.innerHTML += `<option value="${escapeHTML(t)}">${escapeHTML(t)}</option>`;
    });
}

function getFilteredScheduleEvents() {
    const search = (document.getElementById("tgb-search")?.value || "").toLowerCase().trim();
    const source = document.getElementById("tgb-filter-source")?.value || "ALL";
    const type = document.getElementById("tgb-filter-type")?.value || "ALL";

    return unifiedScheduleEvents.filter(ev => {
        if (source !== "ALL" && ev.source !== source) return false;
        if (type !== "ALL" && ev.category !== type) return false;
        if (search) {
            const hay = [ev.title, ev.location, ev.organizer, ev.description, ev.category].join(" ").toLowerCase();
            if (!hay.includes(search)) return false;
        }
        return true;
    });
}

function setScheduleView(viewMode) {
    scheduleState.view = viewMode;
    document.querySelectorAll(".sched-view-btn").forEach(btn => {
        btn.classList.remove("bg-white", "text-[#0B3C78]", "shadow-sm");
        btn.classList.add("text-slate-600");
    });
    const activeBtn = document.getElementById(`btn-view-${viewMode}`);
    if (activeBtn) {
        activeBtn.classList.add("bg-white", "text-[#0B3C78]", "shadow-sm");
        activeBtn.classList.remove("text-slate-600");
    }
    renderScheduleView();
}

function navigateSchedule(step) {
    const cur = new Date(scheduleState.currentDate);
    if (scheduleState.view === 'week') {
        cur.setDate(cur.getDate() + step * 7);
    } else {
        cur.setMonth(cur.getMonth() + step);
    }
    scheduleState.currentDate = cur;
    renderScheduleView();
}

function resetScheduleToday() {
    scheduleState.currentDate = new Date();
    renderScheduleView();
}

function getMondayOfWeek(dateObj) {
    const d = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
    const day = d.getDay(); // 0 = CN, 1 = T2 ...
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d;
}

function renderScheduleView() {
    const container = document.getElementById("schedule-container");
    const periodLabel = document.getElementById("schedule-period-label");
    if (!container || !periodLabel) return;

    const filteredEvents = getFilteredScheduleEvents();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // ---------------------------------------------------------------------
    // CHẾ ĐỘ 1: XEM THEO TUẦN (Lưới 7 ngày x 3 ca: Sáng / Chiều / Tối & Cả ngày)
    // ---------------------------------------------------------------------
    if (scheduleState.view === 'week') {
        const monday = getMondayOfWeek(scheduleState.currentDate);
        const weekDays = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(monday);
            d.setDate(monday.getDate() + i);
            weekDays.push(d);
        }
        const sunday = weekDays[6];
        periodLabel.textContent = `Tuần: ${formatVNDate(monday)} – ${formatVNDate(sunday)}`;

        const dayNames = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ nhật"];
        const sessions = [
            { key: "Sáng", label: "Buổi Sáng", icon: "fa-sun text-amber-500" },
            { key: "Chiều", label: "Buổi Chiều", icon: "fa-cloud-sun text-orange-500" },
            { key: "Tối_CaNgay", label: "Tối / Cả ngày", icon: "fa-moon text-indigo-500" }
        ];

        let html = `
            <div class="overflow-x-auto custom-scrollbar">
                <table class="w-full min-w-[920px] border-collapse table-fixed">
                    <thead>
                        <tr class="bg-slate-50 border-b border-slate-200">
                            <th class="w-28 py-3 px-3 text-left text-xs font-bold text-slate-500 uppercase border-r border-slate-200">Buổi / Ca</th>
                            ${weekDays.map((d, idx) => {
                                const isToday = isSameDay(d, today);
                                return `
                                    <th class="py-3 px-2 text-center border-r last:border-r-0 border-slate-200 ${isToday ? 'bg-[#EBF3FA]' : ''}">
                                        <span class="block text-xs font-bold ${isToday ? 'text-[#C8102E]' : 'text-slate-700'}">${dayNames[idx]}</span>
                                        <span class="inline-block mt-0.5 text-xs ${isToday ? 'bg-[#0B3C78] text-white font-bold px-2 py-0.5 rounded-full' : 'text-slate-500'}">${formatVNDate(d).slice(0, 5)}</span>
                                    </th>
                                `;
                            }).join("")}
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-200">
        `;

        sessions.forEach(sess => {
            html += `<tr>
                <td class="py-3 px-3 align-top bg-slate-50/70 border-r border-slate-200">
                    <div class="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                        <i class="fa-solid ${sess.icon}"></i>
                        <span>${sess.label}</span>
                    </div>
                </td>
            `;

            weekDays.forEach(dayDate => {
                const isToday = isSameDay(dayDate, today);
                const cellEvents = filteredEvents.filter(ev => {
                    if (!isDateInRange(dayDate, ev.startDate, ev.endDate)) return false;
                    if (sess.key === "Sáng") return ev.session === "Sáng";
                    if (sess.key === "Chiều") return ev.session === "Chiều";
                    return ev.session === "Tối" || ev.session === "Cả ngày";
                });

                html += `<td class="p-2 align-top border-r last:border-r-0 border-slate-200 min-h-[110px] ${isToday ? 'bg-blue-50/20' : ''}">
                    <div class="space-y-2 min-h-[95px]">
                        ${cellEvents.map(ev => {
                            const st = getSourceBadgeStyle(ev.source);
                            const evIdx = unifiedScheduleEvents.indexOf(ev);
                            return `
                                <div onclick="openScheduleEventDetail(${evIdx})" class="p-2 rounded-lg border ${st.card} cursor-pointer transition shadow-2xs">
                                    <div class="flex items-center justify-between gap-1 mb-1">
                                        <span class="text-[9px] font-bold px-1.5 py-0.2 rounded ${st.badge} truncate">${escapeHTML(ev.category)}</span>
                                    </div>
                                    <p class="text-[11px] font-bold leading-snug line-clamp-3">${escapeHTML(ev.title)}</p>
                                    ${ev.timeDetail ? `<p class="text-[10px] opacity-80 mt-1"><i class="fa-regular fa-clock mr-1"></i>${escapeHTML(ev.timeDetail)}</p>` : ''}
                                    ${ev.location ? `<p class="text-[10px] opacity-80 truncate"><i class="fa-solid fa-location-dot mr-1"></i>${escapeHTML(ev.location)}</p>` : ''}
                                </div>
                            `;
                        }).join("")}
                    </div>
                </td>`;
            });

            html += `</tr>`;
        });

        html += `</tbody></table></div>`;
        container.innerHTML = html;
        return;
    }

    // ---------------------------------------------------------------------
    // CHẾ ĐỘ 2: XEM THEO THÁNG (Lưới lịch tháng chuẩn 7 cột)
    // ---------------------------------------------------------------------
    if (scheduleState.view === 'month') {
        const year = scheduleState.currentDate.getFullYear();
        const month = scheduleState.currentDate.getMonth();
        periodLabel.textContent = `Tháng ${String(month + 1).padStart(2, '0')} / ${year}`;

        const firstDayOfMonth = new Date(year, month, 1);
        const startGridDate = getMondayOfWeek(firstDayOfMonth);
        const dayNames = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ nhật"];

        let html = `
            <div class="overflow-x-auto custom-scrollbar">
                <div class="min-w-[840px]">
                    <div class="grid grid-cols-7 bg-slate-50 border-b border-slate-200">
                        ${dayNames.map(dn => `<div class="py-2.5 px-2 text-center text-xs font-bold text-slate-600 uppercase border-r last:border-r-0 border-slate-200">${dn}</div>`).join("")}
                    </div>
                    <div class="grid grid-cols-7 divide-x divide-y divide-slate-200">
        `;

        for (let i = 0; i < 42; i++) {
            const cellDate = new Date(startGridDate);
            cellDate.setDate(startGridDate.getDate() + i);
            const inCurrentMonth = cellDate.getMonth() === month;
            const isToday = isSameDay(cellDate, today);

            // Nếu hàng cuối cùng (từ ô 35) hoàn toàn thuộc tháng sau thì dừng ở 35 ô
            if (i === 35 && !inCurrentMonth) break;

            const dayEvents = filteredEvents.filter(ev => isDateInRange(cellDate, ev.startDate, ev.endDate));

            html += `
                <div class="min-h-[115px] p-2 ${inCurrentMonth ? 'bg-white' : 'bg-slate-50/70 text-slate-400'} ${isToday ? 'ring-2 ring-inset ring-[#0B3C78]' : ''}">
                    <div class="flex items-center justify-between mb-1.5">
                        <span class="text-xs font-bold ${isToday ? 'bg-[#0B3C78] text-white w-6 h-6 rounded-full flex items-center justify-center' : ''}">
                            ${cellDate.getDate()}
                        </span>
                        ${dayEvents.length > 0 ? `<span class="text-[10px] font-semibold text-slate-400">${dayEvents.length} HĐ</span>` : ''}
                    </div>
                    <div class="space-y-1 max-h-[85px] overflow-y-auto custom-scrollbar">
                        ${dayEvents.map(ev => {
                            const st = getSourceBadgeStyle(ev.source);
                            const evIdx = unifiedScheduleEvents.indexOf(ev);
                            return `
                                <div onclick="openScheduleEventDetail(${evIdx})" class="px-1.5 py-1 rounded border text-[10px] font-semibold leading-tight cursor-pointer truncate ${st.card}" title="${escapeHTML(ev.title)}">
                                    <span class="inline-block w-1.5 h-1.5 rounded-full ${st.dot} mr-1"></span>${escapeHTML(ev.title)}
                                </div>
                            `;
                        }).join("")}
                    </div>
                </div>
            `;
        }

        html += `</div></div></div>`;
        container.innerHTML = html;
        return;
    }

    // ---------------------------------------------------------------------
    // CHẾ ĐỘ 3: XEM DẠNG DANH SÁCH TOÀN BỘ LỊCH TRÌNH
    // ---------------------------------------------------------------------
    periodLabel.textContent = `Toàn bộ Thời gian biểu (${filteredEvents.length} hoạt động)`;

    if (filteredEvents.length === 0) {
        container.innerHTML = `
            <div class="p-12 text-center text-slate-500">
                <i class="fa-regular fa-calendar-xmark text-4xl text-slate-300 mb-3 block"></i>
                <p class="font-medium text-sm">Không có hoạt động nào phù hợp với bộ lọc hiện tại.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div class="divide-y divide-slate-100">
            ${filteredEvents.map(ev => {
                const st = getSourceBadgeStyle(ev.source);
                const evIdx = unifiedScheduleEvents.indexOf(ev);
                const dateRange = isSameDay(ev.startDate, ev.endDate)
                    ? formatVNDate(ev.startDate)
                    : `${formatVNDate(ev.startDate)} – ${formatVNDate(ev.endDate)}`;
                const isPast = ev.endDate < today;

                return `
                    <div onclick="openScheduleEventDetail(${evIdx})" class="p-4 sm:p-5 hover:bg-slate-50 transition cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${isPast ? 'opacity-80' : ''}">
                        <div class="flex items-start gap-4">
                            <div class="shrink-0 w-16 text-center rounded-xl border border-slate-200 bg-white py-2 px-1 shadow-2xs">
                                <span class="block text-[10px] font-bold uppercase text-[#C8102E]">Thg ${ev.startDate.getMonth() + 1}/${ev.startDate.getFullYear()}</span>
                                <span class="block text-xl font-extrabold text-slate-800">${String(ev.startDate.getDate()).padStart(2, '0')}</span>
                            </div>
                            <div class="space-y-1">
                                <div class="flex flex-wrap items-center gap-2">
                                    <span class="text-[10px] font-bold px-2 py-0.5 rounded ${st.badge}">${escapeHTML(ev.sourceLabel)}</span>
                                    <span class="text-[11px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded">${escapeHTML(ev.category)}</span>
                                    ${isPast ? `<span class="text-[10px] font-semibold text-slate-400">(Đã qua)</span>` : `<span class="text-[10px] font-bold text-emerald-600">• Sắp tới / Hiện hành</span>`}
                                </div>
                                <h4 class="text-sm sm:text-base font-bold text-slate-900 hover:text-[#0B3C78]">${escapeHTML(ev.title)}</h4>
                                <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                                    <span><i class="fa-regular fa-clock mr-1 text-[#0B3C78]"></i>${escapeHTML(dateRange)} (${escapeHTML(ev.timeDetail)})</span>
                                    ${ev.location ? `<span><i class="fa-solid fa-location-dot mr-1 text-[#C8102E]"></i>${escapeHTML(ev.location)}</span>` : ''}
                                    ${ev.organizer ? `<span><i class="fa-solid fa-user-tie mr-1 text-slate-400"></i>${escapeHTML(ev.organizer)}</span>` : ''}
                                </div>
                            </div>
                        </div>
                        <div class="shrink-0 self-end sm:self-center">
                            <span class="inline-flex items-center gap-1 text-xs font-bold text-[#0B3C78] bg-[#EBF3FA] px-3 py-1.5 rounded-lg">
                                Chi tiết <i class="fa-solid fa-chevron-right text-[10px]"></i>
                            </span>
                        </div>
                    </div>
                `;
            }).join("")}
        </div>
    `;
}

function openScheduleEventDetail(index) {
    const ev = unifiedScheduleEvents[index];
    if (!ev) return;

    const dateRange = isSameDay(ev.startDate, ev.endDate)
        ? formatVNDate(ev.startDate)
        : `${formatVNDate(ev.startDate)} – ${formatVNDate(ev.endDate)}`;

    const metaParts = [
        `<span><i class="fa-solid fa-layer-group mr-1 text-slate-400"></i>Nguồn: <strong>${escapeHTML(ev.sourceLabel)}</strong></span>`,
        `<span><i class="fa-regular fa-calendar-check mr-1 text-[#0B3C78]"></i>Thời gian: <strong>${escapeHTML(dateRange)} (${escapeHTML(ev.timeDetail)})</strong></span>`
    ];
    if (ev.location) metaParts.push(`<span><i class="fa-solid fa-location-dot mr-1 text-[#C8102E]"></i>Địa điểm: <strong>${escapeHTML(ev.location)}</strong></span>`);
    if (ev.organizer) metaParts.push(`<span><i class="fa-solid fa-user-tie mr-1 text-slate-400"></i>Phụ trách / Diễn giả: <strong>${escapeHTML(ev.organizer)}</strong></span>`);

    openArticleModal({
        category: ev.category,
        pinned: false,
        title: ev.title,
        metaHTML: metaParts.join(""),
        summary: "",
        body: ev.description || "Hoạt động thuộc kế hoạch Nghiên cứu Khoa học của Khoa Hoá học.",
        actionLink: ev.link || "",
        actionText: "Mở liên kết hoạt động / Đăng ký"
    });
}

// =========================================================================
// 10. TRA CỨU & LỌC ĐỀ TÀI SV NCKH
// =========================================================================
function initFilters() {
    const deTai = globalData.deTai;

    const years = [...new Set(deTai.map(d => String(d["Niên khoá"] || "").trim()).filter(Boolean))].sort().reverse();
    const selectYear = document.getElementById("filter-nien-khoa");
    selectYear.innerHTML = `<option value="ALL">Tất cả Niên khoá</option>`;
    years.forEach(y => {
        selectYear.innerHTML += `<option value="${escapeHTML(y)}">${escapeHTML(y)}</option>`;
    });

    const fields = [...new Set(deTai.map(d => String(d["Bộ môn / Lĩnh vực"] || "").trim()).filter(Boolean))].sort();
    const selectField = document.getElementById("filter-bo-mon");
    selectField.innerHTML = `<option value="ALL">Tất cả Bộ môn / Lĩnh vực</option>`;
    fields.forEach(f => {
        selectField.innerHTML += `<option value="${escapeHTML(f)}">${escapeHTML(f)}</option>`;
    });
}

function resetFilters() {
    document.getElementById("filter-search").value = "";
    document.getElementById("filter-nien-khoa").value = "ALL";
    document.getElementById("filter-bo-mon").value = "ALL";
    document.getElementById("filter-giai").value = "ALL";
    applyFilters();
}

function applyFilters() {
    const search = document.getElementById("filter-search").value.toLowerCase().trim();
    const year = document.getElementById("filter-nien-khoa").value;
    const field = document.getElementById("filter-bo-mon").value;
    const prize = document.getElementById("filter-giai").value;

    const filtered = globalData.deTai.filter(dt => {
        if (year !== "ALL" && String(dt["Niên khoá"] || "").trim() !== year) return false;
        if (field !== "ALL" && String(dt["Bộ môn / Lĩnh vực"] || "").trim() !== field) return false;

        const gKhoa = String(dt["Giải cấp Khoa"] || "").toLowerCase();
        const gTruong = String(dt["Giải cấp Trường"] || "").toLowerCase();
        const gBo = String(dt["Giải cấp Bộ"] || "").toLowerCase();
        const allGiai = `${gKhoa} ${gTruong} ${gBo}`;

        if (prize === "CO_GIAI" && !/(nhất|nhì|ba|khuyến khích)/i.test(allGiai)) return false;
        if (prize === "NHAT" && !allGiai.includes("nhất")) return false;
        if (prize === "NHI" && !allGiai.includes("nhì")) return false;
        if (prize === "BA" && !allGiai.includes("ba")) return false;
        if (prize === "KK" && !allGiai.includes("khuyến khích")) return false;

        if (search !== "") {
            const textToSearch = [
                dt["Tên đề tài"],
                dt["SV chủ nhiệm"],
                dt["SV tham gia"],
                dt["Giảng viên hướng dẫn"],
                dt["Từ khoá"],
                dt["Từ khóa"]
            ].join(" ").toLowerCase();
            if (!textToSearch.includes(search)) return false;
        }

        return true;
    });

    document.getElementById("count-filtered").textContent = filtered.length;
    renderTableDeTai(filtered);
}

function renderTableDeTai(list) {
    const tbody = document.getElementById("table-de-tai-body");
    const emptyState = document.getElementById("empty-state");

    if (list.length === 0) {
        tbody.innerHTML = "";
        emptyState.classList.remove("hidden");
        return;
    }

    emptyState.classList.add("hidden");
    tbody.innerHTML = list.map(dt => {
        const originalIndex = globalData.deTai.indexOf(dt);
        const badges = generatePrizeBadges(dt);
        const svChuNhiem = dt["SV chủ nhiệm"] || "-";
        const svThamGia = dt["SV tham gia"] ? `, ${dt["SV tham gia"]}` : "";

        return `
            <tr class="hover:bg-slate-50/80 transition group">
                <td class="py-3.5 px-4 align-top">
                    <span class="inline-block text-xs font-bold bg-slate-100 text-slate-700 px-2.5 py-1 rounded">${escapeHTML(dt["Niên khoá"] || "-")}</span>
                </td>
                <td class="py-3.5 px-4 align-top">
                    <p onclick="openModal(${originalIndex})" class="font-bold text-slate-800 group-hover:text-[#0B3C78] cursor-pointer transition leading-snug">
                        ${escapeHTML(dt["Tên đề tài"] || "")}
                    </p>
                    <p class="text-xs text-slate-500 mt-1.5">
                        <i class="fa-solid fa-users text-slate-400 mr-1"></i>
                        <strong class="text-slate-700">${escapeHTML(svChuNhiem)}</strong>${escapeHTML(svThamGia)}
                    </p>
                </td>
                <td class="py-3.5 px-4 align-top text-xs font-semibold text-[#0B3C78]">
                    ${escapeHTML(dt["Giảng viên hướng dẫn"] || "-")}
                </td>
                <td class="py-3.5 px-4 align-top">
                    <span class="text-xs text-slate-600 bg-slate-100 px-2 py-1 rounded inline-block">${escapeHTML(dt["Bộ môn / Lĩnh vực"] || "-")}</span>
                </td>
                <td class="py-3.5 px-4 align-top">
                    <div class="flex flex-col gap-1">
                        ${badges || `<span class="text-xs text-slate-400">${escapeHTML(dt["Trạng thái"] || "Đã nghiệm thu")}</span>`}
                    </div>
                </td>
                <td class="py-3.5 px-4 align-top text-center">
                    <button onclick="openModal(${originalIndex})" class="w-8 h-8 rounded-lg bg-[#EBF3FA] text-[#0B3C78] hover:bg-[#0B3C78] hover:text-white transition inline-flex items-center justify-center" title="Xem chi tiết">
                        <i class="fa-solid fa-eye text-xs"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join("");
}

function generatePrizeBadges(dt) {
    let html = "";
    const gBo = String(dt["Giải cấp Bộ"] || "").trim();
    const gTruong = String(dt["Giải cấp Trường"] || "").trim();
    const gKhoa = String(dt["Giải cấp Khoa"] || "").trim();

    if (gBo && gBo !== "-") {
        html += `<span class="inline-flex items-center gap-1 text-[11px] font-bold bg-red-50 text-[#C8102E] border border-red-200 px-2 py-0.5 rounded"><i class="fa-solid fa-medal"></i> Bộ: ${escapeHTML(gBo)}</span>`;
    }
    if (gTruong && gTruong !== "-") {
        html += `<span class="inline-flex items-center gap-1 text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded"><i class="fa-solid fa-award"></i> Trường: ${escapeHTML(gTruong)}</span>`;
    }
    if (gKhoa && gKhoa !== "-") {
        html += `<span class="inline-flex items-center gap-1 text-[11px] font-semibold bg-blue-50 text-[#0B3C78] border border-blue-200 px-2 py-0.5 rounded"><i class="fa-solid fa-star"></i> Khoa: ${escapeHTML(gKhoa)}</span>`;
    }
    return html;
}

// =========================================================================
// 11. MODAL CHI TIẾT ĐỀ TÀI
// =========================================================================
function openModal(index) {
    const dt = globalData.deTai[index];
    if (!dt) return;

    document.getElementById("modal-nien-khoa").textContent = `Niên khoá ${dt["Niên khoá"] || "-"} • Mã số: ${dt["Mã số"] || "-"}`;
    document.getElementById("modal-ten-de-tai").textContent = dt["Tên đề tài"] || "";
    document.getElementById("modal-gvhd").textContent = dt["Giảng viên hướng dẫn"] || "-";
    document.getElementById("modal-bo-mon").textContent = dt["Bộ môn / Lĩnh vực"] || "-";

    const tvContainer = document.getElementById("modal-thanh-vien");
    const relatedMembers = globalData.thanhVien.filter(tv =>
        String(tv["Niên khoá"] || "").trim() === String(dt["Niên khoá"] || "").trim() &&
        String(tv["Mã số đề tài"] || "").trim() === String(dt["Mã số"] || "").trim()
    );

    if (relatedMembers.length > 0) {
        tvContainer.innerHTML = relatedMembers.map(tv => `
            <div class="flex items-center justify-between text-xs bg-white border border-slate-200 px-3 py-2 rounded-lg">
                <span class="font-bold text-slate-800"><i class="fa-solid fa-user text-[#0B3C78] mr-2"></i>${escapeHTML(tv["Họ và tên SV"] || "")}</span>
                <span class="text-[11px] font-semibold ${String(tv["Vai trò"]).includes("chủ nhiệm") ? 'text-[#C8102E] bg-red-50' : 'text-slate-500 bg-slate-100'} px-2 py-0.5 rounded">${escapeHTML(tv["Vai trò"] || "")}</span>
            </div>
        `).join("");
    } else {
        let fallbackHTML = `<div class="text-xs bg-white border border-slate-200 px-3 py-2 rounded-lg font-bold text-slate-800">${escapeHTML(dt["SV chủ nhiệm"] || "-")} <span class="text-[#C8102E] font-normal">(Chủ nhiệm)</span></div>`;
        if (dt["SV tham gia"]) {
            fallbackHTML += `<div class="text-xs bg-white border border-slate-200 px-3 py-2 rounded-lg text-slate-600 mt-1">Thành viên: ${escapeHTML(dt["SV tham gia"])}</div>`;
        }
        tvContainer.innerHTML = fallbackHTML;
    }

    const badges = generatePrizeBadges(dt);
    const giaiSection = document.getElementById("modal-giai-section");
    if (badges) {
        giaiSection.classList.remove("hidden");
        document.getElementById("modal-giai-badges").innerHTML = badges;
    } else {
        giaiSection.classList.add("hidden");
    }

    const tomTat = String(dt["Tóm tắt đề tài"] || "").trim();
    const tomTatSection = document.getElementById("modal-tom-tat-section");
    if (tomTat && tomTat !== "-") {
        tomTatSection.classList.remove("hidden");
        document.getElementById("modal-tom-tat").textContent = tomTat;
    } else {
        tomTatSection.classList.add("hidden");
    }

    const link = String(dt["Link QĐ công nhận / Kỷ yếu"] || "").trim();
    const linkSection = document.getElementById("modal-link-section");
    if (link && link.startsWith("http")) {
        linkSection.classList.remove("hidden");
        document.getElementById("modal-link-btn").href = link;
    } else {
        linkSection.classList.add("hidden");
    }

    document.getElementById("detail-modal").classList.remove("hidden");
}

function closeModal() {
    document.getElementById("detail-modal").classList.add("hidden");
}

// =========================================================================
// 12. CÔNG TRÌNH & GIẢI THƯỞNG NỔI BẬT
// =========================================================================
function renderCongTrinh() {
    const container = document.getElementById("grid-cong-trinh");
    const highlights = globalData.deTai.filter(dt => {
        const gKhoa = String(dt["Giải cấp Khoa"] || "").trim();
        const gTruong = String(dt["Giải cấp Trường"] || "").trim();
        const gBo = String(dt["Giải cấp Bộ"] || "").trim();
        const baiBao = String(dt["Bài báo khoa học quốc tế"] || "").trim();
        return (gKhoa && gKhoa !== "-") || (gTruong && gTruong !== "-") || (gBo && gBo !== "-") || (baiBao && baiBao !== "-");
    });

    if (highlights.length === 0) {
        container.innerHTML = `<p class="text-sm text-slate-500 col-span-3">Đang cập nhật dữ liệu giải thưởng...</p>`;
        return;
    }

    container.innerHTML = highlights.map(dt => {
        const originalIndex = globalData.deTai.indexOf(dt);
        const badges = generatePrizeBadges(dt);
        return `
            <div onclick="openModal(${originalIndex})" class="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md hover:border-[#0B3C78] transition cursor-pointer flex flex-col justify-between">
                <div>
                    <div class="flex justify-between items-center mb-2">
                        <span class="text-[11px] font-bold text-slate-500">${escapeHTML(dt["Niên khoá"] || "-")}</span>
                        <span class="text-[11px] font-semibold text-[#0B3C78] bg-[#EBF3FA] px-2 py-0.5 rounded">${escapeHTML(dt["Bộ môn / Lĩnh vực"] || "-")}</span>
                    </div>
                    <h4 class="font-bold text-sm text-slate-800 line-clamp-3 leading-snug mb-3">${escapeHTML(dt["Tên đề tài"] || "")}</h4>
                </div>
                <div class="pt-3 border-t border-slate-100 space-y-2">
                    <p class="text-xs text-slate-600"><i class="fa-solid fa-user-tie text-slate-400 mr-1.5"></i>GVHD: <strong>${escapeHTML(dt["Giảng viên hướng dẫn"] || "-")}</strong></p>
                    <p class="text-xs text-slate-600"><i class="fa-solid fa-user-graduate text-slate-400 mr-1.5"></i>CNĐT: <strong>${escapeHTML(dt["SV chủ nhiệm"] || "-")}</strong></p>
                    <div class="flex flex-wrap gap-1.5 pt-1">${badges}</div>
                </div>
            </div>
        `;
    }).join("");
}

// =========================================================================
// 13. SEMINAR & HỘI THẢO KHOA HỌC (HỖ TRỢ NGÀY BẮT ĐẦU / KẾT THÚC / BUỔI)
// =========================================================================
function getAutoSeminarStatus(sem) {
    const manualStatus = String(sem["Trạng thái"] || "").trim();
    if (manualStatus && manualStatus.toLowerCase() !== "tự động") {
        return manualStatus;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = parseVNDate(sem["Ngày bắt đầu"]) || parseVNDate(sem["Thời gian"]);
    const end = parseVNDate(sem["Ngày kết thúc"]) || start;
    if (!start) return "Sắp diễn ra";
    if (today < start) return "Sắp diễn ra";
    if (today > end) return "Đã diễn ra";
    return "Đang diễn ra";
}

function renderSeminar() {
    const container = document.getElementById("list-seminar");
    if (globalData.seminar.length === 0) {
        container.innerHTML = `<div class="bg-white p-8 rounded-xl border border-slate-200 text-center text-sm text-slate-500">Chưa có thông tin Seminar / Hội thảo nào được đăng tải.</div>`;
        return;
    }

    container.innerHTML = globalData.seminar.map((sem, idx) => {
        const status = getAutoSeminarStatus(sem);
        const isDone = status.toLowerCase().includes("đã");
        const startStr = formatVNDate(parseVNDate(sem["Ngày bắt đầu"]));
        const endStr = formatVNDate(parseVNDate(sem["Ngày kết thúc"]));
        const buoiCa = String(sem["Buổi / Ca"] || "").trim();
        const thoiGian = String(sem["Thời gian"] || "").trim();

        let timeDisplay = thoiGian;
        if (startStr) {
            const range = (endStr && endStr !== startStr) ? `${startStr} – ${endStr}` : startStr;
            timeDisplay = [range, buoiCa, (thoiGian && thoiGian !== startStr ? thoiGian : "")].filter(Boolean).join(" • ");
        }

        return `
            <div class="bg-white rounded-xl border border-slate-200 p-5 md:p-6 shadow-sm flex flex-col md:flex-row justify-between gap-4 hover:border-blue-200 transition">
                <div class="space-y-2 max-w-3xl">
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="text-xs font-bold bg-[#EBF3FA] text-[#0B3C78] px-2.5 py-0.5 rounded">${escapeHTML(sem["Loại hoạt động"] || "Seminar")}</span>
                        <span class="text-xs font-semibold ${isDone ? 'bg-slate-100 text-slate-600' : 'bg-emerald-50 text-emerald-700'} px-2.5 py-0.5 rounded-full">
                            ${escapeHTML(status)}
                        </span>
                    </div>
                    <h3 onclick="openSeminarDetail(${idx})" class="text-base md:text-lg font-bold text-slate-900 hover:text-[#0B3C78] cursor-pointer transition">${escapeHTML(sem["Tên sự kiện"] || "")}</h3>
                    <p class="text-xs text-slate-600 leading-relaxed whitespace-pre-line">${escapeHTML(sem["Tóm tắt nội dung"] || "")}</p>
                    <div class="flex flex-wrap gap-4 text-xs text-slate-500 pt-2">
                        ${timeDisplay ? `<span><i class="fa-regular fa-calendar text-[#0B3C78] mr-1"></i> ${escapeHTML(timeDisplay)}</span>` : ''}
                        ${sem["Địa điểm"] ? `<span><i class="fa-solid fa-location-dot text-[#C8102E] mr-1"></i> ${escapeHTML(sem["Địa điểm"])}</span>` : ''}
                        ${sem["Diễn giả / Đơn vị tổ chức"] ? `<span><i class="fa-solid fa-user-tie text-slate-400 mr-1"></i> ${escapeHTML(sem["Diễn giả / Đơn vị tổ chức"])}</span>` : ''}
                    </div>
                </div>
                <div class="flex flex-row md:flex-col justify-center gap-2 shrink-0">
                    ${sem["Link đăng ký (Form)"] ? `<a href="${escapeHTML(sem["Link đăng ký (Form)"])}" target="_blank" rel="noopener noreferrer" class="px-4 py-2 bg-[#0B3C78] hover:bg-[#072752] text-white text-xs font-semibold rounded-lg text-center transition">Đăng ký tham dự</a>` : ''}
                    ${sem["Link tài liệu / Kỷ yếu"] ? `<a href="${escapeHTML(sem["Link tài liệu / Kỷ yếu"])}" target="_blank" rel="noopener noreferrer" class="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg text-center transition">Tài liệu / Kỷ yếu</a>` : ''}
                    <button onclick="openSeminarDetail(${idx})" class="px-4 py-2 bg-[#EBF3FA] hover:bg-blue-100 text-[#0B3C78] text-xs font-semibold rounded-lg text-center transition">Xem chi tiết</button>
                </div>
            </div>
        `;
    }).join("");
}

function openSeminarDetail(index) {
    const sem = globalData.seminar[index];
    if (!sem) return;

    const startStr = formatVNDate(parseVNDate(sem["Ngày bắt đầu"]));
    const endStr = formatVNDate(parseVNDate(sem["Ngày kết thúc"]));
    const buoiCa = String(sem["Buổi / Ca"] || "").trim();
    const thoiGian = String(sem["Thời gian"] || "").trim();
    let timeDisplay = thoiGian;
    if (startStr) {
        const range = (endStr && endStr !== startStr) ? `${startStr} – ${endStr}` : startStr;
        timeDisplay = [range, buoiCa, (thoiGian && thoiGian !== startStr ? thoiGian : "")].filter(Boolean).join(" • ");
    }

    const metaParts = [];
    if (sem["Mã sự kiện"]) metaParts.push(`<span><i class="fa-solid fa-hashtag mr-1 text-slate-400"></i>Mã: <strong>${escapeHTML(sem["Mã sự kiện"])}</strong></span>`);
    if (timeDisplay) metaParts.push(`<span><i class="fa-regular fa-calendar mr-1 text-[#0B3C78]"></i>Thời gian: <strong>${escapeHTML(timeDisplay)}</strong></span>`);
    if (sem["Địa điểm"]) metaParts.push(`<span><i class="fa-solid fa-location-dot mr-1 text-[#C8102E]"></i>Địa điểm: <strong>${escapeHTML(sem["Địa điểm"])}</strong></span>`);
    if (sem["Diễn giả / Đơn vị tổ chức"]) metaParts.push(`<span><i class="fa-solid fa-user-tie mr-1 text-slate-400"></i>Diễn giả / Đơn vị: <strong>${escapeHTML(sem["Diễn giả / Đơn vị tổ chức"])}</strong></span>`);

    openArticleModal({
        category: sem["Loại hoạt động"] || "Seminar & Hội thảo",
        pinned: false,
        title: sem["Tên sự kiện"] || "",
        metaHTML: metaParts.join(""),
        summary: "",
        body: sem["Tóm tắt nội dung"] || "Đang cập nhật nội dung chi tiết sự kiện.",
        actionLink: sem["Link đăng ký (Form)"] || sem["Link tài liệu / Kỷ yếu"] || "",
        actionText: sem["Link đăng ký (Form)"] ? "Đăng ký tham dự sự kiện" : "Xem tài liệu / Kỷ yếu"
    });
}

// =========================================================================
// 14. VĂN BẢN & BIỂU MẪU
// =========================================================================
function renderVanBan() {
    const container = document.getElementById("grid-van-ban");
    if (globalData.vanBan.length === 0) {
        container.innerHTML = `<div class="bg-white p-8 rounded-xl border border-slate-200 text-center text-sm text-slate-500 col-span-2">Chưa có văn bản / biểu mẫu nào được cập nhật.</div>`;
        return;
    }

    container.innerHTML = globalData.vanBan.map(vb => {
        const format = String(vb["Định dạng"] || "FILE").toUpperCase();
        let iconClass = "fa-file-lines text-slate-500 bg-slate-100";
        if (format.includes("PDF")) iconClass = "fa-file-pdf text-[#C8102E] bg-red-50";
        else if (format.includes("RAR") || format.includes("ZIP")) iconClass = "fa-file-zipper text-amber-600 bg-amber-50";
        else if (format.includes("FOLDER")) iconClass = "fa-folder-open text-[#0B3C78] bg-[#EBF3FA]";
        else if (format.includes("DOC")) iconClass = "fa-file-word text-blue-600 bg-blue-50";

        return `
            <a href="${escapeHTML(vb["Link tải / Xem"] || "#")}" target="_blank" rel="noopener noreferrer" class="bg-white rounded-xl border border-slate-200 p-4 shadow-sm hover:shadow-md hover:border-[#0B3C78] transition flex items-center justify-between gap-4 group">
                <div class="flex items-center gap-3.5">
                    <div class="w-11 h-11 rounded-lg ${iconClass} flex items-center justify-center text-lg shrink-0">
                        <i class="fa-solid ${iconClass.split(' ')[0]}"></i>
                    </div>
                    <div>
                        <h4 class="text-sm font-bold text-slate-800 group-hover:text-[#0B3C78] transition">${escapeHTML(vb["Tên văn bản / Biểu mẫu"] || "")}</h4>
                        <p class="text-xs text-slate-500 mt-0.5">${escapeHTML(vb["Phân loại"] || "")} • <span class="font-semibold">${escapeHTML(format)}</span></p>
                    </div>
                </div>
                <span class="text-xs font-bold text-[#0B3C78] bg-[#EBF3FA] group-hover:bg-[#0B3C78] group-hover:text-white px-3 py-1.5 rounded-lg transition shrink-0">
                    Mở <i class="fa-solid fa-arrow-up-right-from-square ml-1"></i>
                </span>
            </a>
        `;
    }).join("");
}

// =========================================================================
// 15. ĐÓNG MODAL KHI BẤM NỀN TỐI HOẶC PHÍM ESC
// =========================================================================
document.getElementById("detail-modal").addEventListener("click", function(e) {
    if (e.target === this) closeModal();
});

document.getElementById("article-detail-modal").addEventListener("click", function(e) {
    if (e.target === this) closeArticleModal();
});

document.addEventListener("keydown", function(e) {
    if (e.key === "Escape") {
        closeModal();
        closeArticleModal();
    }
});
