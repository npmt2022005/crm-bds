"use strict";

/**
 * HdmbPDF - Trình tạo file Hợp đồng mua bán căn hộ (HĐMB) chuẩn PDF in ấn
 * Tự động đổ dữ liệu căn hộ, khách hàng, cơ cấu giá, dịch số tiền thành chữ tiếng Việt,
 * và sinh bảng Phụ lục lịch thanh toán theo phương thức đã chọn.
 */
const HdmbPDF = (() => {
  let assets;

  function loadLibrary() {
    if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "./vendor/jspdf.umd.min.js";
      script.onload = () => {
        const library = window.jspdf?.jsPDF;
        if (library) resolve(library);
        else reject(new Error("Không tải được thư viện PDF."));
      };
      script.onerror = () => reject(new Error("Không tải được thư viện PDF."));
      document.head.append(script);
    });
  }

  async function loadFont() {
    const response = await fetch("./vendor/NotoSans-Regular.ttf");
    if (!response.ok) throw new Error("Không tải được phông chữ PDF.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  function dependencies() {
    if (!assets) {
      assets = Promise.all([loadLibrary(), loadFont()]).catch((error) => {
        assets = null;
        throw error;
      });
    }
    return assets;
  }

  /* Thuật toán chuyển số tiền sang chữ tiếng Việt chuẩn xác */
  function numberToWordsVN(num) {
    if (!num || isNaN(num) || num === 0) return "Không đồng";
    num = Math.round(Number(num));
    const digits = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];
    const units = ["", "nghìn", "triệu", "tỷ"];

    function readGroup(n, isFirst) {
      let h = Math.floor(n / 100);
      let t = Math.floor((n % 100) / 10);
      let u = n % 10;
      let s = "";
      if (h > 0 || !isFirst) {
        s += digits[h] + " trăm ";
      }
      if (t > 1) {
        s += digits[t] + " mươi ";
        if (u === 1) s += "mốt ";
        else if (u === 5) s += "lăm ";
        else if (u > 0) s += digits[u] + " ";
      } else if (t === 1) {
        s += "mười ";
        if (u === 1) s += "một ";
        else if (u === 5) s += "lăm ";
        else if (u > 0) s += digits[u] + " ";
      } else if (t === 0 && (h > 0 || !isFirst) && u > 0) {
        s += "lẻ " + digits[u] + " ";
      } else if (t === 0 && isFirst && u > 0) {
        s += digits[u] + " ";
      }
      return s.trim();
    }

    let groups = [];
    let temp = num;
    while (temp > 0) {
      groups.push(temp % 1000);
      temp = Math.floor(temp / 1000);
    }

    let parts = [];
    for (let i = groups.length - 1; i >= 0; i--) {
      let g = groups[i];
      if (g > 0) {
        let isFirst = (i === groups.length - 1);
        let gText = readGroup(g, isFirst);
        let uIdx = i % 4;
        let bill = Math.floor(i / 4);
        let uText = units[uIdx] + (bill > 0 && uIdx === 0 ? " tỷ".repeat(bill) : "");
        parts.push(gText + (uText ? " " + uText : ""));
      }
    }

    let res = parts.join(" ").replace(/\s+/g, " ").trim();
    if (!res) return "Không đồng";
    return res.charAt(0).toUpperCase() + res.slice(1) + " đồng chẵn";
  }

  function formatMoney(amount) {
    return new Intl.NumberFormat("vi-VN").format(Math.round(amount || 0)) + " ₫";
  }

  async function create(data) {
    const [jsPDF, font] = await dependencies();
    const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true, putOnlyUsedFonts: true });
    pdf.addFileToVFS("NotoSans-Regular.ttf", font);
    pdf.addFont("NotoSans-Regular.ttf", "NotoSans", "normal");
    pdf.setFont("NotoSans", "normal");
    pdf.setProperties({
      title: "Hợp đồng mua bán căn hộ " + (data.unit?.code || ""),
      author: "Meraki Land Developer",
      subject: "HĐMB Bất Động Sản Chính Thức"
    });

    const width = pdf.internal.pageSize.getWidth();
    const height = pdf.internal.pageSize.getHeight();
    const left = 20;
    const right = width - 20;
    const contentWidth = right - left;
    const limit = height - 24;
    let y = 20;

    function ensureRoom(mm) {
      if (y + mm <= limit) return;
      pdf.addPage();
      y = 20;
      drawPageHeader(false);
    }

    function drawPageHeader(first) {
      if (first) return;
      pdf.setFontSize(8.5);
      pdf.setTextColor("#536b72");
      pdf.text("HỢP ĐỒNG MUA BÁN CĂN HỘ · " + (data.unit?.code || "") + " · DỰ ÁN " + (data.project?.short || "MERAKI"), left, 14);
      pdf.text("Số: " + (data.contractNumber || "HĐMB-2026/MRK"), right, 14, { align: "right" });
      pdf.setDrawColor("#e0e6e8");
      pdf.line(left, 16, right, 16);
      y = 22;
    }

    /* ================= TRANG 1 ================= */
    // Quốc hiệu, Tiêu ngữ
    pdf.setFontSize(9.5);
    pdf.setTextColor("#172c33");
    pdf.text("CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM", width / 2, y, { align: "center" });
    pdf.text("Độc lập - Tự do - Hạnh phúc", width / 2, y + 5, { align: "center" });
    pdf.setDrawColor("#172c33");
    pdf.line(width / 2 - 25, y + 7, width / 2 + 25, y + 7);
    y += 16;

    // Tiêu đề HĐMB
    pdf.setFontSize(15);
    pdf.setTextColor("#156757");
    pdf.text("HỢP ĐỒNG MUA BÁN CĂN HỘ CHUNG CƯ", width / 2, y, { align: "center" });
    y += 6;
    pdf.setFontSize(9.5);
    pdf.setTextColor("#536b72");
    pdf.text("Số: " + (data.contractNumber || "HĐMB-" + (data.unit?.code || "CĂN") + "/MERAKI/2026"), width / 2, y, { align: "center" });
    y += 5;
    pdf.text("Dự án: " + (data.project?.name || "Khu Căn Hộ Nghỉ Dưỡng Meraki Residences"), width / 2, y, { align: "center" });
    y += 9;

    pdf.setFontSize(9);
    pdf.setTextColor("#334d54");
    const introText = "Hôm nay, ngày " + (data.signedDay || "20") + " tháng " + (data.signedMonth || "11") + " năm " + (data.signedYear || "2026") + ", tại Văn phòng Giao dịch Chủ đầu tư, chúng tôi gồm có các bên:";
    pdf.text(pdf.splitTextToSize(introText, contentWidth), left, y);
    y += 8;

    // BÊN BÁN (BÊN A)
    pdf.setFontSize(10.5);
    pdf.setTextColor("#156757");
    pdf.text("BÊN BÁN (Sau đây gọi là 'Bên A'):", left, y);
    y += 5.5;
    pdf.setFontSize(9);
    pdf.setTextColor("#172c33");
    const partyA = [
      ["Tên tổ chức:", "CÔNG TY CỔ PHẦN PHÁT TRIỂN BẤT ĐỘNG SẢN MERAKI LAND"],
      ["Mã số thuế:", "0316899888 do Sở KH&ĐT TP.HCM cấp"],
      ["Địa chỉ:", "Tầng 18, Tòa nhà Landmark, 720A Điện Biên Phủ, Phường 22, Bình Thạnh, TP.HCM"],
      ["Đại diện:", "Ông PHẠM NGUYỄN MINH THỨC  —  Chức vụ: Tổng Giám Đốc"]
    ];
    partyA.forEach(([label, val]) => {
      pdf.setTextColor("#536b72");
      pdf.text(label, left + 4, y);
      pdf.setTextColor("#172c33");
      pdf.text(val, left + 32, y);
      y += 4.5;
    });
    y += 4;

    // BÊN MUA (BÊN B)
    pdf.setFontSize(10.5);
    pdf.setTextColor("#156757");
    pdf.text("BÊN MUA (Sau đây gọi là 'Bên B'):", left, y);
    y += 5.5;
    const buyer = data.buyer || {};
    const partyB = [
      ["Ông/Bà:", (buyer.name || "NGUYỄN VĂN AN").toUpperCase()],
      ["Số CCCD/Hộ chiếu:", buyer.id || "079095001234"],
      ["Ngày cấp / Nơi cấp:", (buyer.idDate || "15/04/2021") + " · Cục CS QLHC về TTXH"],
      ["Địa chỉ thường trú:", buyer.address || "124/8 Võ Thị Sáu, Phường Võ Thị Sáu, Quận 3, TP.HCM"],
      ["Số điện thoại / Email:", (buyer.phone || "0912 345 678") + "  ·  " + (buyer.email || "khachhang@example.com")]
    ];
    partyB.forEach(([label, val]) => {
      pdf.setTextColor("#536b72");
      pdf.text(label, left + 4, y);
      pdf.setTextColor("#172c33");
      pdf.text(val, left + 38, y);
      y += 4.5;
    });
    y += 6;

    // ĐIỀU 1
    ensureRoom(40);
    pdf.setFontSize(10.5);
    pdf.setTextColor("#156757");
    pdf.text("ĐIỀU 1: ĐẶC ĐIỂM CĂN HỘ MUA BÁN", left, y);
    y += 5.5;
    pdf.setFontSize(9);
    pdf.setTextColor("#172c33");
    const u = data.unit || {};
    const unitRows = [
      ["Mã căn hộ:", u.code || "ORCH-2001"],
      ["Tòa tháp / Vị trí tầng:", (data.tower?.name || "Tháp Orchard") + " · Tầng " + (u.floor || "20")],
      ["Loại căn hộ:", u.type || "3 Phòng ngủ (Góc Panorama)"],
      ["Diện tích thông thủy:", (u.area || 85.5) + " m² (Diện tích sử dụng thực tế)"],
      ["Diện tích sàn tim tường:", ((u.area || 85.5) * 1.085).toFixed(2) + " m² (Căn cứ tính phí xây dựng)"],
      ["Mục đích sử dụng:", "Căn hộ để ở lâu dài, ổn định"]
    ];
    unitRows.forEach(([l, v]) => {
      pdf.setTextColor("#536b72");
      pdf.text(l, left + 4, y);
      pdf.setTextColor("#172c33");
      pdf.text(v, left + 45, y);
      y += 4.5;
    });
    y += 6;

    // ĐIỀU 2
    ensureRoom(50);
    pdf.setFontSize(10.5);
    pdf.setTextColor("#156757");
    pdf.text("ĐIỀU 2: GIÁ BÁN CĂN HỘ & KINH PHÍ BẢO TRÌ", left, y);
    y += 5.5;
    pdf.setFontSize(9);
    const p = data.pricing || {};
    const basePrice = p.base || 4000000000;
    const vat = p.vat || Math.round(basePrice * 0.1);
    const pbt = p.pbt || Math.round(basePrice * 0.02);
    const total = p.total || (basePrice + vat + pbt);

    const priceRows = [
      ["1. Giá bán căn hộ (chưa VAT):", formatMoney(basePrice)],
      ["2. Thuế GTGT (10% VAT):", formatMoney(vat)],
      ["3. Kinh phí bảo trì phần sở hữu chung (2% PBT):", formatMoney(pbt)],
      ["4. Tổng giá trị hợp đồng (Đã gồm VAT & 2% PBT):", formatMoney(total)]
    ];
    priceRows.forEach(([l, v], idx) => {
      pdf.setTextColor(idx === 3 ? "#156757" : "#536b72");
      pdf.text(l, left + 4, y);
      pdf.setTextColor(idx === 3 ? "#156757" : "#172c33");
      pdf.text(v, right, y, { align: "right" });
      y += 4.5;
    });
    y += 1;
    pdf.setFontSize(9);
    pdf.setTextColor("#172c33");
    const wordsText = "Bằng chữ: " + numberToWordsVN(total);
    pdf.text(pdf.splitTextToSize(wordsText, contentWidth - 8), left + 4, y);
    y += 8;

    // ĐIỀU 3: PHỤ LỤC LỊCH THANH TOÁN
    ensureRoom(65);
    pdf.setFontSize(10.5);
    pdf.setTextColor("#156757");
    pdf.text("ĐIỀU 3: TIẾN ĐỘ & LỊCH THANH TOÁN (PHỤ LỤC SỐ 01)", left, y);
    y += 5;
    pdf.setFontSize(8.5);
    pdf.setTextColor("#536b72");
    pdf.text("Phương thức áp dụng: " + (data.planTitle || "Tiến độ chuẩn theo mốc xây dựng công trình"), left + 4, y);
    y += 5;

    // Bảng tiến độ
    const schedule = data.schedule || [
      { k: "Đợt 1 (Ký HĐMB)", p: 0.20, amt: Math.round(total * 0.20), date: "30/11/2026", note: "Bao gồm khoản ký quỹ đã đóng" },
      { k: "Đợt 2", p: 0.10, amt: Math.round(total * 0.10), date: "15/01/2027", note: "Hoàn thành sàn tầng 5" },
      { k: "Đợt 3", p: 0.10, amt: Math.round(total * 0.10), date: "30/03/2027", note: "Hoàn thành sàn tầng 10" },
      { k: "Đợt 4 (Cất nóc)", p: 0.15, amt: Math.round(total * 0.15), date: "30/06/2027", note: "Cất nóc toàn bộ tòa tháp" },
      { k: "Đợt 5", p: 0.15, amt: Math.round(total * 0.15), date: "30/09/2027", note: "Hoàn thiện mặt ngoài" },
      { k: "Đợt 6 (Nhận nhà)", p: 0.25, amt: Math.round(total * 0.25), date: "15/12/2027", note: "Bàn giao nhà + 2% PBT" },
      { k: "Đợt 7 (Sổ hồng)", p: 0.05, amt: Math.round(total * 0.05), date: "30/03/2028", note: "Bàn giao Giấy chứng nhận quyền sở hữu" }
    ];

    // Vẽ Header Table
    pdf.setFillColor("#f1f6f6");
    pdf.rect(left, y, contentWidth, 6, "F");
    pdf.setFontSize(8);
    pdf.setTextColor("#156757");
    pdf.text("ĐỢT", left + 3, y + 4);
    pdf.text("TỶ LỆ", left + 32, y + 4);
    pdf.text("SỐ TIỀN (VNĐ)", left + 52, y + 4);
    pdf.text("HẠN NỘP", left + 88, y + 4);
    pdf.text("NỘI DUNG MỐC THI CÔNG", left + 115, y + 4);
    y += 6.5;

    schedule.forEach((row, idx) => {
      ensureRoom(6);
      if (idx % 2 === 1) {
        pdf.setFillColor("#fafcfc");
        pdf.rect(left, y - 0.5, contentWidth, 5.5, "F");
      }
      pdf.setFontSize(8);
      pdf.setTextColor("#172c33");
      pdf.text(row.k || ("Đợt " + (idx + 1)), left + 3, y + 3.5);
      pdf.text(Math.round((row.p || 0.1) * 100) + "%", left + 32, y + 3.5);
      pdf.text(formatMoney(row.amt || 0), left + 52, y + 3.5);
      pdf.text(row.date || "Theo tiến độ", left + 88, y + 3.5);
      pdf.setTextColor("#536b72");
      pdf.text(pdf.splitTextToSize(row.note || "Theo thông báo CĐT", contentWidth - 116), left + 115, y + 3.5);
      pdf.setDrawColor("#edf0f0");
      pdf.line(left, y + 5.5, right, y + 5.5);
      y += 5.5;
    });
    y += 8;

    // ĐIỀU 4 & CAM KẾT
    ensureRoom(45);
    pdf.setFontSize(10.5);
    pdf.setTextColor("#156757");
    pdf.text("ĐIỀU 4: CAM KẾT PHÁP LÝ & KÝ KẾT HỢP ĐỒNG", left, y);
    y += 5;
    pdf.setFontSize(8.5);
    pdf.setTextColor("#334d54");
    const terms = [
      "1. Hai bên cam kết thực hiện đúng các điều khoản đã thỏa thuận trong hợp đồng và phụ lục đính kèm.",
      "2. Hợp đồng này được lập thành 04 (bốn) bản gốc có giá trị pháp lý như nhau: Bên A giữ 02 bản, Bên B giữ 01 bản, 01 bản lưu cơ quan nhà nước có thẩm quyền."
    ];
    terms.forEach((t) => {
      pdf.text(pdf.splitTextToSize(t, contentWidth), left + 4, y);
      y += 5;
    });
    y += 6;

    // CHỮ KÝ HAI BÊN
    ensureRoom(35);
    pdf.setFontSize(9.5);
    pdf.setTextColor("#172c33");
    pdf.text("ĐẠI DIỆN BÊN BÁN (BÊN A)", left + 35, y, { align: "center" });
    pdf.text("ĐẠI DIỆN BÊN MUA (BÊN B)", right - 35, y, { align: "center" });
    pdf.setFontSize(8);
    pdf.setTextColor("#728a90");
    pdf.text("(Ký tên, đóng dấu mộc tròn đỏ)", left + 35, y + 4.5, { align: "center" });
    pdf.text("(Ký và ghi rõ họ tên)", right - 35, y + 4.5, { align: "center" });

    pdf.setDrawColor("#c6d4d5");
    pdf.line(left + 8, y + 25, left + 62, y + 25);
    pdf.line(right - 62, y + 25, right - 8, y + 25);

    pdf.setFontSize(8.5);
    pdf.setTextColor("#172c33");
    pdf.text("PHẠM NGUYỄN MINH THỨC", left + 35, y + 29, { align: "center" });
    pdf.text((buyer.name || "NGUYỄN VĂN AN").toUpperCase(), right - 35, y + 29, { align: "center" });

    // Đánh số trang & footer
    const totalPages = pdf.getNumberOfPages();
    for (let page = 1; page <= totalPages; page++) {
      pdf.setPage(page);
      pdf.setDrawColor("#dce5e5");
      pdf.line(left, height - 15, right, height - 15);
      pdf.setTextColor("#536b72");
      pdf.setFontSize(8);
      pdf.text("Văn bản Hợp Đồng Mua Bán BĐS chính thức · Bản điện tử Meraki Land CRM", left, height - 10);
      pdf.text("Trang " + page + " / " + totalPages, right, height - 10, { align: "right" });
    }

    return pdf.output("blob");
  }

  return { create, numberToWordsVN };
})();

if (typeof window !== "undefined") window.HdmbPDF = HdmbPDF;
if (typeof module !== "undefined") module.exports = HdmbPDF;
