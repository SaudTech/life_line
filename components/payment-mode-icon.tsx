import { Banknote, CreditCard, MoreHorizontal, Smartphone } from "lucide-react";
import type { PaymentModeValue } from "@/lib/consultations/schema";

// One place for the payment-mode glyph shown on both the consultation and
// procedure counters, so cash/card/UPI/other always look the same wherever a
// payment mode is picked (mirrors PAYMENT_MODES being the one source of truth
// for the values themselves).
export function PaymentModeIcon({
  mode,
  className,
}: {
  mode: PaymentModeValue;
  className?: string;
}) {
  switch (mode) {
    case "cash":
      return <Banknote className={className} aria-hidden />;
    case "card":
      return <CreditCard className={className} aria-hidden />;
    case "upi":
      return <Smartphone className={className} aria-hidden />;
    case "other":
      return <MoreHorizontal className={className} aria-hidden />;
  }
}
