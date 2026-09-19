export type ExampleLocale = "ko" | "en";

interface Translation {
  ko: string;
  en: string;
}

interface ExampleTranslation {
  elements: Record<string, Translation>;
  inputs: Record<string, string>;
}

const t = (ko: string, en: string): Translation => ({ ko, en });

const EXAMPLES: Record<string, ExampleTranslation> = {
  CreditReview: {
    elements: {
      CreditReview: t("신용 심사 (템플릿)", "Credit review (template)"),
      Lane_Applicant: t("신청인", "Applicant"),
      Lane_Officer: t("심사역", "Loan officer"),
      Lane_Committee: t("심사위원회", "Credit committee"),
      Lane_Disburser: t("지급 담당", "Disbursement officer"),
      Start: t("시작", "Start"),
      Task_Apply: t("대출 신청", "Apply for loan"),
      Task_Score: t("신용 평가", "Assess credit"),
      Timer_Review: t("심사 기한", "Review deadline"),
      Gateway_Score: t("점수 통과?", "Score passed?"),
      Gateway_Amount: t("고액인가?", "High value?"),
      Task_Approve: t("위원회 승인", "Committee approval"),
      Gateway_Approved: t("승인?", "Approved?"),
      Gateway_Join: t("합류", "Merge"),
      Task_Disburse: t("약정·지급", "Sign and disburse"),
      End_Done: t("실행", "Disbursed"),
      End_Rejected: t("거절", "Rejected"),
      End_Delayed: t("심사 지연", "Review delayed"),
      Flow_4: t("예", "Yes"), Flow_5: t("아니오", "No"), Flow_6: t("예", "Yes"),
      Flow_7: t("아니오", "No"), Flow_9: t("예", "Yes"), Flow_10: t("아니오", "No"),
    },
    inputs: {
      "신청 금액": "Requested amount",
      "증빙 서류": "Supporting documents",
      "심사 기한(초)": "Review deadline (seconds)",
      "신용 점수 (0~100)": "Credit score (0–100)",
      "승인 여부": "Approval decision",
      약정서: "Agreement document",
    },
  },
  ExpenseApproval: {
    elements: {
      ExpenseApproval: t("경비 승인", "Expense approval"),
      Lane_Requester: t("신청자", "Requester"), Lane_Manager: t("팀장", "Manager"), Lane_Finance: t("재무", "Finance"),
      StartEvent_1: t("시작", "Start"), Task_Submit: t("경비 신청", "Submit expense"),
      Gateway_Amount: t("고액인가?", "High value?"), Task_Approve: t("승인", "Approve"),
      Gateway_Join: t("합류", "Merge"), Gateway_Fork: t("동시 진행", "Run in parallel"),
      Task_Pay: t("지급", "Pay"), Task_Receipt: t("영수증 제출", "Submit receipt"),
      Gateway_Sync: t("모두 끝나면", "Wait for all"), EndEvent_Done: t("완료", "Completed"),
      Gateway_Approved: t("승인됐나?", "Approved?"), EndEvent_Rejected: t("반려", "Rejected"),
      Flow_3: t("예", "Yes"), Flow_4: t("아니오", "No"), Flow_11: t("예", "Yes"), Flow_12: t("아니오", "No"),
    },
    inputs: { 금액: "Amount", "승인 여부": "Approval decision", "영수증 파일": "Receipt file" },
  },
  FxTransfer: {
    elements: {
      FxTransfer: t("해외 송금", "International transfer"), Lane_Requester: t("요청자", "Requester"), Lane_Finance: t("재무", "Finance"),
      Start: t("시작", "Start"), Task_Request: t("송금 요청", "Request transfer"), Service_Rate: t("환율 조회", "Fetch exchange rate"),
      Gateway_Rate: t("환율 정상?", "Valid rate?"), Task_Send: t("송금 실행", "Send transfer"),
      End_Done: t("완료", "Completed"), End_Error: t("환율 오류", "Rate error"), Flow_4: t("예", "Yes"), Flow_5: t("아니오", "No"),
    },
    inputs: { "금액 (USD)": "Amount (USD)", "환율 (KRW/USD)": "Rate (KRW/USD)", "송금 증빙": "Transfer receipt" },
  },
  InvoicePayment: {
    elements: {
      InvoicePayment: t("청구 결제", "Invoice payment"), Lane_Vendor: t("공급사", "Vendor"), Lane_Buyer: t("구매자", "Buyer"),
      Start: t("시작", "Start"), Task_Invoice: t("청구", "Submit invoice"), Task_Review: t("검토", "Review invoice"),
      Gateway_Accepted: t("승인?", "Approved?"), Task_Pay: t("결제", "Pay invoice"), End_Paid: t("결제됨", "Paid"),
      End_Rejected: t("거절", "Rejected"), Flow_4: t("예", "Yes"), Flow_5: t("아니오", "No"),
    },
    inputs: { 청구서: "Invoice", 금액: "Amount", "승인 여부": "Approval decision" },
  },
  LeaveRequest: {
    elements: {
      LeaveRequest: t("휴가 신청", "Leave request"), Lane_Employee: t("직원", "Employee"), Lane_Manager: t("팀장", "Manager"),
      Start: t("시작", "Start"), Task_Request: t("휴가 신청", "Request leave"), Task_Approve: t("승인", "Approve"),
      Timer_Reply: t("기한 경과", "Reply deadline"), Gateway_Approved: t("승인?", "Approved?"),
      End_Approved: t("승인됨", "Approved"), End_Rejected: t("거절", "Rejected"), End_Expired: t("기한 만료", "Expired"),
      Flow_4: t("예", "Yes"), Flow_5: t("아니오", "No"),
    },
    inputs: { 일수: "Days", "답변 기한(초)": "Reply deadline (seconds)", "승인 여부": "Approval decision" },
  },
  PaperReview: {
    elements: {
      PaperReview: t("논문 심사", "Paper review"), Lane_Author: t("저자", "Author"),
      Lane_ReviewerA: t("심사자 A", "Reviewer A"), Lane_ReviewerB: t("심사자 B", "Reviewer B"), Lane_Editor: t("편집자", "Editor"),
      Start: t("시작", "Start"), Task_Submit: t("논문 투고", "Submit paper"), Gateway_Fork: t("동시 심사", "Parallel review"),
      Task_ReviewA: t("심사 A", "Review A"), Task_ReviewB: t("심사 B", "Review B"), Gateway_Sync: t("심사 완료", "Reviews complete"),
      Task_Decide: t("게재 결정", "Decide publication"), Gateway_Accepted: t("게재?", "Publish?"),
      End_Accepted: t("게재", "Published"), End_Rejected: t("거절", "Rejected"), Flow_9: t("예", "Yes"), Flow_10: t("아니오", "No"),
    },
    inputs: { "논문 파일": "Manuscript file", 점수: "Score", "게재 여부": "Publication decision" },
  },
  PurchaseOrder: {
    elements: {
      PurchaseOrder: t("구매 승인", "Purchase approval"), Lane_Requester: t("요청자", "Requester"), Lane_Manager: t("팀장", "Manager"),
      Lane_Buyer: t("구매 담당", "Buyer"), Lane_Supplier: t("공급사", "Supplier"), Start: t("시작", "Start"),
      Task_Request: t("구매 요청", "Request purchase"), Gateway_Price: t("고액인가?", "High value?"), Task_Approve: t("승인", "Approve"),
      Gateway_Approved: t("승인됐나?", "Approved?"), Gateway_Join: t("합류", "Merge"), Task_Order: t("발주", "Place order"),
      Task_Deliver: t("납품 확인", "Confirm delivery"), End_Done: t("완료", "Completed"), End_Rejected: t("반려", "Rejected"),
      Flow_3: t("예", "Yes"), Flow_4: t("아니오", "No"), Flow_6: t("예", "Yes"), Flow_7: t("아니오", "No"),
    },
    inputs: { 품목: "Item", 금액: "Amount", "승인 여부": "Approval decision", 납품서: "Delivery note" },
  },
  SupplyChain: {
    elements: {
      SupplyChain: t("공급망 납품", "Supply-chain delivery"), Lane_Supplier: t("공급사", "Supplier"), Lane_Carrier: t("운송사", "Carrier"),
      Lane_Buyer: t("구매자", "Buyer"), Lane_Finance: t("재무", "Finance"), Start: t("시작", "Start"),
      Task_Ship: t("출하", "Ship goods"), Task_Deliver: t("운송 완료", "Complete delivery"), Task_Inspect: t("검수", "Inspect delivery"),
      Gateway_Ok: t("검수 통과?", "Inspection passed?"), Task_Pay: t("대금 지급", "Pay supplier"), Task_Claim: t("이의 제기", "Raise claim"),
      End_Settled: t("정산", "Settled"), End_Disputed: t("분쟁", "Disputed"), Flow_5: t("예", "Yes"), Flow_6: t("아니오", "No"),
    },
    inputs: {
      "출하 명세": "Shipment details", 수량: "Quantity", 운송장: "Tracking document", "합격 여부": "Accepted",
      "수령 수량": "Received quantity", "지급 증빙": "Payment receipt", "이의 내용": "Claim details",
    },
  },
  TravelBooking: {
    elements: {
      TravelBooking: t("여행 예약", "Travel booking"), Lane_Traveler: t("여행자", "Traveler"), Lane_Approver: t("승인자", "Approver"),
      Lane_Agent: t("예약 담당", "Booking agent"), Start: t("시작", "Start"), Task_Request: t("출장 요청", "Request travel"),
      Gateway_Budget: t("예산 초과?", "Over budget?"), Task_Approve: t("예산 승인", "Approve budget"), Gateway_Approved: t("승인?", "Approved?"),
      Gateway_Join: t("합류", "Merge"), Gateway_Fork: t("동시 예약", "Book in parallel"), Task_Flight: t("항공 예약", "Book flight"),
      Task_Hotel: t("호텔 예약", "Book hotel"), Gateway_Sync: t("예약 완료", "Bookings complete"), Task_Confirm: t("일정 확인", "Confirm itinerary"),
      Gateway_Confirmed: t("확정?", "Confirmed?"), End_Booked: t("확정", "Confirmed"), End_Cancelled: t("취소", "Cancelled"), End_Rejected: t("반려", "Rejected"),
      Flow_3: t("예", "Yes"), Flow_4: t("아니오", "No"), Flow_6: t("예", "Yes"), Flow_7: t("아니오", "No"),
      Flow_14: t("예", "Yes"), Flow_15: t("아니오", "No"),
    },
    inputs: {
      "목적지·일정": "Destination and itinerary", 예산: "Budget", "승인 여부": "Approval decision",
      항공권: "Flight booking", "숙박 확인서": "Hotel confirmation", "확정 여부": "Confirmation decision",
    },
  },
};

function processId(xml: string): string | undefined {
  return /<bpmn:process\b[^>]*\bid="([^"]+)"/.exec(xml)?.[1];
}

/** Localizes human-facing names while preserving IDs, expressions, roles, and executable semantics. */
export function localizeExampleBpmn(xml: string, locale: ExampleLocale): string {
  const id = processId(xml);
  const translation = id ? EXAMPLES[id] : undefined;
  if (!translation) return xml;

  let localized = xml.replace(/(<bpmn:[^>]+\bid="([^"]+)"[^>]*\bname=")([^"]*)(")/g, (match, before: string, elementId: string, current: string, after: string) => {
    const names = translation.elements[elementId];
    if (!names || (current !== names.ko && current !== names.en)) return match;
    return `${before}${names[locale]}${after}`;
  });

  const processName = translation.elements[id!];
  localized = localized.replace(/(<bpmn:participant\b[^>]*\bname=")([^"]*)(")/g, (match, before: string, current: string, after: string) => {
    if (!processName || (current !== processName.ko && current !== processName.en)) return match;
    return `${before}${processName[locale]}${after}`;
  });

  const reverseInputs = Object.fromEntries(Object.entries(translation.inputs).map(([ko, en]) => [en, ko]));
  localized = localized.replace(/(<bc:input\b[^>]*\blabel=")([^"]*)(")/g, (match, before: string, current: string, after: string) => {
    const target = locale === "en" ? translation.inputs[current] : reverseInputs[current];
    return target ? `${before}${target}${after}` : match;
  });
  return localized;
}
