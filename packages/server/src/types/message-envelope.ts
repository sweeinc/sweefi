/**
 * Shared message envelope used by both SealChat (UI rendering) and
 * SuiAgent L4 (programmatic processing). This is the on-wire format
 * for all messages in the Swee ecosystem.
 *
 * SealChat displays `content`. SuiAgent reads `payload`.
 * Both ignore fields they do not understand (forward compatibility via `version`).
 */
export interface MessageEnvelope {
  version: 1;
  type:
    | 'text'
    | 'task'
    | 'approval_request'
    | 'result'
    | 'status'
    | 'system'
    | 'coordination';
  sender: string; // Sui address (0x-prefixed)
  timestamp: number; // Unix ms
  content: string; // Human-readable (SealChat renders this)
  payload?: Record<string, unknown>; // Machine-readable (SuiAgent reads this)
  attachmentBlobId?: string; // Walrus blob reference
  replyTo?: string; // Parent message ID (threading)
  correlationId?: string; // Links request/response pairs
  ttl?: number; // Expiry in seconds
}

/** All valid message types */
export type MessageType = MessageEnvelope['type'];

/** Helper to create a well-formed envelope with defaults */
export function createMessageEnvelope(
  fields: Omit<MessageEnvelope, 'version' | 'timestamp'> & {
    timestamp?: number;
  },
): MessageEnvelope {
  return {
    version: 1,
    timestamp: Date.now(),
    ...fields,
  };
}
