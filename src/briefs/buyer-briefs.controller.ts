import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  JwtAuthGuard,
  type AuthenticatedRequest,
} from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { BriefsService } from './briefs.service';
import { CreateBriefDto } from './dto/create-brief.dto';
import { ModerateBriefDto } from './dto/moderate-brief.dto';
import { BUYER_CATEGORIES } from './taxonomy';

@ApiTags('Buyer briefs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Roles('buyer', 'admin')
@Controller('buyer/briefs')
export class BuyerBriefsController {
  constructor(private readonly briefs: BriefsService) {}
  @Get()
  @ApiOperation({
    summary: 'List own buyer briefs; admins can review all briefs',
  })
  @ApiResponse({
    status: 200,
    description: 'Briefs returned without contributor data',
  })
  list(@Req() request: AuthenticatedRequest) {
    return this.briefs.listForAccount(request.user.sub);
  }

  @Get('categories')
  @ApiOperation({ summary: 'Buyer category taxonomy' })
  @ApiResponse({ status: 200, description: 'Categories returned' })
  categories() {
    return BUYER_CATEGORIES;
  }

  @Post()
  @Roles('buyer')
  @ApiOperation({
    summary: 'Create an owned draft brief from a form or JSON upload',
  })
  @ApiResponse({
    status: 201,
    description: 'Draft brief created; escrow is required before activation',
  })
  create(@Req() request: AuthenticatedRequest, @Body() dto: CreateBriefDto) {
    return this.briefs.createForAccount(request.user.sub, dto);
  }

  @Post(':briefRef/moderate')
  @Roles('admin')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Moderator activates funded briefs or pauses briefs',
  })
  @ApiResponse({ status: 200, description: 'Moderation applied' })
  moderate(
    @Req() request: AuthenticatedRequest,
    @Param('briefRef') briefRef: string,
    @Body() dto: ModerateBriefDto,
  ) {
    return this.briefs.moderateForAccount(
      request.user.sub,
      briefRef,
      dto.status,
    );
  }
}
