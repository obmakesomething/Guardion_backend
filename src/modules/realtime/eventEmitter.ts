import { EventEmitter } from 'events';
import { Case, TechLocationPing } from '../../types';

export enum CaseEventType {
  STATUS_CHANGED = 'case.status',
  ASSIGNED = 'case.assigned',
  EVIDENCE_ADDED = 'evidence.added',
  OTP_REQUESTED = 'otp.requested',
  OTP_VERIFIED = 'otp.verified',
  ACCRUAL_CREATED = 'accrual.created',
}

export enum TechEventType {
  LOCATION_UPDATE = 'tech.location',
  ASSIGNMENT = 'tech.assignment',
}

export interface CaseStatusEvent {
  case: Case;
  previous_status: string | null;
  new_status: string;
}

export interface CaseAssignedEvent {
  case_id: string;
  tech_id: string;
  org_id: string;
}

export interface TechLocationEvent {
  case_id: string;
  tech_id: string;
  lat: number;
  lng: number;
  eta_seconds: number | null;
}

export interface EvidenceAddedEvent {
  case_id: string;
  evidence_id: string;
  type: string;
  uploader_role: string;
}

export interface OtpEvent {
  case_id: string;
  expires_at?: Date;
  success?: boolean;
}

export interface AccrualCreatedEvent {
  case_id: string;
  org_id: string;
  accrual_id: string;
  amount: number;
}

class RealtimeEventEmitter extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(1000); // Allow many SSE connections
  }

  // Case events
  emitCaseEvent(caseId: string, eventType: CaseEventType, data: unknown): void {
    this.emit(`case:${caseId}`, { event: eventType, data, ts: new Date() });
  }

  // Org events (for callcenter queue)
  emitOrgEvent(orgId: string, eventType: string, data: unknown): void {
    this.emit(`org:${orgId}`, { event: eventType, data, ts: new Date() });
  }

  // Tech events (for tech app)
  emitTechEvent(techId: string, eventType: TechEventType | string, data: unknown): void {
    this.emit(`tech:${techId}`, { event: eventType, data, ts: new Date() });
  }

  // Broadcast tech location to case subscribers
  emitTechLocation(caseId: string, ping: TechLocationPing, etaSeconds: number | null): void {
    const event: TechLocationEvent = {
      case_id: caseId,
      tech_id: ping.tech_id,
      lat: ping.lat,
      lng: ping.lng,
      eta_seconds: etaSeconds,
    };
    this.emitCaseEvent(caseId, CaseEventType.STATUS_CHANGED, {
      event: TechEventType.LOCATION_UPDATE,
      ...event,
    });
  }

  // Subscribe to case events
  subscribeToCaseEvents(caseId: string, callback: (data: unknown) => void): () => void {
    const handler = (data: unknown) => callback(data);
    this.on(`case:${caseId}`, handler);
    return () => this.off(`case:${caseId}`, handler);
  }

  // Subscribe to org events
  subscribeToOrgEvents(orgId: string, callback: (data: unknown) => void): () => void {
    const handler = (data: unknown) => callback(data);
    this.on(`org:${orgId}`, handler);
    return () => this.off(`org:${orgId}`, handler);
  }

  // Subscribe to tech events
  subscribeToTechEvents(techId: string, callback: (data: unknown) => void): () => void {
    const handler = (data: unknown) => callback(data);
    this.on(`tech:${techId}`, handler);
    return () => this.off(`tech:${techId}`, handler);
  }
}

// Singleton instance
export const eventEmitter = new RealtimeEventEmitter();
