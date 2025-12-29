/**
 * Recommendation Widget
 * Displays final guidance based on situation analysis
 */
import { SHARED_STYLES } from './shared-styles.js';

export interface RecommendationData {
  level: 'diy' | 'technician' | 'emergency';
  levelLabel: string;
  summary: string;
  tips: string[];
  costRange?: {
    min: number;
    max: number;
  };
  infoLinks: {
    faq: string;
    guide: string;
    pricing: string;
  };
}

export function createRecommendationWidget(): string {
  return `
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${SHARED_STYLES}
    .level-header {
      display: flex;
      align-items: center;
      gap: var(--spacing-md);
      padding: var(--spacing-md);
      border-radius: var(--radius-md);
      margin-bottom: var(--spacing-lg);
    }

    .level-header.diy {
      background: #dcfce7;
    }

    .level-header.technician {
      background: #e0f2fe;
    }

    .level-header.emergency {
      background: #fee2e2;
    }

    .level-icon {
      font-size: 32px;
    }

    .level-info {
      flex: 1;
    }

    .level-title {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 2px;
    }

    .level-header.diy .level-title { color: #166534; }
    .level-header.technician .level-title { color: #0369a1; }
    .level-header.emergency .level-title { color: #991b1b; }

    .level-desc {
      font-size: 13px;
      color: var(--color-text-secondary);
    }

    .tips-list {
      list-style: none;
      padding: 0;
    }

    .tips-list li {
      display: flex;
      align-items: flex-start;
      gap: var(--spacing-sm);
      padding: var(--spacing-sm) 0;
      font-size: 13px;
      color: var(--color-text-primary);
    }

    .tips-list li::before {
      content: '•';
      color: var(--color-accent);
      font-weight: bold;
    }

    .section-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--color-text-secondary);
      margin-bottom: var(--spacing-sm);
      margin-top: var(--spacing-md);
    }
  </style>
</head>
<body>
  <div class="widget-card" id="widget">
    <div class="widget-header">
      <span class="widget-icon">💡</span>
      <span class="widget-title">상황별 안내</span>
    </div>

    <div class="level-header" id="level-header">
      <span class="level-icon" id="level-icon">-</span>
      <div class="level-info">
        <div class="level-title" id="level-title">-</div>
        <div class="level-desc" id="level-desc">-</div>
      </div>
    </div>

    <div id="cost-section" style="display: none;">
      <div class="cost-range">
        <div class="cost-label">예상 비용 범위 (시장 일반 기준)</div>
        <div class="cost-value" id="cost-value">-</div>
      </div>
    </div>

    <div class="section-title">참고 사항</div>
    <ul class="tips-list" id="tips-list">
    </ul>

    <div class="section-title">추가 정보</div>
    <div class="link-list" id="link-list">
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

      // Level header
      const levelHeader = document.getElementById('level-header');
      const levelIcon = document.getElementById('level-icon');
      const levelTitle = document.getElementById('level-title');
      const levelDesc = document.getElementById('level-desc');

      if (levelHeader && data.level) {
        levelHeader.classList.add(data.level);

        const icons = {
          diy: '🛠️',
          technician: '👨‍🔧',
          emergency: '🚨'
        };

        const titles = {
          diy: 'DIY 가능성 있음',
          technician: '전문 기사 권장',
          emergency: '긴급 출동 필요'
        };

        if (levelIcon) levelIcon.textContent = icons[data.level] || '📋';
        if (levelTitle) levelTitle.textContent = titles[data.level] || data.levelLabel || '-';
        if (levelDesc) levelDesc.textContent = data.summary || '-';
      }

      // Cost range (optional)
      if (data.costRange) {
        const costSection = document.getElementById('cost-section');
        const costValue = document.getElementById('cost-value');
        if (costSection && costValue) {
          costValue.textContent = formatPrice(data.costRange.min) + ' ~ ' + formatPrice(data.costRange.max);
          costSection.style.display = 'block';
        }
      }

      // Tips list
      const tipsList = document.getElementById('tips-list');
      if (tipsList && data.tips && Array.isArray(data.tips)) {
        tipsList.innerHTML = data.tips.map(function(tip) {
          return '<li>' + tip + '</li>';
        }).join('');
      }

      // Info links
      const linkList = document.getElementById('link-list');
      if (linkList && data.infoLinks) {
        const links = [
          { label: '자주 묻는 질문', url: data.infoLinks.faq, icon: '❓' },
          { label: '안전 가이드', url: data.infoLinks.guide, icon: '📖' },
          { label: '가격 안내', url: data.infoLinks.pricing, icon: '💰' }
        ];

        linkList.innerHTML = links.map(function(link) {
          if (!link.url) return '';
          return '<a class="link-item" href="' + link.url + '" target="_blank">' +
                 link.icon + ' ' + link.label + '</a>';
        }).join('');
      }
    })();
  </script>
</body>
</html>
  `.trim();
}
