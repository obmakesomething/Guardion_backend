/**
 * Assess Situation Result Widget
 * Displays the result of situation assessment
 */
import { SHARED_STYLES } from './shared-styles.js';

export interface AssessResultData {
  situationType: string;
  situationLabel: string;
  urgency: string;
  urgencyLabel: string;
  isOwner: boolean;
  canVerifyIdentity: boolean;
  allowDamage: boolean;
  needsWarning: boolean;
  warningMessage?: string;
}

export function createAssessResultWidget(): string {
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
      <span class="widget-icon">📋</span>
      <span class="widget-title">상황 평가</span>
    </div>

    <div id="warning-box" class="tip-box warning" style="display: none;">
      <div class="tip-title">⚠️ 주의사항</div>
      <div class="tip-text" id="warning-text"></div>
    </div>

    <div class="info-row">
      <span class="info-label">상황</span>
      <span class="info-value" id="situation-label">-</span>
    </div>

    <div class="info-row">
      <span class="info-label">긴급도</span>
      <span class="info-value" id="urgency-label">-</span>
    </div>

    <div class="info-row">
      <span class="info-label">본인 확인</span>
      <span id="identity-badge" class="badge">-</span>
    </div>

    <div class="info-row">
      <span class="info-label">파손 허용</span>
      <span class="info-value" id="damage-label">-</span>
    </div>

    <div class="widget-divider"></div>

    <div class="tip-box">
      <div class="tip-title">💡 다음 단계</div>
      <div class="tip-text">도어락 종류를 알려주시거나 사진을 보내주세요. 예상 비용과 작업 시간을 안내해드립니다.</div>
    </div>

    <div class="disclaimer">
      본 서비스는 정보 제공 목적이며, 업체 연결/예약/배차/결제를 하지 않습니다.
    </div>
  </div>

  <script>
    (function() {
      const data = window.openai?.toolOutput?.structuredContent;
      if (!data) return;

      // Situation label
      const situationEl = document.getElementById('situation-label');
      if (situationEl && data.situationLabel) {
        situationEl.textContent = data.situationLabel;
      }

      // Urgency label with color
      const urgencyEl = document.getElementById('urgency-label');
      if (urgencyEl && data.urgencyLabel) {
        urgencyEl.textContent = data.urgencyLabel;
        if (data.urgency === 'now') {
          urgencyEl.classList.add('danger');
        } else if (data.urgency === 'today') {
          urgencyEl.classList.add('warning');
        }
      }

      // Identity badge
      const identityEl = document.getElementById('identity-badge');
      if (identityEl) {
        if (data.canVerifyIdentity) {
          identityEl.textContent = '✓ 확인 가능';
          identityEl.classList.add('badge-success');
        } else {
          identityEl.textContent = '서류 준비 필요';
          identityEl.classList.add('badge-warning');
        }
      }

      // Damage preference
      const damageEl = document.getElementById('damage-label');
      if (damageEl) {
        damageEl.textContent = data.allowDamage ? '허용' : '무파괴 희망';
      }

      // Warning box
      if (data.needsWarning && data.warningMessage) {
        const warningBox = document.getElementById('warning-box');
        const warningText = document.getElementById('warning-text');
        if (warningBox && warningText) {
          warningText.textContent = data.warningMessage;
          warningBox.style.display = 'block';
        }
      }
    })();
  </script>
</body>
</html>
  `.trim();
}
