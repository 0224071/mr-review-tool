import { GitLabDiffRefs } from '../../types/gitlab';

/** 範例 diff 的假 MR 版本資訊（明顯是假的 sha，只供示範模式預估與模擬行內留言，不會送到 GitLab） */
export const SAMPLE_DIFF_REFS: GitLabDiffRefs = {
  base_sha: 'deadbeef'.repeat(5),
  start_sha: 'deadbeef'.repeat(5),
  head_sha: 'c0ffee00'.repeat(5),
};

export const SAMPLE_GIT_DIFF = `diff --git a/src/api/couponApi.ts b/src/api/couponApi.ts
new file mode 100644
index 0000000..f8a12e4
--- /dev/null
+++ b/src/api/couponApi.ts
@@ -0,0 +1,38 @@
+export interface CouponValidationResponse {
+  code: string;
+  discountType: 'percentage' | 'fixed';
+  discountValue: number;
+  minSpend?: number;
+  expiresAt: string;
+}
+
+export async function validateCouponCode(code: string, cartTotal: number): Promise<CouponValidationResponse> {
+  const response = await fetch('/api/coupons/validate', {
+    method: 'POST',
+    headers: { 'Content-Type': 'application/json' },
+    body: JSON.stringify({ code: code.trim(), cartTotal }),
+  });
+
+  if (!response.ok) {
+    const errorData = await response.json();
+    throw new Error(errorData.message || '無效的折價券代碼');
+  }
+
+  return response.json();
+}
diff --git a/src/hooks/useCouponRedemption.ts b/src/hooks/useCouponRedemption.ts
new file mode 100644
index 0000000..4b8c291
--- /dev/null
+++ b/src/hooks/useCouponRedemption.ts
@@ -0,0 +1,52 @@
+import { useState, useCallback, useEffect } from 'react';
+import { validateCouponCode, CouponValidationResponse } from '../api/couponApi';
+import { calculateFinalTotal } from '../utils/discountCalculator';
+
+export function useCouponRedemption(cartTotal: number) {
+  const [couponCode, setCouponCode] = useState('');
+  const [appliedCoupon, setAppliedCoupon] = useState<CouponValidationResponse | null>(null);
+  const [isLoading, setIsLoading] = useState(false);
+  const [errorMessage, setErrorMessage] = useState<string | null>(null);
+
+  const applyCoupon = useCallback(async (codeToApply: string) => {
+    if (!codeToApply.trim()) {
+      setErrorMessage('請輸入折價券代碼');
+      return;
+    }
+    setIsLoading(true);
+    setErrorMessage(null);
+    try {
+      const coupon = await validateCouponCode(codeToApply, cartTotal);
+      setAppliedCoupon(coupon);
+    } catch (err: any) {
+      setErrorMessage(err.message || '折價券兌換失敗');
+      setAppliedCoupon(null);
+    } finally {
+      setIsLoading(false);
+    }
+  }, [cartTotal]);
+
+  // 自動重算當前折抵後總額
+  const finalAmount = appliedCoupon
+    ? calculateFinalTotal(cartTotal, appliedCoupon.discountType, appliedCoupon.discountValue)
+    : cartTotal;
+
+  return {
+    couponCode,
+    setCouponCode,
+    appliedCoupon,
+    isLoading,
+    errorMessage,
+    applyCoupon,
+    finalAmount,
+  };
+}
diff --git a/src/components/CouponInput.tsx b/src/components/CouponInput.tsx
new file mode 100644
index 0000000..8d27a19
--- /dev/null
+++ b/src/components/CouponInput.tsx
@@ -0,0 +1,48 @@
+import React from 'react';
+
+interface CouponInputProps {
+  code: string;
+  onChange: (value: string) => void;
+  onApply: (code: string) => void;
+  isLoading: boolean;
+  error: string | null;
+}
+
+export const CouponInput: React.FC<CouponInputProps> = ({
+  code,
+  onChange,
+  onApply,
+  isLoading,
+  error,
+}) => {
+  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
+    if (e.key === 'Enter') {
+      onApply(code);
+    }
+  };
+
+  return (
+    <div className="flex flex-col gap-1.5 w-full max-w-sm">
+      <div className="flex items-center gap-2">
+        <input
+          type="text"
+          value={code}
+          placeholder="請輸入優惠代碼"
+          onChange={(e) => onChange(e.target.value)}
+          onKeyDown={handleKeyDown}
+          disabled={isLoading}
+          className="px-3 py-2 border rounded-md text-sm uppercase flex-1 focus:outline-none"
+        />
+        <button
+          onClick={() => onApply(code)}
+          disabled={isLoading || !code.trim()}
+          className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
+        >
+          {isLoading ? '驗證中...' : '套用'}
+        </button>
+      </div>
+      {error && <span className="text-xs text-red-500 font-medium">{error}</span>}
+    </div>
+  );
+};
diff --git a/src/utils/discountCalculator.ts b/src/utils/discountCalculator.ts
index e311a2f..904b771 100644
--- a/src/utils/discountCalculator.ts
+++ b/src/utils/discountCalculator.ts
@@ -1,6 +1,24 @@
-export function calculateTax(amount: number, rate: number = 0.05): number {
-  return amount * rate;
+export function calculateTax(amount: number, taxRate: number = 0.05): number {
+  return Math.round(amount * taxRate);
 }
+
+export function calculateFinalTotal(
+  subtotal: number,
+  discountType: 'percentage' | 'fixed',
+  discountValue: number
+): number {
+  if (subtotal <= 0) return 0;
+  
+  let discount = 0;
+  if (discountType === 'percentage') {
+    discount = (subtotal * discountValue) / 100;
+  } else {
+    discount = discountValue;
+  }
+  
+  const total = subtotal - discount;
+  return total < 0 ? 0 : Math.round(total);
+}
diff --git a/src/tests/discountCalculator.test.ts b/src/tests/discountCalculator.test.ts
new file mode 100644
index 0000000..605c19d
--- /dev/null
+++ b/src/tests/discountCalculator.test.ts
@@ -0,0 +1,32 @@
+import { describe, it, expect } from 'vitest';
+import { calculateFinalTotal } from '../utils/discountCalculator';
+
+describe('discountCalculator', () => {
+  it('正確計算百分比折扣', () => {
+    const result = calculateFinalTotal(1000, 'percentage', 20);
+    expect(result).toBe(800);
+  });
+
+  it('正確計算固定金額折扣', () => {
+    const result = calculateFinalTotal(1000, 'fixed', 150);
+    expect(result).toBe(850);
+  });
+
+  it('折扣金額大於消費金額時不應小於零', () => {
+    const result = calculateFinalTotal(100, 'fixed', 200);
+    expect(result).toBe(0);
+  });
+});
+`;
