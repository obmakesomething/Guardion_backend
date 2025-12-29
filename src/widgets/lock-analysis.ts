/**
 * Lock Analysis Result Widget
 * Displays lock type analysis with difficulty and cost range
 */
import { SHARED_STYLES } from './shared-styles.js';

export interface LockAnalysisData {
  lockType: string;
  lockTypeLabel: string;
  brand: string | null;
  difficulty: string;
  difficultyLabel: string;
  difficultyLevel: number; // 1-4
  estimatedTime: number;
  costMin: number;
  costMax: number;
  calloutFee: number;
}

export function createLockAnalysisWidget(): string {
  return `
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${SHARED_STYLES}</style>
</head>
<body>
  <div class="widget-card" id="widget">
    <div class="widget-header">
      <span class="widget-icon">🔐</span>
      <span class="widget-title">도어락 분석</span>
    </div>

    <div class="info-row">
      <span class="info-label">종류</span>
      <span class="info-value" id="lock-type">-</span>
    </div>

    <div class="info-row" id="brand-row" style="display: none;">
      <span class="info-label">브랜드</span>
      <span class="info-value" id="brand">-</span>
    </div>

    <div class="info-row">
      <span class="info-label">난이도</span>
      <div>
        <span class="info-value" id="difficulty">-</span>
        <div class="difficulty-meter" id="difficulty-meter">
          <div class="difficulty-bar"></div>
          <div class="difficulty-bar"></div>
          <div class="difficulty-bar"></div>
          <div class="difficulty-bar"></div>
        </div>
      </div>
    </div>

    <div class="info-row">
      <span class="info-label">예상 작업 시간</span>
      <span class="info-value" id="time">-</span>
    </div>

    <div class="widget-divider"></div>

    <div class="cost-range">
      <div class="cost-label">예상 비용 범위 (참고용)</div>
      <div class="cost-value" id="cost-range">-</div>
      <div class="cost-note" id="cost-breakdown"></div>
    </div>

    <div class="tip-box warning">
      <div class="tip-title">⚠️ 안내</div>
      <div class="tip-text">본 금액은 시장 일반 범위이며, 특정 업체의 견적이 아닙니다. 실제 비용은 현장 상황에 따라 달라집니다.</div>
    </div>

    <div class="disclaimer">
      본 서비스는 정보 제공 목적이며, 업체 연결/예약/배차/결제를 하지 않습니다.
    </div>
  </div>

  <script>
    (function() {
      const data = window.openai?.toolOutput?.structuredContent;
      if (!data) return;

      function formatPrice(n) {
        return n.toLocaleString('ko-KR') + '원';
      }

      // Lock type
      const lockTypeEl = document.getElementById('lock-type');
      if (lockTypeEl && data.lockTypeLabel) {
        lockTypeEl.textContent = data.lockTypeLabel;
      }

      // Brand (optional)
      if (data.brand) {
        const brandRow = document.getElementById('brand-row');
        const brandEl = document.getElementById('brand');
        if (brandRow && brandEl) {
          brandEl.textContent = data.brand;
          brandRow.style.display = 'flex';
        }
      }

      // Difficulty with meter
      const difficultyEl = document.getElementById('difficulty');
      const meterEl = document.getElementById('difficulty-meter');
      if (difficultyEl && data.difficultyLabel) {
        difficultyEl.textContent = data.difficultyLabel;

        // Update difficulty meter
        if (meterEl) {
          const bars = meterEl.querySelectorAll('.difficulty-bar');
          const level = data.difficultyLevel || 2;

          bars.forEach((bar, i) => {
            if (i < level) {
              bar.classList.add('active');
              if (level >= 4) bar.classList.add('danger');
              else if (level >= 3) bar.classList.add('warning');
            }
          });
        }
      }

      // Estimated time
      const timeEl = document.getElementById('time');
      if (timeEl && data.estimatedTime) {
        timeEl.textContent = '약 ' + data.estimatedTime + '분';
      }

      // Cost range
      const costRangeEl = document.getElementById('cost-range');
      const costBreakdownEl = document.getElementById('cost-breakdown');
      if (costRangeEl && data.costMin != null && data.costMax != null) {
        const totalMin = (data.calloutFee || 0) + data.costMin;
        const totalMax = (data.calloutFee || 0) + data.costMax;
        costRangeEl.textContent = formatPrice(totalMin) + ' ~ ' + formatPrice(totalMax);

        if (costBreakdownEl && data.calloutFee) {
          costBreakdownEl.textContent = '(출장비 ' + formatPrice(data.calloutFee) + ' + 작업비 ' + formatPrice(data.costMin) + '~' + formatPrice(data.costMax) + ')';
        }
      }
    })();
  </script>
</body>
</html>
  `.trim();
}
