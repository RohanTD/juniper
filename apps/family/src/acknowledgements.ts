/**
 * Family-side alert acknowledgements — "I've seen this", stored in the voice
 * service's app-level store.
 *
 * NOT `Task.status`. The escalation Task (docs/CONTRACTS.md §4) is addressed to
 * the CARE TEAM: `owner` is a care-team participant and `status` records what a
 * clinician has done. A caregiver marking it `completed` would falsely tell
 * every later reader that a clinician acted — a clinical claim made by the one
 * reader least placed to make it. The caregiver AccessPolicy is read-only on
 * Task in any case, so this is enforced on both sides of the wire.
 *
 * What a caregiver legitimately needs is the ability to stop being ambushed by
 * the same alert at 11pm. That is a fact about the reader, not about the
 * patient's care, so it lives beside call windows rather than in the record.
 */
import { VoiceApiClient, type VoiceApiOptions } from './voiceApi';

export interface AlertAcknowledgement {
  /** FHIR Task id (not a reference) — the join key back to the alert. */
  taskId: string;
  /** ISO8601. */
  acknowledgedAt: string;
  /** Profile reference of the caregiver, e.g. "RelatedPerson/<id>". */
  acknowledgedBy?: string;
}

export interface AlertAcknowledgements {
  acknowledgements: AlertAcknowledgement[];
}

export type AcknowledgementsClientOptions = VoiceApiOptions;

export class AcknowledgementsClient extends VoiceApiClient {
  private url(patientId: string): string {
    return this.patientUrl(patientId, 'alert-acknowledgements');
  }

  async getAcknowledgements(patientId: string): Promise<AlertAcknowledgements> {
    return this.request<AlertAcknowledgements>(
      this.url(patientId),
      { method: 'GET' },
      'GET acknowledgements'
    );
  }

  /**
   * PUT replaces the whole set. That is what makes undo expressible — a
   * caregiver who taps acknowledge by accident must be able to put the alert
   * back in front of themselves.
   */
  async putAcknowledgements(
    patientId: string,
    value: AlertAcknowledgements
  ): Promise<AlertAcknowledgements> {
    return this.request<AlertAcknowledgements>(
      this.url(patientId),
      { method: 'PUT', body: JSON.stringify(value) },
      'PUT acknowledgements'
    );
  }
}
