"use strict";

const EscrowPDF = (() => {
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

  async function create(data) {
    const [jsPDF, font] = await dependencies();
    const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true, putOnlyUsedFonts: true });
    pdf.addFileToVFS("NotoSans-Regular.ttf", font);
    pdf.addFont("NotoSans-Regular.ttf", "NotoSans", "normal");
    pdf.setFont("NotoSans", "normal");
    pdf.setProperties({ title: "Thỏa thuận ký quỹ " + data.number, author: "Meraki Land" });

    const width = pdf.internal.pageSize.getWidth();
    const height = pdf.internal.pageSize.getHeight();
    const left = 19;
    const right = width - left;
    const valueX = left + 52;
    const limit = height - 26;
    const clean = (value) => String(value || "—").normalize("NFC");
    let y;

    function startPage(first) {
      pdf.setTextColor("#156757");
      pdf.setFontSize(10);
      pdf.text("MERAKI LAND", left, 17);
      pdf.text("BẢN MẪU", right, 17, { align: "right" });
      pdf.setDrawColor("#dce5e5");
      pdf.line(left, 21, right, 21);
      y = 29;
      if (first) {
        pdf.setTextColor("#172c33");
        pdf.setFontSize(21);
        pdf.text("THỎA THUẬN KÝ QUỸ", left, y + 2);
        pdf.setTextColor("#536b72");
        pdf.setFontSize(10);
        pdf.text(pdf.splitTextToSize(clean(data.number + " · " + data.version), right - left), left, y + 10);
        y += 19;
      }
    }

    function ensureRoom(mm) {
      if (y + mm <= limit) return;
      pdf.addPage();
      startPage(false);
    }

    startPage(true);
    for (const section of data.sections) {
      ensureRoom(18);
      pdf.setFontSize(11);
      pdf.setTextColor("#156757");
      pdf.text(section.title, left, y);
      y += 6;
      for (const [label, value] of section.rows) {
        pdf.setFontSize(10);
        const lines = pdf.splitTextToSize(clean(value), right - valueX - 2);
        let offset = 0;
        while (offset < lines.length) {
          ensureRoom(10);
          const capacity = Math.floor((limit - y - 3) / 5);
          const block = lines.slice(offset, offset + capacity);
          pdf.setFontSize(9.5);
          pdf.setTextColor("#536b72");
          if (!offset) pdf.text(clean(label), left, y);
          pdf.setFontSize(10);
          pdf.setTextColor("#172c33");
          block.forEach((line, index) => pdf.text(line, valueX, y + index * 5));
          offset += block.length;
          y += block.length * 5 + 2;
        }
        pdf.setDrawColor("#edf0f0");
        pdf.line(left, y - 3.75, right, y - 3.75);
      }
      y += 6;
    }

    ensureRoom(25);
    pdf.setFontSize(10);
    pdf.setTextColor("#172c33");
    pdf.text("Đại diện bên nhận ký quỹ", left + 42, y + 2, { align: "center" });
    pdf.text("Khách hàng / người đại diện", right - 42, y + 2, { align: "center" });
    pdf.setDrawColor("#c6d4d5");
    pdf.line(left + 7, y + 22, left + 77, y + 22);
    pdf.line(right - 77, y + 22, right - 7, y + 22);

    const total = pdf.getNumberOfPages();
    for (let page = 1; page <= total; page++) {
      pdf.setPage(page);
      pdf.setDrawColor("#dce5e5");
      pdf.line(left, height - 19, right, height - 19);
      pdf.setTextColor("#536b72");
      pdf.setFontSize(8.5);
      pdf.text("Tài liệu minh họa cho prototype CRM Meraki Land", left, height - 13);
      pdf.text(String(page) + " / " + total, right, height - 13, { align: "right" });
    }

    return pdf.output("blob");
  }

  return { create };
})();
