import { Body, Controller, Get, Param, ParseEnumPipe, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { OrganizationSettingKind } from '@codeer/contracts';
import { requestContext } from '../security/request-context.middleware.js';
import { SettingsService } from './settings.service.js';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get(':kind')
  get(
    @Req() request: Request,
    @Param('kind', new ParseEnumPipe(OrganizationSettingKind)) kind: OrganizationSettingKind,
  ) {
    return this.settings.get(requestContext(request), kind);
  }

  @Post(':kind')
  save(
    @Req() request: Request,
    @Param('kind', new ParseEnumPipe(OrganizationSettingKind)) kind: OrganizationSettingKind,
    @Body() input: unknown,
  ) {
    return this.settings.save(requestContext(request), kind, input);
  }
}
