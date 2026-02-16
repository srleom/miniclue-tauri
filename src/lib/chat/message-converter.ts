import type { ThreadMessageLike } from '@assistant-ui/react';
import type { Message, MessageResponse } from '@/lib/types';

/**
 * Convert backend MessageResponse to frontend Message
 * Parses JSON strings for parts and metadata
 */
export function convertMessageResponse(msg: MessageResponse): Message {
  let parts: Message['parts'] = [];
  let metadata: Message['metadata'] = {};

  try {
    const parsedParts = JSON.parse(msg.parts);
    if (Array.isArray(parsedParts)) {
      parts = parsedParts as Message['parts'];
    }
  } catch (e) {
    console.error('Failed to parse message parts:', e);
  }

  try {
    const parsedMetadata = JSON.parse(msg.metadata);
    if (parsedMetadata && typeof parsedMetadata === 'object') {
      metadata = parsedMetadata as Message['metadata'];
    }
  } catch (e) {
    console.error('Failed to parse message metadata:', e);
  }

  return {
    id: msg.id,
    chat_id: msg.chat_id,
    role: msg.role as 'user' | 'assistant',
    parts,
    metadata,
    created_at: msg.created_at,
  };
}

/**
 * Convert frontend Message to assistant-ui ThreadMessageLike
 */
export function convertToThreadMessage(msg: Message): ThreadMessageLike {
  // Build content array from message parts
  const content: ThreadMessageLike['content'] = msg.parts.map((part) => {
    if (part.type === 'text') {
      return {
        type: 'text' as const,
        text: part.text || '',
      };
    }
    // Handle other part types if needed (tool calls, etc.)
    return {
      type: 'text' as const,
      text: JSON.stringify(part),
    };
  });

  return {
    id: msg.id,
    role: msg.role,
    content,
    createdAt: new Date(msg.created_at),
    metadata: msg.metadata,
  };
}

/**
 * Convert array of MessageResponse to array of ThreadMessageLike
 */
export function convertMessagesToThreadMessages(
  messages: MessageResponse[]
): ThreadMessageLike[] {
  return messages.map(convertMessageResponse).map(convertToThreadMessage);
}

/**
 * Create a user message in ThreadMessageLike format
 */
export function createUserMessage(text: string): ThreadMessageLike {
  return {
    id: `temp-user-${Date.now()}`,
    role: 'user',
    content: [{ type: 'text', text }],
    createdAt: new Date(),
  };
}

/**
 * Create an optimistic assistant message for streaming
 */
export function createOptimisticAssistantMessage(): ThreadMessageLike {
  return {
    id: `temp-assistant-${Date.now()}`,
    role: 'assistant',
    content: [{ type: 'text', text: '' }],
    createdAt: new Date(),
  };
}

/**
 * Update streaming message content
 */
export function updateStreamingMessage(
  message: ThreadMessageLike,
  newContent: string
): ThreadMessageLike {
  return {
    ...message,
    content: [
      {
        type: 'text',
        text: newContent,
      },
    ],
  };
}
