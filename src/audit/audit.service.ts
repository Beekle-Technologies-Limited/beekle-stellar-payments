import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AuditEvent } from '../database/entities';

@Injectable()
export class AuditService {
  async record(
    manager: EntityManager,
    input: {
      actorType: 'system' | 'merchant' | 'operator';
      actorId: string | null;
      action: string;
      entityType: string;
      entityId: string;
      fromStatus?: string | null;
      toStatus?: string | null;
      metadata?: unknown;
    },
  ): Promise<void> {
    await manager.insert(AuditEvent, {
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus ?? null,
      metadataJson: input.metadata ?? {},
    });
  }
}
