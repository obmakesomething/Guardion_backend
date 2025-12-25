# klygo - 긴급 개문 서비스

ChatGPT Apps SDK를 활용한 지능형 긴급 개문 서비스 플랫폼입니다.

## 개요

klygo는 ChatGPT 내에서 사용자의 긴급 개문 상황을 인지하고, AI 시각 분석을 통해 도어락 모델을 판독하며, 서울 전역의 숙련된 기사님(Affiliate)을 지능적으로 매칭하는 서비스입니다.

## 주요 기능

### 🔐 MCP Tools (ChatGPT 연동)
| 도구명 | 설명 |
|--------|------|
| `analyze_lock_status` | 도어락 사진/설명 분석, 예상 잔금 범위 안내 |
| `pay_callout_deposit` | 출장비 35,000원 결제창 생성 |
| `request_smart_match` | 단계별 확장 매칭 (구 → 인접 구 → 서울 전역) |
| `pay_final_balance` | 기사님 입력 잔금 결제창 생성 |
| `approve_surcharge` | 광역 매칭 할증(+5,000원) 승인 |

### 💰 수익 구조
- **출장비 (선결제)**: ₩35,000
  - 플랫폼 수익: ₩5,000
  - 기사님 배정금: ₩30,000
- **잔금 (후결제)**: 현장 난이도에 따라 기사님 입력
  - 플랫폼 수수료: 10%

### 🎯 지능형 매칭 엔진
1. **1단계 (내 지역)**: 해당 구 기사님 20명에게 발송 (2분 대기)
2. **2단계 (광역)**: 인접 구 확장 + 할증 승인 요청 (3분 대기)
3. **3단계 (서울 전역)**: 서울 전역 평점순 배치 발송

### 📱 알림 시스템
- 카카오 알림톡 (Solapi API)
- 20명씩 배치 발송으로 비용 최적화
- ARS 자동 전화 백업 (옵션)

## 기술 스택

- **Language**: TypeScript
- **Runtime**: Node.js 18+
- **Framework**: MCP SDK (Model Context Protocol)
- **Database**: PostgreSQL + PostGIS
- **Payment**: Toss Payments
- **Messaging**: Solapi (카카오 알림톡)

## 프로젝트 구조

```
src/
├── config/              # 환경 설정
├── db/                  # 데이터베이스 스키마, 커넥션
├── modules/
│   ├── lock-analysis/   # 도어락 분석
│   ├── matching/        # 매칭 엔진
│   ├── payment/         # 토스 결제 연동
│   ├── quote/           # 견적 계산
│   └── solapi/          # 카카오 알림톡
├── types/               # 타입 정의
└── server.ts            # MCP 서버 진입점

public/
├── index.html           # 랜딩 페이지
├── widget.html          # ChatGPT 위젯
├── tech.html            # 기사님 전용 페이지
└── payment/
    ├── success.html     # 결제 성공
    └── fail.html        # 결제 실패
```

## 설치 및 실행

### 1. 의존성 설치
```bash
npm install
```

### 2. 환경 변수 설정
```bash
cp .env.example .env
# .env 파일 편집
```

### 3. 데이터베이스 설정
```bash
# PostgreSQL 데이터베이스 생성
createdb klygo

# 스키마 적용
npm run db:migrate
```

### 4. 개발 서버 실행
```bash
npm run dev
```

### 5. 프로덕션 빌드
```bash
npm run build
npm start
```

## ChatGPT 앱 등록

1. ChatGPT 설정 → Apps & Connectors → Advanced settings에서 개발자 모드 활성화
2. Settings → Connectors에서 Create 클릭
3. MCP 서버 URL 입력: `https://your-domain.com/mcp`
4. 커넥터 이름과 설명 입력 후 Create

## MCP Inspector로 테스트

```bash
npx @modelcontextprotocol/inspector@latest http://localhost:8787/mcp
```

## 환경 변수

| 변수명 | 설명 | 기본값 |
|--------|------|--------|
| `PORT` | 서버 포트 | 8787 |
| `DATABASE_URL` | PostgreSQL 연결 문자열 | - |
| `SOLAPI_API_KEY` | Solapi API 키 | - |
| `SOLAPI_API_SECRET` | Solapi API 시크릿 | - |
| `TOSS_CLIENT_KEY` | 토스 클라이언트 키 | - |
| `TOSS_SECRET_KEY` | 토스 시크릿 키 | - |
| `CALLOUT_FEE` | 출장비 | 35000 |
| `WIDE_AREA_SURCHARGE` | 광역 할증 | 5000 |

## 서비스 지역

현재 서비스 중:
- 성동구
- 관악구

확장 예정: 서울 전역 25개 구

## API 엔드포인트

| 엔드포인트 | 설명 |
|------------|------|
| `GET /` | 서비스 상태 확인 |
| `GET /health` | 헬스 체크 |
| `POST /mcp` | MCP 프로토콜 엔드포인트 |

## 라이선스

Private - All Rights Reserved

## 연락처

- 이메일: support@klygo.online
- 기사님 문의: tech@klygo.online
