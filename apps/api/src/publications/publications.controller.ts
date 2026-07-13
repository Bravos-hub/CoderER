import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { requestContext } from '../security/request-context.middleware.js';
import { PublicationsService } from './publications.service.js';

@Controller('publications')
export class PublicationsController {
  constructor(private readonly publications: PublicationsService) {}

  @Get(':publicationId')
  get(
    @Req() request: Request,
    @Param('publicationId', new ParseUUIDPipe({ version: '4' })) publicationId: string,
  ) {
    return this.publications.get(requestContext(request), publicationId);
  }

  @Get(':publicationId/events')
  events(
    @Req() request: Request,
    @Param('publicationId', new ParseUUIDPipe({ version: '4' })) publicationId: string,
  ) {
    return this.publications.events(requestContext(request), publicationId);
  }

  @Get(':publicationId/checks')
  checks(
    @Req() request: Request,
    @Param('publicationId', new ParseUUIDPipe({ version: '4' })) publicationId: string,
  ) {
    return this.publications.checks(requestContext(request), publicationId);
  }

  @Get(':publicationId/reviews')
  reviews(
    @Req() request: Request,
    @Param('publicationId', new ParseUUIDPipe({ version: '4' })) publicationId: string,
  ) {
    return this.publications.reviews(requestContext(request), publicationId);
  }

  @Post(':publicationId/cancel')
  cancel(
    @Req() request: Request,
    @Param('publicationId', new ParseUUIDPipe({ version: '4' })) publicationId: string,
    @Body() input: unknown,
  ) {
    return this.publications.cancel(requestContext(request), publicationId, input);
  }

  @Post(':publicationId/retry')
  retry(
    @Req() request: Request,
    @Param('publicationId', new ParseUUIDPipe({ version: '4' })) publicationId: string,
    @Body() input: unknown,
  ) {
    return this.publications.retry(requestContext(request), publicationId, input);
  }

  @Post(':publicationId/mark-ready')
  markReady(
    @Req() request: Request,
    @Param('publicationId', new ParseUUIDPipe({ version: '4' })) publicationId: string,
    @Body() input: unknown,
  ) {
    return this.publications.markReady(requestContext(request), publicationId, input);
  }
}
