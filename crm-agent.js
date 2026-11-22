(function (root) {
  "use strict";

  const normalize = (text) => text.toLowerCase().normalize("NFD")
    .replace(/\p{M}/gu, "").replace(/đ/g, "d");

  const unit = { type: "string", pattern: "^[a-z]+:[A-Z0-9]+:\\d{4}$", description: "CRM unit ID. Resolve it with find_units." };
  const project = { type: "string", enum: ["orchard", "global"] };
  const tool = (name, description, properties, required = []) => ({
    name, description, parameters: { type: "object", properties, required, additionalProperties: false }
  });
  const tools = [
    tool("find_units", "Find unit IDs by four-digit apartment code, project and tower.", {
      code: { type: "string", pattern: "^\\d{4}$" }, project, tower: { type: "string", pattern: "^[A-Z0-9]+$" }
    }, ["code"]),
    tool("overdue_payments", "List or count overdue payments. Use for lookup only, never when the user asks to write a message.", { uid: unit, project }),
    tool("deal_progress", "Read the current deal stage and the next step.", { uid: unit }, ["uid"]),
    tool("compare_quotes", "Compare Senique plan totals, optionally for a CRM unit.", { uid: unit }),
    tool("preview_reminder", "Write a draft reminder about the oldest overdue installment. Does not send it.", { uid: unit }, ["uid"]),
    tool("inspect_customer", "Check required customer fields and duplicate risks without returning personal identifiers.", { uid: unit }, ["uid"]),
    tool("inspect_quote", "Review the selected quotation and schedule readiness.", { uid: unit }, ["uid"]),
    tool("inspect_contract", "Inspect signing date, escrow details and contract readiness.", { uid: unit }, ["uid"]),
    tool("review_deal", "Run the full deal review with customer, pricing, contract and collections agents.", { uid: unit }, ["uid"])
  ];

  const profiles = {
    coordinator: { label: "Điều phối", job: "Điều phối rà soát hồ sơ và bàn giao việc", tools: tools.map((entry) => entry.name) },
    customer: { label: "Khách hàng", job: "Kiểm tra hồ sơ thiếu và trùng", tools: ["find_units", "inspect_customer"] },
    pricing: { label: "Báo giá", job: "Kiểm tra chiết khấu, giá và lịch thu dự kiến", tools: ["find_units", "inspect_quote", "compare_quotes"] },
    contracts: { label: "Hợp đồng", job: "Kiểm tra ký quỹ và bước hợp đồng", tools: ["find_units", "inspect_contract", "deal_progress"] },
    collections: { label: "Công nợ", job: "Kiểm tra khoản thu và soạn nhắc", tools: ["find_units", "overdue_payments", "preview_reminder"] }
  };

  // Agents can call the read/preview tools. The review UI owns approval and write actions.
  function createCrmAgent(actions) {
    const read = {
      find_units: actions.findUnits,
      overdue_payments: actions.overduePayments,
      deal_progress: actions.dealProgress,
      compare_quotes: actions.compareQuotes,
      preview_reminder: actions.previewReminder,
      inspect_customer: actions.inspectCustomer,
      inspect_quote: actions.inspectQuote,
      inspect_contract: actions.inspectContract,
      review_deal: reviewDeal
    };

    function call(action, args = {}, profile = "coordinator") {
      if (!Object.hasOwn(profiles, profile) || !profiles[profile].tools.includes(action)) {
        throw new Error("Công cụ nằm ngoài phạm vi Agent này.");
      }
      const { properties, required } = tools.find((entry) => entry.name === action).parameters;
      const valid = (key, value) => {
        const rule = properties[key];
        return rule && typeof value === rule.type && (!rule.enum || rule.enum.includes(value)) &&
          (!rule.pattern || new RegExp(rule.pattern).test(value));
      };
      if (!args || typeof args !== "object" || Array.isArray(args) ||
          required.some((key) => !Object.hasOwn(args, key)) ||
          Object.entries(args).some(([key, value]) => !valid(key, value))) throw new Error("Tham số công cụ CRM không hợp lệ.");
      return read[action](args);
    }

    function reviewDeal({ uid }) {
      const customer = call("inspect_customer", { uid }, "customer");
      const pricing = call("inspect_quote", { uid }, "pricing");
      const contracts = call("inspect_contract", { uid }, "contracts");
      const collections = call("overdue_payments", { uid }, "collections");
      return { text: "Kết quả rà soát giao dịch", review: [
        { agent: profiles.customer.label, ...customer },
        { agent: profiles.pricing.label, ...pricing },
        { agent: profiles.contracts.label, ...contracts },
        { agent: profiles.collections.label, ...collections }
      ] };
    }

    function interpret(prompt, previousUnit, pinnedUnit, profile = "coordinator") {
      const text = normalize(prompt);
      const code = text.match(/\b\d{4}\b/)?.[0];
      const action = /ra soat.*(toan bo|giao dich)|kiem tra toan bo/.test(text) ? "review_deal" :
        profile === "customer" ? "inspect_customer" :
        /nhac|viet.*tin nhan|soan.*(thu|thanh toan)/.test(text) ? "preview_reminder" :
        /so sanh|30\s*[/–-]\s*70|bao gia|chiet khau/.test(text) ? "compare_quotes" :
        /qua han|tre han|cong no|can thu|khoan thu/.test(text) ? "overdue_payments" :
        profile === "pricing" ? "inspect_quote" : profile === "contracts" ? "inspect_contract" :
        profile === "collections" ? "overdue_payments" :
        /thieu|kiem tra|ho so|buoc tiep|giao dich/.test(text) ? "deal_progress" : "";
      if (!action) return { text: "Bạn có thể hỏi về khoản quá hạn, kiểm tra hồ sơ, so sánh báo giá hoặc soạn nhắc thu." };
      if (!profiles[profile].tools.includes(action)) return { text: "Chọn Agent Điều phối để chuyển yêu cầu này đến đúng chuyên môn." };
      const projectId = /orchard/.test(text) ? "orchard" : /global/.test(text) ? "global" : "";
      const projectScope = projectId ? { project: projectId } : {};
      const towerCode = text.match(/\btoa\s+([a-z][a-z0-9]*)\b/)?.[1].toUpperCase();
      const units = code ? call("find_units", { code, ...projectScope, ...(towerCode ? { tower: towerCode } : {}) }) : [];
      if (code && units.length !== 1) {
        return units.length ? { text: "Có nhiều căn cùng mã. Chọn đúng dự án và tòa để tiếp tục.", choices: units, action } :
          { text: "Không tìm thấy căn " + code + " trong phạm vi đang xem." };
      }
      const activeUnit = pinnedUnit || previousUnit;
      const contextUnit = !projectId || activeUnit?.startsWith(projectId + ":") ? activeUnit : "";
      const uid = units[0]?.uid || (action === "compare_quotes" && /mau senique/.test(text) ? "" : contextUnit);
      if (action === "overdue_payments") {
        const scopedUid = code ? uid : !projectId ? pinnedUnit : "";
        return call(action, scopedUid ? { uid: scopedUid, ...projectScope } : projectScope, profile);
      }
      if (!uid && action !== "compare_quotes") return { text: "Thêm mã căn vào yêu cầu, ví dụ “Soạn nhắc thu căn 0802”." };
      return call(action, uid ? { uid } : {}, profile);
    }

    async function runWithModel(prompt, activeUnit, request, profile = "coordinator") {
      const requestedCode = prompt.match(/\b\d{4}\b/)?.[0];
      const messages = [{
        role: "system",
        content: "Your role in Meraki Land CRM: " + profiles[profile].job + ". Use tools for all CRM data. Do not invent numbers or identifiers and do not claim to send anything. " +
          "For a new four-digit apartment code, call find_units first, supplying the project and tower from the request if given. " +
          "Then call exactly one CRM tool using the returned uid. If no apartment is named, reuse the pinned/current uid if applicable. " +
          "If the user wants a written message (viết, soạn, tin nhắn, nhắc khách), choose preview_reminder after resolving the unit. Do not choose overdue_payments for this. " +
          "A portfolio-wide overdue question should use overdue_payments without uid. A request for the Senique example should use compare_quotes without uid. " +
          "For a whole-deal review (rà soát toàn bộ giao dịch), choose review_deal after resolving the unit if needed. " +
          "If you need clarification, reply briefly in Vietnamese. No markdown. /no_think\n" +
          (activeUnit ? "Current unit: " + activeUnit : "No current unit.")
      }, { role: "user", content: prompt }];
      let resolvedUid = "";
      for (let turn = 0; turn < 3; turn++) {
        const reply = await request(messages, profile);
        const entry = reply?.tool_calls?.[0];
        if (!entry) throw new Error("Mô hình chưa chọn công cụ CRM.");
        const { name, arguments: args } = entry.function;
        const scope = typeof args === "string" ? JSON.parse(args) : args;
        if (name !== "find_units" && requestedCode && (!resolvedUid || scope?.uid !== resolvedUid)) {
          throw new Error("Mô hình chưa xác định đúng căn.");
        }
        const result = call(name, scope, profile);
        if (name !== "find_units") return result;
        if (!result.length) return { text: "Không tìm thấy căn trong phạm vi được hỏi." };
        if (result.length > 1) return interpret(prompt, activeUnit, undefined, profile);
        resolvedUid = result[0].uid;
        messages.push({ role: "assistant", content: reply.content || null, tool_calls: [entry] },
          { role: "tool", tool_call_id: entry.id, content: JSON.stringify(result) });
      }
      throw new Error("Mô hình chưa xác định được thao tác CRM.");
    }

    return Object.freeze({ call, interpret, runWithModel,
      listProfiles: () => Object.entries(profiles).map(([id, { label, job }]) => ({ id, label, job })),
      listTools: (profile = "coordinator") => structuredClone(tools.filter((entry) => profiles[profile]?.tools.includes(entry.name)))
    });
  }

  root.createCrmAgent = createCrmAgent;
})(globalThis);
