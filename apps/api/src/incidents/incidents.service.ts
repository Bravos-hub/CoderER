import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  IncidentSeverity,
  IncidentStatus,
  RecoveryStage,
  type CreateIncidentInput,
  type Incident,
} from '@codeer/contracts';

@Injectable()
export class IncidentsService {
  private readonly incidents = new Map<string, Incident>();

  list(): Incident[] {
    return [...this.incidents.values()];
  }

  get(id: string): Incident {
    const incident = this.incidents.get(id);
    if (!incident) throw new NotFoundException(`Incident ${id} was not found`);
    return incident;
  }

  create(input: CreateIncidentInput): Incident {
    const now = new Date().toISOString();
    const incident: Incident = {
      id: randomUUID(),
      repositoryId: input.repositoryId,
      title: input.title,
      description: input.description,
      source: input.source,
      severity: input.severity ?? IncidentSeverity.SEV3,
      status: IncidentStatus.ADMITTED,
      stage: RecoveryStage.ADMIT,
      createdAt: now,
      updatedAt: now,
    };
    this.incidents.set(incident.id, incident);
    return incident;
  }
}
