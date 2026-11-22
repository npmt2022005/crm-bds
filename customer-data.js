"use strict";

const CustomerData = (() => {
  const identityLabels = {
    phone: "Số điện thoại", idno: "CCCD / Passport", taxno: "Mã số thuế", email: "Email"
  };
  const workbookHeaders = ["Loại", "Tên trên hồ sơ", "Số điện thoại", "CCCD / MST", "Email", "Ghi chú nội bộ"];

  function normalize(value) {
    return String(value ?? "").trim().toLowerCase().normalize("NFD")
      .replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/\s+/g, " ");
  }

  function identity(record) {
    const phone = String(record.phone || "").replace(/\D/g, "")
      .replace(/^(?:00)?84(?=\d{9}$)/, "0");
    const legal = (value) => normalize(value).replace(/[^a-z0-9]/g, "");
    return {
      phone,
      idno: record.type !== "org" ? legal(record.idno) : "",
      taxno: record.type === "org" ? legal(record.taxno) : "",
      email: String(record.email || "").trim().toLowerCase()
    };
  }

  function duplicateIndex(candidates) {
    const index = new Map();
    const entries = (record) => Object.entries(identity(record)).filter(([, value]) => value);
    function add(candidate) {
      for (const [field, value] of entries(candidate.rec)) {
        const key = field + ":" + value;
        const matches = index.get(key) || [];
        matches.push(candidate);
        index.set(key, matches);
      }
    }
    function find(record, excludeKey, before) {
      const result = new Map();
      const previous = before ? identity(before) : {};
      for (const [field, value] of entries(record)) {
        if (previous[field] === value) continue;
        for (const candidate of index.get(field + ":" + value) || []) {
          if (candidate.name === excludeKey) continue;
          const match = result.get(candidate.name) || { key: candidate.name, name: candidate.disp, fields: [] };
          match.fields.push(field);
          result.set(candidate.name, match);
        }
      }
      return Array.from(result.values());
    }
    candidates.forEach(add);
    return { add, find };
  }

  function describeDuplicates(duplicates) {
    return duplicates.map((match) => match.name + " (" + match.fields.map((field) => identityLabels[field]).join(", ") + ")").join("; ");
  }

  let loadingWorkbook;
  function loadWorkbook() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!loadingWorkbook) {
      loadingWorkbook = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "./vendor/xlsx-0.20.3.full.min.js";
        script.onload = () => window.XLSX ? resolve(window.XLSX) : reject(new Error("Không tải được bộ đọc Excel."));
        script.onerror = () => reject(new Error("Không tải được bộ đọc Excel."));
        document.head.append(script);
      }).catch((error) => {
        loadingWorkbook = null;
        throw error;
      });
    }
    return loadingWorkbook;
  }

  async function downloadWorkbook(rows, filename) {
    const xlsx = await loadWorkbook();
    const sheet = xlsx.utils.aoa_to_sheet(rows);
    sheet["!cols"] = rows[0].map((heading) => ({ wch: Math.max(17, String(heading).length + 4) }));
    const book = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(book, sheet, "Khách hàng");
    xlsx.writeFile(book, filename, { compression: true });
  }

  async function readWorkbook(file) {
    const maxRows = 5000;
    if (!/\.(xlsx|xls)$/i.test(file.name)) throw new Error("Hãy chọn tệp Excel .xlsx hoặc .xls.");
    if (file.size > 10 * 1024 * 1024) throw new Error("Tệp Excel vượt quá 10 MB.");
    const xlsx = await loadWorkbook();
    const book = xlsx.read(await file.arrayBuffer(), { sheets: 0, sheetRows: maxRows + 2, dateNF: "dd/mm/yyyy" });
    const sheet = book.Sheets[book.SheetNames[0]];
    if (!sheet?.["!ref"]) throw new Error("Trang tính đầu tiên chưa có dữ liệu.");
    const range = xlsx.utils.decode_range(sheet["!ref"]);
    const fullRange = xlsx.utils.decode_range(sheet["!fullref"] || sheet["!ref"]);
    if (fullRange.e.r - fullRange.s.r > maxRows || range.e.r - range.s.r > maxRows) {
      throw new Error("Mỗi lần nhập tối đa 5.000 dòng dữ liệu.");
    }
    if (range.e.c - range.s.c > 99) throw new Error("Tệp có quá nhiều cột. Hãy dùng tệp mẫu.");
    return {
      rows: xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "", blankrows: true, dateNF: "dd/mm/yyyy" }),
      firstRow: range.s.r + 1
    };
  }

  return { normalize, duplicateIndex, describeDuplicates, workbookHeaders, downloadWorkbook, readWorkbook };
})();
