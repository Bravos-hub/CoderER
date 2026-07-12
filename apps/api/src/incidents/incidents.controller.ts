import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CreateIncidentSchema, type CreateIncidentInput } from '@codeer/contracts';
import { IncidentsService } from './incidents.service.js';

@Controller('incidents')
export class IncidentsController {
  constructor(private readonly incidentsService: IncidentsService) {}

  @Get()
  list() {
    return this.incidentsService.list();
  }

  @Get(':id')
  get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.incidentsService.get(id);
  }

  @Post()
  create(@Body() input: CreateIncidentInput) {
    return this.incidentsService.create(CreateIncidentSchema.parse(input));
  }
}
