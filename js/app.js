/**
 * CỔNG THÔNG TIN NGHIÊN CỨU KHOA HỌC - KHOA HOÁ HỌC (HCMUE)
 * Kiến trúc Jamstack: Google Sheets CMS -> Google Apps Script API -> Static Web
 */

const API_URL =
  'https://script.google.com/macros/s/AKfycbz-y0kUxEFygO4PxHAw7Z5N06nOGS57TMMr-t6XMjH6PmjNFHDXmQlA-wCwag1IUko6dg/exec';

const CACHE_KEY = 'hcmue_chem_nckh_portal_cache_v2';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 phút

// Trạng thái ứng dụng toàn cục
const STATE = {
  config: {},
  projects: [],
  projectMembers: [],
  announcements: [],
  schedules: [],
  seminars: [],
  portals: [],
  documents: [],
  reportSummary: [],

  // Thời gian biểu tích hợp
  unifiedEvents: [],
  calendarView: 'month', // 'month' | 'week' | 'list'
  calendarCursor: new Date(),
  scheduleSourceFilter: 'ALL',

  // Bộ lọc & phân trang đề tài
  filteredProjects: [],
  pageSize: 12,
  visibleCount: 12,

  // Biểu đồ
  charts: {
    yearly: null,
    department: null,
  },

  // Trạng thái cuộn tự động
  autoScrollTimers: {},
  autoScrollPaused: {
    'announcements-scroll': false,
    'seminars-scroll': false,
  },
};

/* ==========================================================================
   1. TIỆN ÍCH CHUẨN HOÁ VĂN BẢN, URL GOOGLE DRIVE & NGÀY THÁNG
   ========================================================================== */

/**
 * Chuẩn hoá chính tả tiếng Việt theo quy ước Khoa Hoá học HCMUE: "Hoá", "Khoá"
 * Không can thiệp vào URL, DOI hoặc chuỗi rỗng.
 */
function normalizeHoaKhoa(text) {
  if (text === null || text === undefined) return '';
  const str = String(text);
  if (/^https?:\/\//i.test(str.trim()) || /^doi:/i.test(str.trim())) {
    return str;
  }
  return str
    .replace(/\bHóa\b/g, 'Hoá')
    .replace(/\bhóa\b/g, 'hoá')
    .replace(/\bHÓA\b/g, 'HOÁ')
    .replace(/\bKhóa\b/g, 'Khoá')
    .replace(/\bkhóa\b/g, 'khoá')
    .replace(/\bKHÓA\b/g, 'KHOÁ');
}

/**
 * Chuẩn hoá chuỗi phục vụ tìm kiếm không phân biệt dấu thanh & chữ hoa/thường
 */
function normalizeSearchText(text) {
  if (!text) return '';
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

/**
 * Escape HTML chống XSS khi render nội dung động
 */
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Chuyển đổi cấu hình cờ boolean từ Google Sheets ("Có", "TRUE", "1", true)
 */
function isConfigEnabled(val, defaultVal = true) {
  if (val === undefined || val === null || String(val).trim() === '') return defaultVal;
  if (typeof val === 'boolean') return val;
  const norm = normalizeSearchText(val);
  if (['co', 'true', '1', 'yes', 'bat', 'hien'].includes(norm)) return true;
  if (['khong', 'false', '0', 'no', 'tat', 'an'].includes(norm)) return false;
  return defaultVal;
}

/**
 * Trích xuất Google Drive File ID từ nhiều định dạng URL khác nhau
 */
function extractDriveFileId(url) {
  if (!url) return '';
  const str = String(url).trim();
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]+)/,
    /\/d\/([a-zA-Z0-9_-]+)/,
    /[?&]id=([a-zA-Z0-9_-]+)/,
  ];
  for (const regex of patterns) {
    const match = str.match(regex);
    if (match && match[1]) return match[1];
  }
  return '';
}

/**
 * Chuyển đổi link ảnh Google Drive sang URL hiển thị trực tiếp ổn định
 */
function convertDriveImageUrl(url, size = 'w1000') {
  if (!url) return '';
  const str = String(url).trim();
  if (!str) return '';
  const fileId = extractDriveFileId(str);
  if (fileId && !str.includes('/folders/')) {
    return `https://drive.google.com/thumbnail?id=${fileId}&sz=${size}`;
  }
  return str;
}

/**
 * Chuẩn hoá đường dẫn DOI / Bài báo khoa học thành URL hợp lệ
 */
function normalizeDoiUrl(raw) {
  if (!raw) return '';
  const str = String(raw).trim();
  if (!str || str === '-' || str === '—') return '';
  if (/^https?:\/\//i.test(str)) return str;
  const cleaned = str.replace(/^doi:\s*/i, '').trim();
  if (cleaned.startsWith('10.')) {
    return `https://doi.org/${cleaned}`;
  }
  return str;
}

/**
 * Phân tích chuỗi ngày (DD/MM/YYYY, YYYY-MM-DD, ISO) thành đối tượng Date (00:00:00 local)
 */
function parseFlexibleDate(input) {
  if (!input) return null;
  if (input instanceof Date && !isNaN(input.getTime())) {
    return new Date(input.getFullYear(), input.getMonth(), input.getDate());
  }
  const str = String(input).trim();
  if (!str) return null;

  // DD/MM/YYYY hoặc D/M/YYYY
  const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmy) {
    const day = parseInt(dmy[1], 10);
    const month = parseInt(dmy[2], 10) - 1;
    const year = parseInt(dmy[3], 10);
    const dt = new Date(year, month, day);
    if (!isNaN(dt.getTime())) return dt;
  }

  // YYYY-MM-DD hoặc ISO string
  const ymd = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (ymd) {
    const year = parseInt(ymd[1], 10);
    const month = parseInt(ymd[2], 10) - 1;
    const day = parseInt(ymd[3], 10);
    const dt = new Date(year, month, day);
    if (!isNaN(dt.getTime())) return dt;
  }

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  }
  return null;
}

function formatDateVN(dateObj) {
  if (!dateObj || !(dateObj instanceof Date) || isNaN(dateObj.getTime())) return '';
  const dd = String(dateObj.getDate()).padStart(2, '0');
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const yyyy = dateObj.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function toDateKey(dateObj) {
  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/* ==========================================================================
   2. BỘ CHUYỂN ĐỔI DỮ LIỆU ĐA DẠNG TỪ GOOGLE APPS SCRIPT (CMS ADAPTER)
   ========================================================================== */

/**
 * Lấy giá trị từ object theo danh sách key ưu tiên (hỗ trợ cả tiếng Anh & tiếng Việt)
 */
function pickField(obj, keys, fallback = '') {
  if (!obj || typeof obj !== 'object') return fallback;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== '') {
      return obj[k];
    }
  }
  // Thử tìm khớp gần đúng không phân biệt hoa thường / khoảng trắng
  const objKeys = Object.keys(obj);
  for (const k of keys) {
    const target = normalizeSearchText(k).replace(/\s+/g, '');
    const found = objKeys.find(
      (ok) => normalizeSearchText(ok).replace(/\s+/g, '') === target
    );
    if (found && obj[found] !== undefined && obj[found] !== null && String(obj[found]).trim() !== '') {
      return obj[found];
    }
  }
  return fallback;
}

/**
 * Chuẩn hoá dữ liệu JSON thô từ Code.gs thành cấu trúc thống nhất
 */
function normalizeApiPayload(raw) {
  const data = raw && raw.data ? raw.data : raw || {};

  // 1. Cấu hình hệ thống (có thể là object key-value hoặc mảng dòng)
  let configObj = {};
  const rawCfg =
    data.config ||
    data.cauHinh ||
    data.settings ||
    data.CMS_CauHinh_HeThong ||
    {};

  if (Array.isArray(rawCfg)) {
    rawCfg.forEach((row) => {
      const key = pickField(row, ['ma_cau_hinh', 'Mã cấu hình', 'key', 'code']);
      const val = pickField(row, ['gia_tri', 'Giá trị hiển thị trên Web', 'value']);
      if (key) configObj[String(key).trim()] = val;
    });
  } else if (typeof rawCfg === 'object') {
    configObj = { ...rawCfg };
  }

  // 2. Danh mục Đề tài NCKH
  const rawProjects =
    data.projects ||
    data.deTai ||
    data.detai ||
    data.CMS_DeTai_NCKH ||
    [];

  const projects = (Array.isArray(rawProjects) ? rawProjects : [])
    .map((item, idx) => {
      const nienKhoa = String(pickField(item, ['nienKhoa', 'nien_khoa', 'Niên khóa', 'Niên khoá'])).trim();
      const tenDeTai = normalizeHoaKhoa(
        pickField(item, ['tenDeTai', 'ten_de_tai', 'Tên đề tài'])
      );
      if (!tenDeTai || normalizeSearchText(nienKhoa) === 'cong khai') return null;

      const cleanAward = (v) => {
        const s = String(v || '').trim();
        return !s || s === '-' || s === '—' || s === '0' ? '' : normalizeHoaKhoa(s);
      };

      return {
        id: `proj_${idx}_${pickField(item, ['maSo', 'ma_so', 'Mã số'], idx + 1)}`,
        nienKhoa,
        maSo: String(pickField(item, ['maSo', 'ma_so', 'Mã số'], idx + 1)).trim(),
        tenDeTai,
        svChuNhiem: String(pickField(item, ['svChuNhiem', 'sv_chu_nhiem', 'SV chủ nhiệm'])).trim(),
        svThamGia: String(pickField(item, ['svThamGia', 'sv_tham_gia', 'SV tham gia'])).trim(),
        nganhDaoTao: normalizeHoaKhoa(pickField(item, ['nganhDaoTao', 'nganh_dao_tao', 'Ngành đào tạo'])),
        boMon: normalizeHoaKhoa(
          pickField(item, ['boMon', 'bo_mon', 'linhVuc', 'Bộ môn / Lĩnh vực', 'Bộ môn'], 'Chưa phân loại')
        ),
        tuKhoa: normalizeHoaKhoa(pickField(item, ['tuKhoa', 'tu_khoa', 'Từ khóa', 'Từ khoá'])),
        maGvhd: String(pickField(item, ['maGvhd', 'ma_gvhd', 'Mã GVHD'])).trim(),
        gvhd: String(pickField(item, ['gvhd', 'giangVienHuongDan', 'Giảng viên hướng dẫn'])).trim(),
        giaiKhoa: cleanAward(pickField(item, ['giaiKhoa', 'giai_cap_khoa', 'Giải cấp Khoa'])),
        giaiTruong: cleanAward(pickField(item, ['giaiTruong', 'giai_cap_truong', 'Giải cấp Trường'])),
        giaiBo: cleanAward(pickField(item, ['giaiBo', 'giai_cap_bo', 'Giải cấp Bộ'])),
        baiBaoQuocTe: normalizeDoiUrl(
          pickField(item, ['baiBaoQuocTe', 'bai_bao_quoc_te', 'Bài báo khoa học quốc tế'])
        ),
        baiBaoTrongNuoc: normalizeDoiUrl(
          pickField(item, ['baiBaoTrongNuoc', 'bai_bao_trong_nuoc', 'Bài báo khoa học trong nước'])
        ),
        trangThai: normalizeHoaKhoa(
          pickField(item, ['trangThai', 'trang_thai', 'Trạng thái'], 'Đã nghiệm thu')
        ),
        tomTat: normalizeHoaKhoa(pickField(item, ['tomTat', 'tom_tat', 'Tóm tắt đề tài'])),
        linkQuyetDinh: String(
          pickField(item, ['linkQuyetDinh', 'link_qd', 'Link QĐ công nhận / Kỷ yếu'])
        ).trim(),
        linkAnhVinhDanh: String(
          pickField(item, ['linkAnhVinhDanh', 'link_anh_vinh_danh', 'Link ảnh vinh danh'])
        ).trim(),
      };
    })
    .filter(Boolean);

  // 3. Thành viên đề tài (nếu có)
  const rawMembers =
    data.members ||
    data.thanhVien ||
    data.CMS_ThanhVien_DeTai ||
    [];
  const projectMembers = Array.isArray(rawMembers) ? rawMembers : [];

  // 4. Thông báo NCKH
  const rawAnnouncements =
    data.announcements ||
    data.thongBao ||
    data.thongbao ||
    data.CMS_ThongBao_NCKH ||
    [];
  const announcements = (Array.isArray(rawAnnouncements) ? rawAnnouncements : [])
    .map((item, idx) => {
      const hienThi = pickField(item, ['hienThi', 'hien_thi', 'Hiển thị'], 'Có');
      if (!isConfigEnabled(hienThi, true)) return null;
      const title = normalizeHoaKhoa(
        pickField(item, ['tieuDe', 'tieu_de', 'Tiêu đề thông báo'])
      );
      if (!title) return null;

      return {
        id: `ann_${idx}`,
        ma: String(pickField(item, ['maThongBao', 'ma_thong_bao', 'Mã thông báo'], `TB-${idx + 1}`)).trim(),
        ngayDang: String(pickField(item, ['ngayDang', 'ngay_dang', 'Ngày đăng'])).trim(),
        phanLoai: normalizeHoaKhoa(
          pickField(item, ['phanLoai', 'phan_loai', 'Phân loại'], 'Thông báo chung')
        ),
        ghim: isConfigEnabled(pickField(item, ['ghim', 'ghim_noi_bat', 'Ghim nổi bật'], 'Không'), false),
        tieuDe: title,
        tomTat: normalizeHoaKhoa(pickField(item, ['tomTat', 'tom_tat_ngan', 'Tóm tắt ngắn'])),
        noiDung: normalizeHoaKhoa(pickField(item, ['noiDung', 'noi_dung_chi_tiet', 'Nội dung chi tiết'])),
        ngaySuKien: String(
          pickField(item, ['ngaySuKien', 'ngay_su_kien', 'Ngày sự kiện / Hạn mốc'])
        ).trim(),
        buoi: normalizeHoaKhoa(pickField(item, ['buoi', 'buoi_ca', 'Buổi / Ca'])),
        link: String(pickField(item, ['link', 'link_dinh_kem', 'Link đính kèm / Đăng ký'])).trim(),
        tenNut: normalizeHoaKhoa(
          pickField(item, ['tenNut', 'ten_nut', 'Tên nút liên kết'], 'Xem chi tiết / Văn bản')
        ),
      };
    })
    .filter(Boolean);

  // 5. Thời gian biểu Khoa
  const rawSchedules =
    data.schedules ||
    data.thoiGianBieu ||
    data.thoigianbieu ||
    data.CMS_ThoiGianBieu ||
    [];
  const schedules = (Array.isArray(rawSchedules) ? rawSchedules : [])
    .map((item, idx) => {
      const hienThi = pickField(item, ['hienThi', 'hien_thi', 'Hiển thị'], 'Có');
      if (!isConfigEnabled(hienThi, true)) return null;
      const title = normalizeHoaKhoa(
        pickField(item, ['tenHoatDong', 'ten_hoat_dong', 'Tên hoạt động'])
      );
      if (!title) return null;

      return {
        id: `sch_${idx}`,
        ma: String(pickField(item, ['maLich', 'ma_lich', 'Mã lịch'], `TG-${idx + 1}`)).trim(),
        ngayBatDau: String(pickField(item, ['ngayBatDau', 'ngay_bat_dau', 'Ngày bắt đầu'])).trim(),
        ngayKetThuc: String(pickField(item, ['ngayKetThuc', 'ngay_ket_thuc', 'Ngày kết thúc'])).trim(),
        buoi: normalizeHoaKhoa(pickField(item, ['buoi', 'buoi_ca', 'Buổi / Ca'])),
        gio: String(pickField(item, ['gioCuThe', 'gio_cu_the', 'Giờ cụ thể'])).trim(),
        phanLoai: normalizeHoaKhoa(
          pickField(item, ['phanLoai', 'phan_loai', 'Phân loại'], 'Hoạt động NCKH')
        ),
        tenHoatDong: title,
        diaDiem: normalizeHoaKhoa(pickField(item, ['diaDiem', 'dia_diem', 'Địa điểm'])),
        phuTrach: normalizeHoaKhoa(
          pickField(item, ['donViPhuTrach', 'phu_trach', 'Đơn vị / Phụ trách'])
        ),
        noiDung: normalizeHoaKhoa(pickField(item, ['noiDung', 'ghi_chu', 'Nội dung / Ghi chú'])),
        link: String(pickField(item, ['link', 'link_lien_ket', 'Link liên kết'])).trim(),
      };
    })
    .filter(Boolean);

  // 6. Seminar & Hội nghị khoa học
  const rawSeminars =
    data.seminars ||
    data.hoiNghi ||
    data.suKien ||
    data.CMS_Seminar_HoiNghi ||
    [];
  const seminars = (Array.isArray(rawSeminars) ? rawSeminars : [])
    .map((item, idx) => {
      const hienThi = pickField(item, ['hienThi', 'hien_thi', 'Hiển thị'], 'Có');
      if (!isConfigEnabled(hienThi, true)) return null;
      const title = normalizeHoaKhoa(
        pickField(item, ['tenSuKien', 'ten_su_kien', 'Tên sự kiện'])
      );
      if (!title) return null;

      return {
        id: `sem_${idx}`,
        ma: String(pickField(item, ['maSuKien', 'ma_su_kien', 'Mã sự kiện'], `SK-${idx + 1}`)).trim(),
        loaiHoatDong: normalizeHoaKhoa(
          pickField(item, ['loaiHoatDong', 'loai_hoat_dong', 'Loại hoạt động'], 'Seminar khoa học')
        ),
        tenSuKien: title,
        ngayBatDau: String(pickField(item, ['ngayBatDau', 'ngay_bat_dau', 'Ngày bắt đầu'])).trim(),
        ngayKetThuc: String(pickField(item, ['ngayKetThuc', 'ngay_ket_thuc', 'Ngày kết thúc'])).trim(),
        buoi: normalizeHoaKhoa(pickField(item, ['buoi', 'buoi_ca', 'Buổi / Ca'])),
        thoiGian: String(pickField(item, ['thoiGian', 'thoi_gian', 'Thời gian'])).trim(),
        diaDiem: normalizeHoaKhoa(pickField(item, ['diaDiem', 'dia_diem', 'Địa điểm'])),
        dienGia: normalizeHoaKhoa(
          pickField(item, ['dienGia', 'dien_gia', 'Diễn giả / Đơn vị tổ chức'])
        ),
        tomTat: normalizeHoaKhoa(
          pickField(item, ['tomTat', 'tom_tat_noi_dung', 'Tóm tắt nội dung'])
        ),
        trangThai: normalizeHoaKhoa(
          pickField(item, ['trangThai', 'trang_thai', 'Trạng thái'], 'Sắp diễn ra')
        ),
        linkDangKy: String(
          pickField(item, ['linkDangKy', 'link_dang_ky', 'Link đăng ký (Form)'])
        ).trim(),
        linkTaiLieu: String(
          pickField(item, ['linkTaiLieu', 'link_tai_lieu', 'Link tài liệu / Kỷ yếu'])
        ).trim(),
      };
    })
    .filter(Boolean);

  // 7. Cổng tương tác động (CMS_Cong_Tuong_Tac)
  const rawPortals =
    data.portals ||
    data.congTuongTac ||
    data.CMS_Cong_Tuong_Tac ||
    [];
  const portals = (Array.isArray(rawPortals) ? rawPortals : [])
    .map((item, idx) => {
      const hienThi = pickField(item, ['hienThi', 'hien_thi', 'Hiển thị'], 'Có');
      if (!isConfigEnabled(hienThi, true)) return null;
      const tieuDe = normalizeHoaKhoa(pickField(item, ['tieuDe', 'tieu_de_the', 'Tiêu đề thẻ']));
      if (!tieuDe) return null;

      return {
        thuTu: Number(pickField(item, ['thuTu', 'thu_tu', 'Thứ tự'], idx + 1)) || idx + 1,
        nhanPhanLoai: normalizeHoaKhoa(
          pickField(item, ['nhanPhanLoai', 'nhan_phan_loai', 'Nhãn phân loại'], 'CỔNG THÔNG TIN')
        ),
        mauNhan: normalizeHoaKhoa(pickField(item, ['mauNhan', 'mau_nhan', 'Màu nhãn'], 'Xanh')),
        tieuDe,
        moTa: normalizeHoaKhoa(pickField(item, ['moTa', 'noi_dung_mo_ta', 'Nội dung mô tả'])),
        chuNut: normalizeHoaKhoa(pickField(item, ['chuNut', 'chu_tren_nut', 'Chữ trên nút bấm'])),
        link: String(pickField(item, ['link', 'link_dang_ky', 'Link đăng ký / Liên kết'])).trim(),
        kieuNut: normalizeHoaKhoa(
          pickField(item, ['kieuNut', 'kieu_nut_bam', 'Kiểu nút bấm'], 'Nút viền xanh')
        ),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.thuTu - b.thuTu);

  // 8. Văn bản & Biểu mẫu (CMS_VanBan_BieuMau)
  const rawDocs =
    data.documents ||
    data.vanBan ||
    data.bieuMau ||
    data.CMS_VanBan_BieuMau ||
    [];
  const documents = (Array.isArray(rawDocs) ? rawDocs : [])
    .map((item) => {
      const ten = normalizeHoaKhoa(
        pickField(item, ['tenVanBan', 'ten_van_ban', 'Tên văn bản / Biểu mẫu'])
      );
      if (!ten) return null;
      return {
        ten,
        phanLoai: normalizeHoaKhoa(
          pickField(item, ['phanLoai', 'phan_loai', 'Phân loại'], 'Biểu mẫu SVNCKH')
        ),
        dinhDang: String(pickField(item, ['dinhDang', 'dinh_dang', 'Định dạng'], 'FILE'))
          .trim()
          .toUpperCase(),
        link: String(pickField(item, ['link', 'link_tai', 'Link tải / Xem'])).trim(),
      };
    })
    .filter(Boolean);

  // 9. Thống kê tổng hợp các niên khoá trước (Sheet Báo cáo)
  const rawReport =
    data.reportSummary ||
    data.baoCao ||
    data.historyStats ||
    data['Báo cáo'] ||
    [];
  const reportSummary = (Array.isArray(rawReport) ? rawReport : [])
    .map((item) => {
      const nk = String(pickField(item, ['nienKhoa', 'nien_khoa', 'Niên khoá', 'Niên khóa'])).trim();
      const sl = Number(pickField(item, ['soLuongDeTai', 'sl_de_tai', 'SL đề tài'], 0)) || 0;
      const giaiBo = Number(pickField(item, ['soGiaiBo', 'sl_giai_bo', 'SL giải bộ'], 0)) || 0;
      if (!nk) return null;
      return { nienKhoa: nk, soLuongDeTai: sl, soGiaiBo: giaiBo };
    })
    .filter(Boolean);

  return {
    config: configObj,
    projects,
    projectMembers,
    announcements,
    schedules,
    seminars,
    portals,
    documents,
    reportSummary,
  };
}

/* ==========================================================================
   3. TẢI DỮ LIỆU & ĐỒNG BỘ CẤU HÌNH HỆ THỐNG
   ========================================================================== */

function showStatusBanner(type, message) {
  const banner = document.getElementById('status-banner');
  const inner = document.getElementById('status-banner-inner');
  if (!banner || !inner) return;

  const styles = {
    info: 'bg-blue-50 border-blue-200 text-blue-800',
    warning: 'bg-amber-50 border-amber-200 text-amber-900',
    error: 'bg-rose-50 border-rose-200 text-rose-800',
  };

  inner.className = `rounded-xl p-3.5 text-xs sm:text-sm flex items-center justify-between gap-3 border ${styles[type] || styles.info}`;
  inner.innerHTML = `
    <div class="flex items-center gap-2.5">
      <i data-lucide="${type === 'error' ? 'alert-circle' : 'info'}" class="w-4 h-4 shrink-0"></i>
      <span>${escapeHtml(message)}</span>
    </div>
    <button type="button" onclick="document.getElementById('status-banner').classList.add('hidden')"
      class="text-xs font-bold underline opacity-80 hover:opacity-100">Đóng</button>
  `;
  banner.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

async function fetchPortalData(forceRefresh = false) {
  const refreshBtn = document.getElementById('btn-refresh-data');
  const iconEl = refreshBtn ? refreshBtn.querySelector('svg, i') : null;
  if (iconEl) iconEl.classList.add('animate-spin');

  try {
    if (!forceRefresh) {
      const cachedRaw = sessionStorage.getItem(CACHE_KEY);
      if (cachedRaw) {
        const parsedCache = JSON.parse(cachedRaw);
        if (Date.now() - parsedCache.timestamp < CACHE_TTL_MS && parsedCache.payload) {
          applyPortalState(parsedCache.payload);
          if (iconEl) iconEl.classList.remove('animate-spin');
          return;
        }
      }
    }

    const url = forceRefresh ? `${API_URL}?t=${Date.now()}` : API_URL;
    const response = await fetch(url, { method: 'GET', redirect: 'follow' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json();

    const normalized = normalizeApiPayload(json);
    sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ timestamp: Date.now(), payload: normalized })
    );

    applyPortalState(normalized);
    document.getElementById('status-banner')?.classList.add('hidden');
  } catch (err) {
    console.error('Lỗi tải dữ liệu từ Google Apps Script:', err);
    showStatusBanner(
      'error',
      'Không thể kết nối trực tiếp tới máy chủ dữ liệu Google Sheets. Vui lòng kiểm tra quyền truy cập Web App hoặc nhấn "Đồng bộ" để thử lại.'
    );
  } finally {
    if (iconEl) iconEl.classList.remove('animate-spin');
  }
}

function applyPortalState(normalized) {
  STATE.config = normalized.config || {};
  STATE.projects = normalized.projects || [];
  STATE.projectMembers = normalized.projectMembers || [];
  STATE.announcements = normalized.announcements || [];
  STATE.schedules = normalized.schedules || [];
  STATE.seminars = normalized.seminars || [];
  STATE.portals = normalized.portals || [];
  STATE.documents = normalized.documents || [];
  STATE.reportSummary = normalized.reportSummary || [];

  renderSystemConfig();
  renderInteractivePortals();
  renderKpisAndCharts();
  renderAnnouncements();
  renderSeminars();
  buildUnifiedSchedule();
  renderCalendar();
  initProjectFilters();
  applyProjectFilters();
  renderDocuments();

  if (window.lucide) lucide.createIcons();
}

/**
 * Áp dụng 16 mã cấu hình từ sheet CMS_CauHinh_HeThong
 */
function renderSystemConfig() {
  const cfg = STATE.config;

  const setText = (id, key, fallback) => {
    const el = document.getElementById(id);
    if (!el) return;
    const val = cfg[key] ? normalizeHoaKhoa(cfg[key]) : fallback;
    if (val) el.textContent = val;
  };

  setText('cfg-ten-truong', 'ten_truong', 'TRƯỜNG ĐẠI HỌC SƯ PHẠM THÀNH PHỐ HỒ CHÍ MINH');
  setText('footer-ten-truong', 'ten_truong', 'TRƯỜNG ĐẠI HỌC SƯ PHẠM THÀNH PHỐ HỒ CHÍ MINH');
  setText('cfg-ten-khoa', 'ten_khoa', 'KHOA HOÁ HỌC');
  setText('footer-ten-khoa', 'ten_khoa', 'KHOA HOÁ HỌC');
  setText('cfg-tieu-de-cong', 'tieu_de_cong', 'CỔNG THÔNG TIN NGHIÊN CỨU KHOA HỌC');

  setText('cfg-banner-nhan-phu', 'banner_nhan_phu', 'HOẠT ĐỘNG KHOA HỌC & CÔNG NGHỆ');
  setText('cfg-banner-tieu-de', 'banner_tieu_de', 'Cổng thông tin Nghiên cứu Khoa học – Khoa Hoá học');
  setText(
    'cfg-banner-mo-ta',
    'banner_mo_ta',
    'Hệ thống tổng hợp dữ liệu đề tài nghiên cứu khoa học sinh viên, công bố quốc tế, lịch tập huấn – hội nghị và biểu mẫu dành cho sinh viên, giảng viên Khoa Hoá học.'
  );
  setText('cfg-thong-ke-giai-doan', 'thong_ke_giai_doan', '2019 – 2026');

  setText('cfg-dia-chi', 'dia_chi', '280 An Dương Vương, Phường Chợ Quán, Thành phố Hồ Chí Minh');
  setText('cfg-dien-thoai', 'dien_thoai', '(028) 3835 2020');

  const emailEl = document.getElementById('cfg-email');
  if (emailEl && cfg.email) {
    emailEl.textContent = cfg.email.trim();
    emailEl.href = `mailto:${cfg.email.trim()}`;
  }

  const fanpageEl = document.getElementById('cfg-fanpage');
  if (fanpageEl && cfg.fanpage) {
    fanpageEl.href = cfg.fanpage.trim();
    fanpageEl.textContent = cfg.fanpage.trim().replace(/^https?:\/\//, '');
  }

  // Logo Header & Footer
  if (cfg.logo_header) {
    const logoUrl = convertDriveImageUrl(cfg.logo_header, 'w300');
    const container = document.getElementById('header-logo-container');
    if (container && logoUrl) {
      container.classList.remove('bg-hcmue-800');
      container.classList.add('bg-white');
      container.innerHTML = `<img src="${escapeHtml(logoUrl)}" alt="Logo Khoa Hoá học" class="w-full h-full object-contain p-1" onerror="this.parentElement.innerHTML='<span class=\\'font-extrabold text-hcmue-800 text-xs\\'>HCMUE</span>'" />`;
    }
  }

  if (cfg.logo_footer) {
    const logoFooterUrl = convertDriveImageUrl(cfg.logo_footer, 'w300');
    const container = document.getElementById('footer-logo-container');
    if (container && logoFooterUrl) {
      container.innerHTML = `<img src="${escapeHtml(logoFooterUrl)}" alt="Logo Khoa Hoá học" class="w-full h-full object-contain p-1" />`;
    }
  }

  // Thanh thông báo chạy (thong_bao_chay)
  const tickerBar = document.getElementById('ticker-bar');
  const tickerContent = document.getElementById('ticker-content');
  if (tickerBar && tickerContent) {
    const tickerText = normalizeHoaKhoa(cfg.thong_bao_chay || '').trim();
    if (tickerText) {
      tickerContent.innerHTML = `
        <span class="mx-8">${escapeHtml(tickerText)}</span>
        <span class="mx-8 text-amber-500">✦</span>
        <span class="mx-8">${escapeHtml(tickerText)}</span>
        <span class="mx-8 text-amber-500">✦</span>
      `;
      tickerBar.classList.remove('hidden');
    } else {
      tickerBar.classList.add('hidden');
    }
  }
}

/* ==========================================================================
   4. CỔNG TƯƠNG TÁC ĐỘNG (CMS_Cong_Tuong_Tac)
   ========================================================================== */

function renderInteractivePortals() {
  const grid = document.getElementById('interactive-portals-grid');
  if (!grid) return;

  if (!STATE.portals.length) {
    grid.classList.add('hidden');
    return;
  }

  grid.classList.remove('hidden');
  grid.innerHTML = STATE.portals
    .map((p) => {
      const colorNorm = normalizeSearchText(p.mauNhan);
      let badgeClass = 'bg-sky-400/20 text-sky-200 border-sky-300/30';
      if (colorNorm.includes('do')) {
        badgeClass = 'bg-rose-500/25 text-rose-200 border-rose-400/40';
      } else if (colorNorm.includes('vang')) {
        badgeClass = 'bg-amber-400/25 text-amber-200 border-amber-300/40';
      } else if (colorNorm.includes('xanh la') || colorNorm.includes('luc')) {
        badgeClass = 'bg-emerald-500/25 text-emerald-200 border-emerald-400/40';
      }

      const btnNorm = normalizeSearchText(p.kieuNut);
      const isInternalAnchor = p.link.startsWith('#');
      const targetAttr = isInternalAnchor ? '' : 'target="_blank" rel="noopener noreferrer"';

      let actionHtml = '';
      if (btnNorm.includes('ghi chu') || !p.link) {
        actionHtml = `
          <div class="mt-4 pt-3 border-t border-white/10 flex items-center gap-2 text-xs font-medium text-amber-200/90">
            <i data-lucide="sparkles" class="w-4 h-4 shrink-0 text-amber-300"></i>
            <span>${escapeHtml(p.chuNut || 'Đang mở rộng tính năng')}</span>
          </div>
        `;
      } else if (btnNorm.includes('do')) {
        actionHtml = `
          <div class="mt-4 pt-3 border-t border-white/10">
            <a href="${escapeHtml(p.link)}" ${targetAttr}
              class="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs sm:text-sm font-bold shadow-sm transition">
              <span>${escapeHtml(p.chuNut || 'Truy cập ngay')}</span>
              <i data-lucide="arrow-up-right" class="w-4 h-4"></i>
            </a>
          </div>
        `;
      } else {
        actionHtml = `
          <div class="mt-4 pt-3 border-t border-white/10">
            <a href="${escapeHtml(p.link)}" ${targetAttr}
              class="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/30 text-xs sm:text-sm font-bold transition">
              <span>${escapeHtml(p.chuNut || 'Xem chi tiết')}</span>
              <i data-lucide="arrow-right" class="w-4 h-4"></i>
            </a>
          </div>
        `;
      }

      return `
        <article class="rounded-2xl bg-white/10 backdrop-blur-md border border-white/15 p-5 flex flex-col justify-between hover:bg-white/[0.14] transition">
          <div>
            <span class="inline-block px-2.5 py-0.5 rounded-md text-[11px] font-bold tracking-wider uppercase border ${badgeClass} mb-3">
              ${escapeHtml(p.nhanPhanLoai)}
            </span>
            <h3 class="text-base sm:text-lg font-bold text-white leading-snug mb-2">
              ${escapeHtml(p.tieuDe)}
            </h3>
            <p class="text-xs sm:text-sm text-blue-100/85 leading-relaxed">
              ${escapeHtml(p.moTa)}
            </p>
          </div>
          ${actionHtml}
        </article>
      `;
    })
    .join('');
}

/* ==========================================================================
   5. KPI & BIỂU ĐỒ THỐNG KÊ (CHART.JS)
   ========================================================================== */

function renderKpisAndCharts() {
  // Hợp nhất dữ liệu theo niên khoá từ Báo cáo (lịch sử) và CMS_DeTai_NCKH (chi tiết)
  const yearMap = new Map();

  STATE.reportSummary.forEach((r) => {
    yearMap.set(r.nienKhoa, {
      nienKhoa: r.nienKhoa,
      total: r.soLuongDeTai,
      awarded: r.soGiaiBo,
      boAwards: r.soGiaiBo,
      fromDetail: false,
    });
  });

  // Đếm từ CMS_DeTai_NCKH (ưu tiên ghi đè niên khoá nếu có dữ liệu chi tiết)
  const detailByYear = new Map();
  STATE.projects.forEach((p) => {
    if (!p.nienKhoa) return;
    if (!detailByYear.has(p.nienKhoa)) {
      detailByYear.set(p.nienKhoa, { total: 0, awarded: 0, boAwards: 0 });
    }
    const stat = detailByYear.get(p.nienKhoa);
    stat.total += 1;
    if (p.giaiKhoa || p.giaiTruong || p.giaiBo) stat.awarded += 1;
    if (p.giaiBo) stat.boAwards += 1;
  });

  detailByYear.forEach((stat, nk) => {
    yearMap.set(nk, {
      nienKhoa: nk,
      total: stat.total,
      awarded: stat.awarded,
      boAwards: stat.boAwards,
      fromDetail: true,
    });
  });

  const sortedYears = Array.from(yearMap.values()).sort((a, b) =>
    a.nienKhoa.localeCompare(b.nienKhoa)
  );

  // Tính tổng KPI
  const totalProjects = sortedYears.reduce((sum, y) => sum + y.total, 0);
  const totalAwards = sortedYears.reduce((sum, y) => sum + y.awarded, 0);

  let intlPubCount = 0;
  let domPubCount = 0;
  const uniqueAdvisors = new Set();
  const uniqueStudents = new Set();

  STATE.projects.forEach((p) => {
    if (p.baiBaoQuocTe) intlPubCount += 1;
    if (p.baiBaoTrongNuoc) domPubCount += 1;
    if (p.gvhd) uniqueAdvisors.add(normalizeSearchText(p.gvhd));
    if (p.svChuNhiem) uniqueStudents.add(normalizeSearchText(p.svChuNhiem));
    if (p.svThamGia) {
      p.svThamGia
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((s) => uniqueStudents.add(normalizeSearchText(s)));
    }
  });

  document.getElementById('kpi-total-projects').textContent = totalProjects;
  document.getElementById('kpi-total-projects-sub').textContent =
    sortedYears.length > 0
      ? `Xuyên suốt ${sortedYears.length} niên khoá (${sortedYears[0].nienKhoa} – ${sortedYears[sortedYears.length - 1].nienKhoa})`
      : 'Dữ liệu đề tài SVNCKH';

  document.getElementById('kpi-total-awards').textContent = totalAwards;
  document.getElementById('kpi-total-awards-sub').textContent =
    `Gồm ${sortedYears.reduce((s, y) => s + y.boAwards, 0)} giải cấp Bộ & cấp Trường/Khoa`;

  document.getElementById('kpi-total-publications').textContent = intlPubCount + domPubCount;
  document.getElementById('kpi-total-publications-sub').textContent =
    `${intlPubCount} bài báo quốc tế • ${domPubCount} bài báo trong nước`;

  document.getElementById('kpi-total-people').textContent = `${uniqueAdvisors.size} GV / ${uniqueStudents.size} SV`;
  document.getElementById('kpi-total-people-sub').textContent =
    'Tính trên danh mục đề tài chi tiết';

  // Populate dropdown chọn niên khoá cho biểu đồ Bộ môn
  const deptYearSelect = document.getElementById('chart-dept-year-filter');
  if (deptYearSelect) {
    const detailYears = Array.from(detailByYear.keys()).sort().reverse();
    deptYearSelect.innerHTML =
      `<option value="ALL">Tất cả niên khoá (${STATE.projects.length} ĐT)</option>` +
      detailYears
        .map((y) => `<option value="${escapeHtml(y)}">Niên khoá ${escapeHtml(y)}</option>`)
        .join('');
  }

  renderYearlyChart(sortedYears);
  renderDepartmentChart('ALL');
}

function renderYearlyChart(sortedYears) {
  const ctx = document.getElementById('chart-yearly');
  if (!ctx || !window.Chart) return;

  if (STATE.charts.yearly) {
    STATE.charts.yearly.destroy();
  }

  STATE.charts.yearly = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sortedYears.map((y) => y.nienKhoa),
      datasets: [
        {
          label: 'Tổng số đề tài',
          data: sortedYears.map((y) => y.total),
          backgroundColor: 'rgba(29, 78, 216, 0.85)',
          borderRadius: 6,
          barPercentage: 0.55,
        },
        {
          label: 'Đề tài đạt giải',
          data: sortedYears.map((y) => y.awarded),
          backgroundColor: 'rgba(245, 158, 11, 0.88)',
          borderRadius: 6,
          barPercentage: 0.55,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            boxWidth: 12,
            font: { family: 'Be Vietnam Pro', size: 12, weight: '600' },
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { precision: 0, font: { family: 'Be Vietnam Pro', size: 11 } },
          grid: { color: '#f1f5f9' },
        },
        x: {
          ticks: { font: { family: 'Be Vietnam Pro', size: 11, weight: '600' } },
          grid: { display: false },
        },
      },
    },
  });
}

function renderDepartmentChart(selectedYear) {
  const ctx = document.getElementById('chart-department');
  if (!ctx || !window.Chart) return;

  const subset =
    selectedYear === 'ALL'
      ? STATE.projects
      : STATE.projects.filter((p) => p.nienKhoa === selectedYear);

  const counts = new Map();
  subset.forEach((p) => {
    const dept = p.boMon || 'Khác';
    counts.set(dept, (counts.get(dept) || 0) + 1);
  });

  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const palette = ['#1e40af', '#0284c7', '#059669', '#d97706', '#7c3aed', '#e11d48', '#475569'];

  if (STATE.charts.department) {
    STATE.charts.department.destroy();
  }

  STATE.charts.department = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: sorted.map(([name]) => name),
      datasets: [
        {
          data: sorted.map(([, val]) => val),
          backgroundColor: sorted.map((_, i) => palette[i % palette.length]),
          borderWidth: 2,
          borderColor: '#ffffff',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '60%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            boxWidth: 11,
            padding: 12,
            font: { family: 'Be Vietnam Pro', size: 11, weight: '600' },
          },
        },
      },
    },
  });
}

/* ==========================================================================
   6. THÔNG BÁO NCKH & SEMINAR (THẺ TỐI GIẢN + CUỘN DỌC TỰ ĐỘNG + MODAL)
   ========================================================================== */

function renderAnnouncements() {
  const container = document.getElementById('announcements-scroll');
  const label = document.getElementById('announcement-count-label');
  if (!container) return;

  // Sắp xếp: Ghim nổi bật lên trước, sau đó theo ngày đăng mới nhất
  const sorted = [...STATE.announcements].sort((a, b) => {
    if (a.ghim !== b.ghim) return a.ghim ? -1 : 1;
    const da = parseFlexibleDate(a.ngayDang);
    const db = parseFlexibleDate(b.ngayDang);
    if (da && db) return db - da;
    return 0;
  });

  if (label) label.textContent = `${sorted.length} thông báo đang hiển thị`;

  if (!sorted.length) {
    container.innerHTML = `<p class="text-sm text-slate-500 text-center py-8">Hiện chưa có thông báo NCKH mới.</p>`;
    return;
  }

  container.innerHTML = sorted
    .map(
      (ann) => `
      <article data-ann-id="${escapeHtml(ann.id)}"
        class="ann-card cursor-pointer group rounded-xl border ${
          ann.ghim ? 'border-rose-200 bg-rose-50/35' : 'border-slate-200/80 bg-white'
        } hover:border-blue-300 hover:shadow-sm p-4 transition">
        <div class="flex items-center justify-between gap-2 mb-1.5">
          <div class="flex items-center gap-1.5 flex-wrap">
            ${
              ann.ghim
                ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-rose-600 text-white">
                    <i data-lucide="pin" class="w-3 h-3"></i> Ghim
                  </span>`
                : ''
            }
            <span class="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-700">
              ${escapeHtml(ann.phanLoai)}
            </span>
          </div>
          <span class="text-[11px] font-mono text-slate-500 shrink-0">${escapeHtml(ann.ngayDang)}</span>
        </div>

        <h4 class="text-sm font-bold text-slate-900 group-hover:text-blue-700 transition line-clamp-2">
          ${escapeHtml(ann.tieuDe)}
        </h4>

        ${
          ann.tomTat
            ? `<p class="text-xs text-slate-600 mt-1.5 line-clamp-2 leading-relaxed">${escapeHtml(ann.tomTat)}</p>`
            : ''
        }

        <div class="mt-2.5 flex items-center justify-between text-[11px] font-semibold text-blue-700">
          <span>${ann.ngaySuKien ? `Mốc thời gian: ${escapeHtml(ann.ngaySuKien)}` : 'Nhấp để xem chi tiết'}</span>
          <span class="inline-flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
            Chi tiết <i data-lucide="chevron-right" class="w-3.5 h-3.5"></i>
          </span>
        </div>
      </article>
    `
    )
    .join('');

  setupAutoScroll('announcements-scroll');
}

function renderSeminars() {
  const container = document.getElementById('seminars-scroll');
  const label = document.getElementById('seminar-count-label');
  if (!container) return;

  const sorted = [...STATE.seminars].sort((a, b) => {
    const da = parseFlexibleDate(a.ngayBatDau);
    const db = parseFlexibleDate(b.ngayBatDau);
    if (da && db) return db - da;
    return 0;
  });

  if (label) label.textContent = `${sorted.length} chuyên đề & hội nghị`;

  if (!sorted.length) {
    container.innerHTML = `<p class="text-sm text-slate-500 text-center py-8">Chưa có dữ liệu Seminar / Hội nghị.</p>`;
    return;
  }

  container.innerHTML = sorted
    .map((sem) => {
      const stNorm = normalizeSearchText(sem.trangThai);
      let statusBadge = 'bg-blue-100 text-blue-800';
      if (stNorm.includes('da dien ra') || stNorm.includes('hoan thanh')) {
        statusBadge = 'bg-slate-100 text-slate-600';
      } else if (stNorm.includes('dang')) {
        statusBadge = 'bg-emerald-100 text-emerald-800';
      }

      return `
        <article data-sem-id="${escapeHtml(sem.id)}"
          class="sem-card cursor-pointer group rounded-xl border border-slate-200/80 bg-white hover:border-blue-300 hover:shadow-sm p-4 transition">
          <div class="flex items-center justify-between gap-2 mb-1.5">
            <span class="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-blue-50 text-blue-800 truncate max-w-[68%]">
              ${escapeHtml(sem.loaiHoatDong)}
            </span>
            <span class="px-2 py-0.5 rounded-md text-[11px] font-bold shrink-0 ${statusBadge}">
              ${escapeHtml(sem.trangThai)}
            </span>
          </div>

          <h4 class="text-sm font-bold text-slate-900 group-hover:text-blue-700 transition line-clamp-2">
            ${escapeHtml(sem.tenSuKien)}
          </h4>

          <div class="mt-2 space-y-1 text-xs text-slate-600">
            ${
              sem.dienGia
                ? `<p class="flex items-center gap-1.5 truncate">
                    <i data-lucide="user-check" class="w-3.5 h-3.5 text-slate-400 shrink-0"></i>
                    <span class="truncate">${escapeHtml(sem.dienGia)}</span>
                  </p>`
                : ''
            }
            <p class="flex items-center gap-1.5 text-slate-500">
              <i data-lucide="calendar-clock" class="w-3.5 h-3.5 text-slate-400 shrink-0"></i>
              <span>${escapeHtml(sem.ngayBatDau)}${sem.thoiGian ? ` • ${escapeHtml(sem.thoiGian)}` : ''}${sem.buoi ? ` (${escapeHtml(sem.buoi)})` : ''}</span>
            </p>
          </div>
        </article>
      `;
    })
    .join('');

  setupAutoScroll('seminars-scroll');
}

/**
 * Cơ chế cuộn dọc tự động mượt mà, tự dừng khi hover/touch/mở modal
 */
function setupAutoScroll(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;

  if (STATE.autoScrollTimers[elementId]) {
    clearInterval(STATE.autoScrollTimers[elementId]);
  }

  let direction = 1; // 1: xuống, -1: lên đầu

  const pause = () => {
    STATE.autoScrollPaused[elementId] = true;
  };
  const resume = () => {
    const btn = document.querySelector(`[data-scroll-toggle="${elementId}"]`);
    if (btn && btn.dataset.manualPaused === 'true') return;
    STATE.autoScrollPaused[elementId] = false;
  };

  el.addEventListener('mouseenter', pause);
  el.addEventListener('mouseleave', resume);
  el.addEventListener('touchstart', pause, { passive: true });
  el.addEventListener('touchend', () => setTimeout(resume, 2500), { passive: true });

  STATE.autoScrollTimers[elementId] = setInterval(() => {
    if (STATE.autoScrollPaused[elementId]) return;
    if (el.scrollHeight <= el.clientHeight + 8) return;

    const maxScroll = el.scrollHeight - el.clientHeight;
    if (direction === 1) {
      el.scrollTop += 1;
      if (el.scrollTop >= maxScroll - 1) {
        direction = -1;
      }
    } else {
      el.scrollTop -= 2;
      if (el.scrollTop <= 0) {
        direction = 1;
      }
    }
  }, 45);
}

/* ==========================================================================
   7. THỜI GIAN BIỂU ĐA NGUỒN & LỊCH TUẦN / THÁNG
   ========================================================================== */

function buildUnifiedSchedule() {
  const events = [];

  // Nguồn 1: CMS_ThoiGianBieu
  STATE.schedules.forEach((s) => {
    const start = parseFlexibleDate(s.ngayBatDau);
    if (!start) return;
    const end = parseFlexibleDate(s.ngayKetThuc) || start;
    events.push({
      id: s.id,
      source: 'LICH_KHOA',
      sourceLabel: 'Lịch hoạt động NCKH',
      badgeColor: 'bg-blue-600',
      pillClass: 'bg-blue-50 text-blue-800 border-blue-200',
      startDate: start,
      endDate: end < start ? start : end,
      buoi: s.buoi,
      time: s.gio,
      category: s.phanLoai,
      title: s.tenHoatDong,
      location: s.diaDiem,
      organizer: s.phuTrach,
      description: s.noiDung,
      link: s.link,
      linkLabel: 'Mở liên kết hoạt động',
    });
  });

  // Nguồn 2: CMS_Seminar_HoiNghi
  STATE.seminars.forEach((sem) => {
    const start = parseFlexibleDate(sem.ngayBatDau);
    if (!start) return;
    const end = parseFlexibleDate(sem.ngayKetThuc) || start;
    events.push({
      id: sem.id,
      source: 'SEMINAR',
      sourceLabel: 'Seminar & Hội nghị',
      badgeColor: 'bg-emerald-600',
      pillClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
      startDate: start,
      endDate: end < start ? start : end,
      buoi: sem.buoi,
      time: sem.thoiGian,
      category: sem.loaiHoatDong,
      title: sem.tenSuKien,
      location: sem.diaDiem,
      organizer: sem.dienGia,
      description: sem.tomTat,
      link: sem.linkDangKy || sem.linkTaiLieu,
      linkLabel: sem.linkDangKy ? 'Đăng ký tham dự' : 'Xem tài liệu / Kỷ yếu',
    });
  });

  // Nguồn 3: CMS_ThongBao_NCKH có Ngày sự kiện / Hạn mốc
  STATE.announcements.forEach((ann) => {
    if (!ann.ngaySuKien) return;
    const start = parseFlexibleDate(ann.ngaySuKien);
    if (!start) return;
    events.push({
      id: `${ann.id}_cal`,
      source: 'THONG_BAO',
      sourceLabel: 'Hạn mốc Thông báo',
      badgeColor: 'bg-rose-600',
      pillClass: 'bg-rose-50 text-rose-800 border-rose-200',
      startDate: start,
      endDate: start,
      buoi: ann.buoi,
      time: '',
      category: ann.phanLoai,
      title: ann.tieuDe,
      location: 'Khoa Hoá học – HCMUE',
      organizer: 'Trợ lý NCKH Khoa Hoá học',
      description: ann.noiDung || ann.tomTat,
      link: ann.link,
      linkLabel: ann.tenNut || 'Xem văn bản thông báo',
    });
  });

  events.sort((a, b) => a.startDate - b.startDate);
  STATE.unifiedEvents = events;

  // Nếu tháng hiện tại không có sự kiện nào, tự động nhảy tới sự kiện gần nhất để người dùng thấy dữ liệu ngay
  const now = new Date();
  const hasThisMonth = events.some(
    (e) =>
      e.startDate.getMonth() === now.getMonth() &&
      e.startDate.getFullYear() === now.getFullYear()
  );
  if (!hasThisMonth && events.length > 0) {
    const upcoming = events.find((e) => e.endDate >= new Date(now.getFullYear(), now.getMonth(), now.getDate()));
    const target = upcoming || events[events.length - 1];
    STATE.calendarCursor = new Date(target.startDate.getFullYear(), target.startDate.getMonth(), target.startDate.getDate());
  }
}

function getFilteredScheduleEvents() {
  if (STATE.scheduleSourceFilter === 'ALL') return STATE.unifiedEvents;
  return STATE.unifiedEvents.filter((e) => e.source === STATE.scheduleSourceFilter);
}

function renderCalendar() {
  const container = document.getElementById('calendar-container');
  const titleEl = document.getElementById('cal-period-title');
  if (!container || !titleEl) return;

  const events = getFilteredScheduleEvents();
  const cursor = STATE.calendarCursor;

  if (STATE.calendarView === 'month') {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    titleEl.textContent = `Tháng ${month + 1}, ${year}`;

    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);
    // Đổi sang tuần bắt đầu từ Thứ 2 (0 = T2, ..., 6 = CN)
    const startWeekday = (firstDayOfMonth.getDay() + 6) % 7;
    const totalDays = lastDayOfMonth.getDate();

    const dayNames = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];
    const todayKey = toDateKey(new Date());

    let html = `
      <div class="calendar-month-grid border-t border-l border-slate-200 rounded-xl overflow-hidden">
        ${dayNames
          .map(
            (d, i) => `
          <div class="py-2.5 px-2 text-center text-xs font-extrabold uppercase tracking-wider border-r border-b border-slate-200 ${
            i >= 5 ? 'bg-slate-100 text-rose-700' : 'bg-slate-50 text-slate-700'
          }">
            ${d}
          </div>
        `
          )
          .join('')}
    `;

    const totalCells = Math.ceil((startWeekday + totalDays) / 7) * 7;

    for (let cell = 0; cell < totalCells; cell++) {
      const dayNum = cell - startWeekday + 1;
      const cellDate = new Date(year, month, dayNum);
      const isCurrentMonth = cellDate.getMonth() === month;
      const cKey = toDateKey(cellDate);
      const isToday = cKey === todayKey;

      const dayEvents = events.filter(
        (ev) => cellDate >= ev.startDate && cellDate <= ev.endDate
      );

      html += `
        <div class="min-h-[92px] sm:min-h-[112px] p-1.5 sm:p-2 border-r border-b border-slate-200 flex flex-col gap-1 ${
          isCurrentMonth ? 'bg-white' : 'bg-slate-50/70 text-slate-400'
        }">
          <div class="flex items-center justify-between">
            <span class="w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center ${
              isToday
                ? 'bg-hcmue-800 text-white shadow-xs'
                : isCurrentMonth
                ? 'text-slate-700'
                : 'text-slate-400'
            }">
              ${cellDate.getDate()}
            </span>
            ${
              dayEvents.length > 0
                ? `<span class="text-[10px] font-bold text-slate-400">${dayEvents.length} SK</span>`
                : ''
            }
          </div>
          <div class="space-y-1 overflow-y-auto max-h-[74px] auto-scroll-box">
            ${dayEvents
              .map(
                (ev) => `
              <button type="button" data-cal-event-id="${escapeHtml(ev.id)}"
                class="cal-event-btn w-full text-left px-1.5 py-1 rounded-md border text-[11px] font-semibold leading-tight truncate hover:opacity-90 transition ${ev.pillClass}"
                title="${escapeHtml(ev.title)}">
                ${ev.time ? `<span class="font-mono text-[10px] opacity-80">${escapeHtml(ev.time.split('-')[0].trim())}</span> ` : ''}${escapeHtml(ev.title)}
              </button>
            `
              )
              .join('')}
          </div>
        </div>
      `;
    }

    html += `</div>`;
    container.innerHTML = html;
  } else if (STATE.calendarView === 'week') {
    // Tính ngày Thứ 2 đầu tuần của cursor
    const dayOfWeek = (cursor.getDay() + 6) % 7;
    const monday = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - dayOfWeek);
    const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);

    titleEl.textContent = `Tuần ${formatDateVN(monday)} – ${formatDateVN(sunday)}`;
    const dayLabels = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];
    const todayKey = toDateKey(new Date());

    let html = `<div class="grid grid-cols-1 md:grid-cols-7 gap-3">`;

    for (let i = 0; i < 7; i++) {
      const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
      const isToday = toDateKey(d) === todayKey;
      const dayEvents = events.filter((ev) => d >= ev.startDate && d <= ev.endDate);

      html += `
        <div class="rounded-xl border ${
          isToday ? 'border-blue-400 bg-blue-50/25' : 'border-slate-200 bg-slate-50/40'
        } p-3 flex flex-col min-h-[190px]">
          <div class="pb-2 mb-2.5 border-b border-slate-200/80 flex items-center justify-between">
            <span class="text-xs font-extrabold uppercase ${
              i >= 5 ? 'text-rose-700' : 'text-slate-700'
            }">${dayLabels[i]}</span>
            <span class="px-2 py-0.5 rounded-md text-xs font-bold ${
              isToday ? 'bg-hcmue-800 text-white' : 'bg-white text-slate-600 border border-slate-200'
            }">${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}</span>
          </div>

          <div class="space-y-2 flex-1">
            ${
              dayEvents.length === 0
                ? `<p class="text-[11px] text-slate-400 italic py-4 text-center">Trống lịch</p>`
                : dayEvents
                    .map(
                      (ev) => `
                  <button type="button" data-cal-event-id="${escapeHtml(ev.id)}"
                    class="cal-event-btn w-full text-left p-2.5 rounded-lg border bg-white shadow-2xs hover:shadow-sm transition space-y-1 ${ev.pillClass}">
                    <div class="flex items-center gap-1.5 text-[10px] font-bold uppercase opacity-85">
                      <span class="w-2 h-2 rounded-full ${ev.badgeColor}"></span>
                      <span class="truncate">${escapeHtml(ev.sourceLabel)}</span>
                    </div>
                    <p class="text-xs font-bold text-slate-900 line-clamp-3 leading-snug">${escapeHtml(ev.title)}</p>
                    ${
                      ev.time || ev.buoi
                        ? `<p class="text-[11px] text-slate-600 font-mono">${escapeHtml(
                            [ev.buoi, ev.time].filter(Boolean).join(' • ')
                          )}</p>`
                        : ''
                    }
                    ${
                      ev.location
                        ? `<p class="text-[11px] text-slate-500 truncate">📍 ${escapeHtml(ev.location)}</p>`
                        : ''
                    }
                  </button>
                `
                    )
                    .join('')
            }
          </div>
        </div>
      `;
    }

    html += `</div>`;
    container.innerHTML = html;
  } else {
    // Chế độ Danh sách (Agenda)
    titleEl.textContent = `Danh sách toàn bộ lịch trình (${events.length} hoạt động)`;

    if (!events.length) {
      container.innerHTML = `<p class="text-sm text-slate-500 text-center py-8">Không có sự kiện nào phù hợp với bộ lọc nguồn.</p>`;
      return;
    }

    container.innerHTML = `
      <div class="divide-y divide-slate-100">
        ${events
          .map(
            (ev) => `
          <div class="py-3.5 px-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/80 rounded-xl transition">
            <div class="flex items-start gap-3.5 min-w-0">
              <div class="shrink-0 w-24 text-center rounded-xl border border-slate-200 bg-slate-50 p-2">
                <div class="text-xs font-extrabold text-hcmue-800">${formatDateVN(ev.startDate)}</div>
                ${
                  ev.buoi || ev.time
                    ? `<div class="text-[10px] font-mono text-slate-500 mt-0.5 truncate">${escapeHtml(
                        ev.time || ev.buoi
                      )}</div>`
                    : ''
                }
              </div>
              <div class="min-w-0">
                <div class="flex items-center gap-2 flex-wrap mb-1">
                  <span class="px-2 py-0.5 rounded-md text-[11px] font-bold border ${ev.pillClass}">
                    ${escapeHtml(ev.sourceLabel)}
                  </span>
                  <span class="text-xs font-medium text-slate-500">${escapeHtml(ev.category)}</span>
                </div>
                <h4 class="text-sm font-bold text-slate-900">${escapeHtml(ev.title)}</h4>
                ${
                  ev.location
                    ? `<p class="text-xs text-slate-500 mt-0.5">Địa điểm: ${escapeHtml(ev.location)}</p>`
                    : ''
                }
              </div>
            </div>
            <button type="button" data-cal-event-id="${escapeHtml(ev.id)}"
              class="cal-event-btn shrink-0 self-start sm:self-center px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-slate-200 text-slate-700 hover:border-blue-300 hover:text-blue-700 transition">
              Xem chi tiết
            </button>
          </div>
        `
          )
          .join('')}
      </div>
    `;
  }
}

/* ==========================================================================
   8. DANH MỤC ĐỀ TÀI NCKH & BỘ LỌC ĐA CHIỀU
   ========================================================================== */

function initProjectFilters() {
  const years = new Set();
  const depts = new Set();
  const statuses = new Set();

  STATE.projects.forEach((p) => {
    if (p.nienKhoa) years.add(p.nienKhoa);
    if (p.boMon) depts.add(p.boMon);
    if (p.trangThai) statuses.add(p.trangThai);
  });

  const yearSelect = document.getElementById('filter-year');
  if (yearSelect) {
    const sortedYears = Array.from(years).sort().reverse();
    yearSelect.innerHTML =
      `<option value="ALL">Tất cả niên khoá</option>` +
      sortedYears.map((y) => `<option value="${escapeHtml(y)}">${escapeHtml(y)}</option>`).join('');
  }

  const deptSelect = document.getElementById('filter-dept');
  if (deptSelect) {
    const sortedDepts = Array.from(depts).sort();
    deptSelect.innerHTML =
      `<option value="ALL">Tất cả Bộ môn / Lĩnh vực</option>` +
      sortedDepts.map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
  }

  const statusSelect = document.getElementById('filter-status');
  if (statusSelect) {
    const sortedStatuses = Array.from(statuses).sort();
    statusSelect.innerHTML =
      `<option value="ALL">Trạng thái: Tất cả</option>` +
      sortedStatuses
        .map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`)
        .join('');
  }
}

function applyProjectFilters(resetPagination = true) {
  const query = normalizeSearchText(document.getElementById('filter-search')?.value || '');
  const yearVal = document.getElementById('filter-year')?.value || 'ALL';
  const deptVal = document.getElementById('filter-dept')?.value || 'ALL';
  const awardVal = document.getElementById('filter-award')?.value || 'ALL';
  const pubVal = document.getElementById('filter-pub')?.value || 'ALL';
  const statusVal = document.getElementById('filter-status')?.value || 'ALL';

  STATE.filteredProjects = STATE.projects.filter((p) => {
    if (yearVal !== 'ALL' && p.nienKhoa !== yearVal) return false;
    if (deptVal !== 'ALL' && p.boMon !== deptVal) return false;
    if (statusVal !== 'ALL' && p.trangThai !== statusVal) return false;

    if (awardVal === 'ANY_AWARD' && !(p.giaiKhoa || p.giaiTruong || p.giaiBo)) return false;
    if (awardVal === 'BO' && !p.giaiBo) return false;
    if (awardVal === 'TRUONG' && !p.giaiTruong) return false;
    if (awardVal === 'KHOA' && !p.giaiKhoa) return false;

    if (pubVal === 'ANY_PUB' && !(p.baiBaoQuocTe || p.baiBaoTrongNuoc)) return false;
    if (pubVal === 'INTL' && !p.baiBaoQuocTe) return false;
    if (pubVal === 'DOMESTIC' && !p.baiBaoTrongNuoc) return false;

    if (query) {
      const haystack = normalizeSearchText(
        [p.maSo, p.tenDeTai, p.svChuNhiem, p.svThamGia, p.gvhd, p.boMon, p.tuKhoa, p.nienKhoa].join(
          ' '
        )
      );
      if (!haystack.includes(query)) return false;
    }

    return true;
  });

  if (resetPagination) {
    STATE.visibleCount = STATE.pageSize;
  }

  renderProjectsGrid();
}

function renderProjectsGrid() {
  const grid = document.getElementById('projects-grid');
  const countEl = document.getElementById('projects-match-count');
  const pagEl = document.getElementById('projects-pagination');
  if (!grid) return;

  const total = STATE.filteredProjects.length;
  if (countEl) countEl.textContent = total;

  if (!total) {
    grid.innerHTML = `
      <div class="md:col-span-2 bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-2">
        <p class="text-base font-bold text-slate-800">Không tìm thấy đề tài phù hợp</p>
        <p class="text-xs text-slate-500">Vui lòng thử thay đổi từ khoá hoặc nhấn "Đặt lại" bộ lọc.</p>
      </div>
    `;
    if (pagEl) pagEl.innerHTML = '';
    return;
  }

  // Hai công tắc độc lập từ CMS_CauHinh_HeThong
  const showPubBadge = isConfigEnabled(STATE.config.hien_thi_nhan_cong_bo, true);
  const showDoiLink = isConfigEnabled(STATE.config.hien_thi_link_doi, true);

  const visibleItems = STATE.filteredProjects.slice(0, STATE.visibleCount);

  grid.innerHTML = visibleItems
    .map((p) => {
      const awards = [];
      if (p.giaiBo) awards.push(`Giải ${p.giaiBo} cấp Bộ`);
      if (p.giaiTruong) awards.push(`Giải ${p.giaiTruong} cấp Trường`);
      if (p.giaiKhoa) awards.push(`Giải ${p.giaiKhoa} cấp Khoa`);

      const hasIntl = Boolean(p.baiBaoQuocTe);
      const hasDom = Boolean(p.baiBaoTrongNuoc);

      let pubBadgesHtml = '';
      if (showPubBadge && (hasIntl || hasDom)) {
        if (hasIntl) {
          pubBadgesHtml += `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
            <i data-lucide="globe-2" class="w-3 h-3"></i> Bài báo Quốc tế
          </span>`;
        }
        if (hasDom) {
          pubBadgesHtml += `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-teal-50 text-teal-800 border border-teal-200">
            <i data-lucide="file-text" class="w-3 h-3"></i> Bài báo Trong nước
          </span>`;
        }
      }

      let doiLinksHtml = '';
      if (showDoiLink && (hasIntl || hasDom)) {
        if (hasIntl) {
          doiLinksHtml += `<a href="${escapeHtml(p.baiBaoQuocTe)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()"
            class="inline-flex items-center gap-1 text-[11px] font-mono font-semibold text-blue-700 hover:underline">
            <i data-lucide="external-link" class="w-3 h-3"></i> DOI Quốc tế
          </a>`;
        }
        if (hasDom) {
          doiLinksHtml += `<a href="${escapeHtml(p.baiBaoTrongNuoc)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()"
            class="inline-flex items-center gap-1 text-[11px] font-mono font-semibold text-teal-700 hover:underline">
            <i data-lucide="external-link" class="w-3 h-3"></i> Link Bài báo
          </a>`;
        }
      }

      return `
        <article data-proj-id="${escapeHtml(p.id)}"
          class="proj-card cursor-pointer group bg-white rounded-2xl border border-slate-200/90 hover:border-blue-300 shadow-2xs hover:shadow-md p-5 flex flex-col justify-between transition">
          <div>
            <!-- Meta header -->
            <div class="flex items-center justify-between gap-2 flex-wrap mb-2.5">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="px-2.5 py-0.5 rounded-md text-xs font-extrabold bg-hcmue-800 text-white">
                  ${escapeHtml(p.nienKhoa)}
                </span>
                <span class="px-2 py-0.5 rounded-md text-xs font-semibold bg-slate-100 text-slate-700">
                  ${escapeHtml(p.boMon)}
                </span>
              </div>
              ${
                p.linkAnhVinhDanh
                  ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200" title="Có ảnh vinh danh">
                      <i data-lucide="image" class="w-3 h-3"></i> Ảnh vinh danh
                    </span>`
                  : ''
              }
            </div>

            <!-- Tên đề tài -->
            <h3 class="text-base font-bold text-slate-900 group-hover:text-blue-700 transition leading-snug mb-3">
              ${escapeHtml(p.tenDeTai)}
            </h3>

            <!-- Thông tin nhóm nghiên cứu -->
            <div class="space-y-1.5 text-xs text-slate-600 mb-3">
              <p class="flex items-start gap-2">
                <i data-lucide="graduation-cap" class="w-4 h-4 text-blue-700 shrink-0 mt-0.5"></i>
                <span><strong class="text-slate-800">GVHD:</strong> ${escapeHtml(p.gvhd || 'Đang cập nhật')}</span>
              </p>
              <p class="flex items-start gap-2">
                <i data-lucide="user" class="w-4 h-4 text-slate-400 shrink-0 mt-0.5"></i>
                <span><strong class="text-slate-800">SV chủ nhiệm:</strong> ${escapeHtml(p.svChuNhiem || '—')}</span>
              </p>
              ${
                p.svThamGia
                  ? `<p class="flex items-start gap-2">
                      <i data-lucide="users" class="w-4 h-4 text-slate-400 shrink-0 mt-0.5"></i>
                      <span class="line-clamp-1"><strong class="text-slate-800">Thành viên:</strong> ${escapeHtml(p.svThamGia)}</span>
                    </p>`
                  : ''
              }
            </div>
          </div>

          <!-- Badges giải thưởng & công bố -->
          <div class="pt-3 border-t border-slate-100 space-y-2">
            ${
              awards.length > 0
                ? `<div class="flex flex-wrap gap-1.5">
                    ${awards
                      .map(
                        (aw) => `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-100/90 text-amber-900">
                          <i data-lucide="trophy" class="w-3 h-3 text-amber-600"></i> ${escapeHtml(aw)}
                        </span>`
                      )
                      .join('')}
                  </div>`
                : ''
            }

            <div class="flex items-center justify-between gap-2 flex-wrap">
              <div class="flex items-center gap-1.5 flex-wrap">
                ${pubBadgesHtml}
                ${doiLinksHtml}
              </div>
              <span class="text-xs font-bold text-blue-700 group-hover:translate-x-0.5 transition-transform ml-auto">
                Chi tiết →
              </span>
            </div>
          </div>
        </article>
      `;
    })
    .join('');

  // Render nút Xem thêm / Thu gọn
  if (pagEl) {
    if (STATE.visibleCount < total) {
      const remaining = total - STATE.visibleCount;
      pagEl.innerHTML = `
        <button id="btn-load-more-projects" type="button"
          class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white hover:bg-blue-50 text-hcmue-800 border border-slate-300 text-xs sm:text-sm font-bold shadow-2xs transition">
          <i data-lucide="plus-circle" class="w-4 h-4"></i>
          Xem thêm đề tài (còn ${remaining} đề tài)
        </button>
      `;
    } else if (total > STATE.pageSize) {
      pagEl.innerHTML = `
        <button id="btn-collapse-projects" type="button"
          class="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition">
          Thu gọn danh sách
        </button>
      `;
    } else {
      pagEl.innerHTML = '';
    }
  }

  if (window.lucide) lucide.createIcons();
}

function exportFilteredProjectsToCsv() {
  if (!STATE.filteredProjects.length) return;

  const headers = [
    'Niên khoá',
    'Mã số',
    'Tên đề tài',
    'SV chủ nhiệm',
    'SV tham gia',
    'Bộ môn / Lĩnh vực',
    'Giảng viên hướng dẫn',
    'Giải cấp Khoa',
    'Giải cấp Trường',
    'Giải cấp Bộ',
    'Bài báo quốc tế',
    'Bài báo trong nước',
    'Trạng thái',
  ];

  const rows = STATE.filteredProjects.map((p) => [
    p.nienKhoa,
    p.maSo,
    p.tenDeTai,
    p.svChuNhiem,
    p.svThamGia,
    p.boMon,
    p.gvhd,
    p.giaiKhoa,
    p.giaiTruong,
    p.giaiBo,
    p.baiBaoQuocTe,
    p.baiBaoTrongNuoc,
    p.trangThai,
  ]);

  const csvContent =
    '\uFEFF' +
    [headers, ...rows]
      .map((r) => r.map((cell) => `"${String(cell || '').replace(/"/g, '""')}"`).join(','))
      .join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `DanhMuc_SVNCKH_KhoaHoaHoc_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ==========================================================================
   9. VĂN BẢN & BIỂU MẪU (CMS_VanBan_BieuMau)
   ========================================================================== */

function renderDocuments() {
  const grid = document.getElementById('documents-grid');
  if (!grid) return;

  if (!STATE.documents.length) {
    grid.innerHTML = `<p class="sm:col-span-2 lg:col-span-4 text-sm text-slate-500 text-center py-6">Chưa có văn bản / biểu mẫu được công bố.</p>`;
    return;
  }

  grid.innerHTML = STATE.documents
    .map((doc) => {
      const fmt = doc.dinhDang;
      let fmtColor = 'bg-slate-100 text-slate-700';
      let icon = 'file-text';
      if (fmt === 'PDF') {
        fmtColor = 'bg-rose-100 text-rose-800';
        icon = 'file-type';
      } else if (fmt === 'RAR' || fmt === 'ZIP') {
        fmtColor = 'bg-amber-100 text-amber-800';
        icon = 'file-archive';
      } else if (fmt === 'FOLDER') {
        fmtColor = 'bg-blue-100 text-blue-800';
        icon = 'folder-open';
      }

      return `
        <a href="${escapeHtml(doc.link || '#')}" target="_blank" rel="noopener noreferrer"
          class="group bg-white rounded-2xl border border-slate-200/90 hover:border-blue-300 shadow-2xs hover:shadow-md p-4 flex flex-col justify-between transition">
          <div>
            <div class="flex items-center justify-between gap-2 mb-3">
              <div class="w-9 h-9 rounded-xl ${fmtColor} flex items-center justify-center">
                <i data-lucide="${icon}" class="w-5 h-5"></i>
              </div>
              <span class="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold ${fmtColor}">
                ${escapeHtml(fmt)}
              </span>
            </div>
            <h3 class="text-sm font-bold text-slate-900 group-hover:text-blue-700 transition line-clamp-2 mb-1">
              ${escapeHtml(doc.ten)}
            </h3>
            <p class="text-xs text-slate-500">${escapeHtml(doc.phanLoai)}</p>
          </div>
          <div class="mt-4 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs font-bold text-blue-700">
            <span>${fmt === 'FOLDER' ? 'Mở thư mục' : 'Tải về / Xem'}</span>
            <i data-lucide="arrow-up-right" class="w-4 h-4"></i>
          </div>
        </a>
      `;
    })
    .join('');
}

/* ==========================================================================
   10. MODALS CHI TIẾT (ĐỀ TÀI, THÔNG BÁO, SỰ KIỆN)
   ========================================================================== */

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.classList.remove('hidden');
  document.body.classList.add('overflow-hidden');
  if (window.lucide) lucide.createIcons();
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.classList.add('hidden');
  document.body.classList.remove('overflow-hidden');
}

function openProjectDetail(projectId) {
  const p = STATE.projects.find((item) => item.id === projectId);
  if (!p) return;

  document.getElementById('modal-proj-year').textContent = `Niên khoá ${p.nienKhoa}`;
  document.getElementById('modal-proj-code').textContent = `Mã số: ${p.maSo}`;

  const statusEl = document.getElementById('modal-proj-status');
  statusEl.textContent = p.trangThai;
  statusEl.className =
    'px-2.5 py-1 rounded-lg text-xs font-bold ' +
    (normalizeSearchText(p.trangThai).includes('nghiem thu')
      ? 'bg-emerald-100 text-emerald-800'
      : 'bg-amber-100 text-amber-800');

  const showPubBadge = isConfigEnabled(STATE.config.hien_thi_nhan_cong_bo, true);
  const showDoiLink = isConfigEnabled(STATE.config.hien_thi_link_doi, true);

  // Chuyển đổi ảnh vinh danh từ Google Drive nếu có
  const honorImgUrl = convertDriveImageUrl(p.linkAnhVinhDanh, 'w1200');
  const fileId = extractDriveFileId(p.linkAnhVinhDanh);
  const fallbackImgUrl = fileId ? `https://lh3.googleusercontent.com/d/${fileId}` : '';

  const awardsHtml = [
    p.giaiBo ? `<span class="px-3 py-1 rounded-lg text-xs font-bold bg-rose-100 text-rose-800">🏆 Giải ${escapeHtml(p.giaiBo)} cấp Bộ</span>` : '',
    p.giaiTruong ? `<span class="px-3 py-1 rounded-lg text-xs font-bold bg-amber-100 text-amber-900">🏅 Giải ${escapeHtml(p.giaiTruong)} cấp Trường</span>` : '',
    p.giaiKhoa ? `<span class="px-3 py-1 rounded-lg text-xs font-bold bg-blue-100 text-blue-800">🎖️ Giải ${escapeHtml(p.giaiKhoa)} cấp Khoa</span>` : '',
  ]
    .filter(Boolean)
    .join('');

  let pubSectionHtml = '';
  if ((showPubBadge || showDoiLink) && (p.baiBaoQuocTe || p.baiBaoTrongNuoc)) {
    pubSectionHtml = `
      <div class="rounded-xl bg-emerald-50/70 border border-emerald-200 p-4 space-y-2">
        <h4 class="text-xs font-extrabold uppercase tracking-wider text-emerald-900">Công bố khoa học từ đề tài</h4>
        ${
          p.baiBaoQuocTe
            ? `<div class="flex flex-wrap items-center justify-between gap-2 text-xs">
                ${showPubBadge ? `<span class="font-bold text-emerald-800">• Bài báo khoa học quốc tế</span>` : `<span>• Công trình quốc tế</span>`}
                ${
                  showDoiLink
                    ? `<a href="${escapeHtml(p.baiBaoQuocTe)}" target="_blank" rel="noopener noreferrer"
                        class="font-mono font-semibold text-blue-700 hover:underline break-all">
                        ${escapeHtml(p.baiBaoQuocTe)} ↗
                      </a>`
                    : ''
                }
              </div>`
            : ''
        }
        ${
          p.baiBaoTrongNuoc
            ? `<div class="flex flex-wrap items-center justify-between gap-2 text-xs">
                ${showPubBadge ? `<span class="font-bold text-teal-800">• Bài báo khoa học trong nước</span>` : `<span>• Công trình trong nước</span>`}
                ${
                  showDoiLink
                    ? `<a href="${escapeHtml(p.baiBaoTrongNuoc)}" target="_blank" rel="noopener noreferrer"
                        class="font-mono font-semibold text-blue-700 hover:underline break-all">
                        ${escapeHtml(p.baiBaoTrongNuoc)} ↗
                      </a>`
                    : ''
                }
              </div>`
            : ''
        }
      </div>
    `;
  }

  document.getElementById('modal-proj-body').innerHTML = `
    <div>
      <p class="text-xs font-bold uppercase tracking-wider text-blue-700 mb-1">${escapeHtml(p.boMon)}</p>
      <h3 class="text-lg sm:text-xl font-extrabold text-slate-900 leading-snug">${escapeHtml(p.tenDeTai)}</h3>
    </div>

    ${awardsHtml ? `<div class="flex flex-wrap gap-2">${awardsHtml}</div>` : ''}

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl bg-slate-50 border border-slate-200/80 p-4 text-xs sm:text-sm">
      <div>
        <span class="text-slate-500 block text-xs">Giảng viên hướng dẫn</span>
        <strong class="text-slate-900 font-bold">${escapeHtml(p.gvhd || 'Đang cập nhật')}</strong>
      </div>
      <div>
        <span class="text-slate-500 block text-xs">Sinh viên chủ nhiệm</span>
        <strong class="text-slate-900 font-bold">${escapeHtml(p.svChuNhiem || '—')}</strong>
      </div>
      <div class="sm:col-span-2">
        <span class="text-slate-500 block text-xs">Sinh viên tham gia thực hiện</span>
        <span class="text-slate-800 font-medium">${escapeHtml(p.svThamGia || 'Không có')}</span>
      </div>
      ${
        p.nganhDaoTao
          ? `<div class="sm:col-span-2">
              <span class="text-slate-500 block text-xs">Ngành đào tạo</span>
              <span class="text-slate-800 font-medium">${escapeHtml(p.nganhDaoTao)}</span>
            </div>`
          : ''
      }
    </div>

    ${
      p.tomTat
        ? `<div>
            <h4 class="text-xs font-extrabold uppercase tracking-wider text-slate-500 mb-1.5">Tóm tắt nội dung nghiên cứu</h4>
            <p class="text-slate-700 leading-relaxed whitespace-pre-line bg-white rounded-xl border border-slate-200/80 p-3.5">${escapeHtml(
              p.tomTat
            )}</p>
          </div>`
        : ''
    }

    ${pubSectionHtml}

    ${
      honorImgUrl
        ? `<div class="space-y-2">
            <div class="flex items-center justify-between">
              <h4 class="text-xs font-extrabold uppercase tracking-wider text-amber-800">Hình ảnh vinh danh / Hội nghị</h4>
              <a href="${escapeHtml(p.linkAnhVinhDanh)}" target="_blank" rel="noopener noreferrer"
                class="text-xs font-semibold text-blue-700 hover:underline">Mở ảnh gốc ↗</a>
            </div>
            <div class="rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
              <img src="${escapeHtml(honorImgUrl)}"
                alt="Ảnh vinh danh đề tài ${escapeHtml(p.tenDeTai)}"
                class="w-full max-h-96 object-contain mx-auto"
                onerror="if(this.dataset.fallback && this.src !== this.dataset.fallback){this.src=this.dataset.fallback;}else{this.parentElement.innerHTML='<div class=\\'p-4 text-xs text-slate-500 text-center\\'>Không thể tải trực tiếp bản xem trước. Vui lòng nhấn <strong>Mở ảnh gốc</strong> phía trên.</div>';}"
                data-fallback="${escapeHtml(fallbackImgUrl)}" />
            </div>
          </div>`
        : ''
    }

    ${
      p.linkQuyetDinh
        ? `<div class="pt-2 flex justify-end">
            <a href="${escapeHtml(p.linkQuyetDinh)}" target="_blank" rel="noopener noreferrer"
              class="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-hcmue-800 hover:bg-hcmue-700 text-white text-xs font-bold transition">
              <i data-lucide="file-check-2" class="w-4 h-4"></i>
              Xem Quyết định công nhận / Kỷ yếu
            </a>
          </div>`
        : ''
    }
  `;

  openModal('project-modal');
}

function openAnnouncementDetail(annId) {
  const ann = STATE.announcements.find((item) => item.id === annId);
  if (!ann) return;

  document.getElementById('modal-ann-badge').textContent = ann.phanLoai;
  document.getElementById('modal-ann-body').innerHTML = `
    <div class="space-y-2">
      <div class="flex items-center gap-3 text-xs text-slate-500">
        <span>Ngày đăng: <strong>${escapeHtml(ann.ngayDang)}</strong></span>
        ${ann.ngaySuKien ? `<span>• Mốc sự kiện: <strong class="text-rose-700">${escapeHtml(ann.ngaySuKien)}</strong></span>` : ''}
      </div>
      <h3 class="text-lg sm:text-xl font-extrabold text-slate-900 leading-snug">${escapeHtml(ann.tieuDe)}</h3>
    </div>

    <div class="rounded-xl bg-slate-50 border border-slate-200/80 p-4 text-slate-700 leading-relaxed whitespace-pre-line">
      ${escapeHtml(ann.noiDung || ann.tomTat || 'Nội dung đang được cập nhật.')}
    </div>

    ${
      ann.link
        ? `<div class="pt-2 flex justify-end">
            <a href="${escapeHtml(ann.link)}" target="_blank" rel="noopener noreferrer"
              class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-700 hover:bg-blue-600 text-white text-xs sm:text-sm font-bold transition">
              <span>${escapeHtml(ann.tenNut || 'Mở liên kết đính kèm')}</span>
              <i data-lucide="external-link" class="w-4 h-4"></i>
            </a>
          </div>`
        : ''
    }
  `;

  openModal('announcement-modal');
}

function openCalendarEventDetail(eventId) {
  const ev = STATE.unifiedEvents.find((item) => item.id === eventId);
  if (!ev) return;

  // Tạo link Google Calendar
  const startStr = toDateKey(ev.startDate).replace(/-/g, '');
  const nextDay = new Date(ev.endDate.getFullYear(), ev.endDate.getMonth(), ev.endDate.getDate() + 1);
  const endStr = toDateKey(nextDay).replace(/-/g, '');
  const gcalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(
    ev.title
  )}&dates=${startStr}/${endStr}&details=${encodeURIComponent(
    ev.description || ''
  )}&location=${encodeURIComponent(ev.location || '')}`;

  document.getElementById('modal-evt-badge').textContent = `${ev.sourceLabel} • ${ev.category}`;
  document.getElementById('modal-evt-body').innerHTML = `
    <h3 class="text-lg sm:text-xl font-extrabold text-slate-900 leading-snug">${escapeHtml(ev.title)}</h3>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl bg-slate-50 border border-slate-200/80 p-4 text-xs sm:text-sm">
      <div>
        <span class="text-slate-500 block text-xs">Thời gian</span>
        <strong class="text-slate-900">
          ${formatDateVN(ev.startDate)}${
            toDateKey(ev.endDate) !== toDateKey(ev.startDate) ? ` – ${formatDateVN(ev.endDate)}` : ''
          }
          ${ev.time || ev.buoi ? ` (${escapeHtml([ev.buoi, ev.time].filter(Boolean).join(' - '))})` : ''}
        </strong>
      </div>
      <div>
        <span class="text-slate-500 block text-xs">Địa điểm</span>
        <strong class="text-slate-900">${escapeHtml(ev.location || 'Khoa Hoá học – HCMUE')}</strong>
      </div>
      ${
        ev.organizer
          ? `<div class="sm:col-span-2">
              <span class="text-slate-500 block text-xs">Diễn giả / Đơn vị phụ trách</span>
              <strong class="text-slate-900">${escapeHtml(ev.organizer)}</strong>
            </div>`
          : ''
      }
    </div>

    ${
      ev.description
        ? `<div class="text-slate-700 leading-relaxed whitespace-pre-line bg-white rounded-xl border border-slate-200/80 p-4">
            ${escapeHtml(ev.description)}
          </div>`
        : ''
    }

    <div class="pt-2 flex flex-wrap items-center justify-end gap-2.5">
      <a href="${escapeHtml(gcalUrl)}" target="_blank" rel="noopener noreferrer"
        class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold transition">
        <i data-lucide="calendar-plus" class="w-4 h-4"></i>
        Lưu vào Google Calendar
      </a>
      ${
        ev.link
          ? `<a href="${escapeHtml(ev.link)}" target="_blank" rel="noopener noreferrer"
              class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-700 hover:bg-blue-600 text-white text-xs font-bold transition">
              <span>${escapeHtml(ev.linkLabel || 'Xem chi tiết')}</span>
              <i data-lucide="external-link" class="w-4 h-4"></i>
            </a>`
          : ''
      }
    </div>
  `;

  openModal('event-modal');
}

function openSeminarDetail(semId) {
  // Mở trực tiếp qua event modal thống nhất
  openCalendarEventDetail(semId);
}

/* ==========================================================================
   11. ĐĂNG KÝ SỰ KIỆN TƯƠNG TÁC (EVENT LISTENERS)
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) lucide.createIcons();

  // Menu mobile
  document.getElementById('btn-mobile-menu')?.addEventListener('click', () => {
    document.getElementById('mobile-menu')?.classList.toggle('hidden');
  });

  // Nút đồng bộ lại dữ liệu
  document.getElementById('btn-refresh-data')?.addEventListener('click', () => {
    fetchPortalData(true);
  });

  // Lọc biểu đồ theo niên khoá
  document.getElementById('chart-dept-year-filter')?.addEventListener('change', (e) => {
    renderDepartmentChart(e.target.value);
  });

  // Nút bật/tắt tự cuộn
  document.querySelectorAll('[data-scroll-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.scrollToggle;
      const isPaused = btn.dataset.manualPaused === 'true';
      if (isPaused) {
        btn.dataset.manualPaused = 'false';
        STATE.autoScrollPaused[targetId] = false;
        btn.innerHTML = `<i data-lucide="pause" class="w-3.5 h-3.5"></i><span>Tự cuộn</span>`;
      } else {
        btn.dataset.manualPaused = 'true';
        STATE.autoScrollPaused[targetId] = true;
        btn.innerHTML = `<i data-lucide="play" class="w-3.5 h-3.5"></i><span>Tiếp tục</span>`;
      }
      if (window.lucide) lucide.createIcons();
    });
  });

  // Chuyển chế độ xem Thời gian biểu (Tháng / Tuần / Danh sách)
  document.querySelectorAll('.cal-view-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      STATE.calendarView = btn.dataset.calView;
      document.querySelectorAll('.cal-view-btn').forEach((b) => {
        b.classList.remove('bg-white', 'text-hcmue-800', 'shadow-2xs');
        b.classList.add('text-slate-600');
      });
      btn.classList.add('bg-white', 'text-hcmue-800', 'shadow-2xs');
      btn.classList.remove('text-slate-600');
      renderCalendar();
    });
  });

  // Lọc nguồn thời gian biểu
  document.getElementById('schedule-source-filter')?.addEventListener('change', (e) => {
    STATE.scheduleSourceFilter = e.target.value;
    renderCalendar();
  });

  // Điều hướng tiến/lùi thời gian của Lịch
  document.getElementById('cal-prev-btn')?.addEventListener('click', () => {
    const c = STATE.calendarCursor;
    if (STATE.calendarView === 'week') {
      STATE.calendarCursor = new Date(c.getFullYear(), c.getMonth(), c.getDate() - 7);
    } else {
      STATE.calendarCursor = new Date(c.getFullYear(), c.getMonth() - 1, 1);
    }
    renderCalendar();
  });

  document.getElementById('cal-next-btn')?.addEventListener('click', () => {
    const c = STATE.calendarCursor;
    if (STATE.calendarView === 'week') {
      STATE.calendarCursor = new Date(c.getFullYear(), c.getMonth(), c.getDate() + 7);
    } else {
      STATE.calendarCursor = new Date(c.getFullYear(), c.getMonth() + 1, 1);
    }
    renderCalendar();
  });

  document.getElementById('cal-today-btn')?.addEventListener('click', () => {
    STATE.calendarCursor = new Date();
    renderCalendar();
  });

  // Bộ lọc danh mục đề tài
  ['filter-search', 'filter-year', 'filter-dept', 'filter-award', 'filter-pub', 'filter-status'].forEach(
    (id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener(id === 'filter-search' ? 'input' : 'change', () => {
        applyProjectFilters(true);
      });
    }
  );

  document.getElementById('btn-reset-filters')?.addEventListener('click', () => {
    document.getElementById('filter-search').value = '';
    document.getElementById('filter-year').value = 'ALL';
    document.getElementById('filter-dept').value = 'ALL';
    document.getElementById('filter-award').value = 'ALL';
    document.getElementById('filter-pub').value = 'ALL';
    document.getElementById('filter-status').value = 'ALL';
    applyProjectFilters(true);
  });

  document.getElementById('btn-export-csv')?.addEventListener('click', exportFilteredProjectsToCsv);

  // Event delegation cho thẻ đề tài, thông báo, seminar, lịch & nút phân trang
  document.addEventListener('click', (e) => {
    const projCard = e.target.closest('.proj-card');
    if (projCard) {
      openProjectDetail(projCard.dataset.projId);
      return;
    }

    const annCard = e.target.closest('.ann-card');
    if (annCard) {
      openAnnouncementDetail(annCard.dataset.annId);
      return;
    }

    const semCard = e.target.closest('.sem-card');
    if (semCard) {
      openSeminarDetail(semCard.dataset.semId);
      return;
    }

    const calBtn = e.target.closest('.cal-event-btn');
    if (calBtn) {
      openCalendarEventDetail(calBtn.dataset.calEventId);
      return;
    }

    if (e.target.closest('#btn-load-more-projects')) {
      STATE.visibleCount += STATE.pageSize;
      renderProjectsGrid();
      return;
    }

    if (e.target.closest('#btn-collapse-projects')) {
      STATE.visibleCount = STATE.pageSize;
      renderProjectsGrid();
      document.getElementById('danh-muc-de-tai')?.scrollIntoView({ behavior: 'smooth' });
      return;
    }

    const closeBtn = e.target.closest('[data-close-modal]');
    if (closeBtn) {
      closeModal(closeBtn.dataset.closeModal);
      return;
    }

    // Đóng modal khi nhấp ra nền tối bên ngoài
    if (e.target.classList.contains('modal-backdrop') && e.target.id) {
      closeModal(e.target.id);
    }
  });

  // Phím ESC đóng tất cả modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      ['project-modal', 'announcement-modal', 'event-modal'].forEach(closeModal);
    }
  });

  // Khởi chạy tải dữ liệu từ API
  fetchPortalData(false);
});
