import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Request } from 'express';
import type { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/app-config-token';
import { safeEqual, hashSecret } from '../common/secrets';
import { Merchant } from '../database/entities';

export type MerchantRequest = Request & { merchant: Merchant };

@Injectable()
export class MerchantAuthGuard implements CanActivate {
  constructor(
    @InjectRepository(Merchant)
    private readonly merchants: Repository<Merchant>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<MerchantRequest>();
    const header = request.header('authorization') ?? '';
    const match = /^Bearer\s+(\S+)$/.exec(header);
    if (!match) throw new UnauthorizedException('missing bearer API key');
    const merchant = await this.merchants.findOne({
      where: { apiKeyHash: hashSecret(match[1]) },
    });
    if (!merchant) throw new UnauthorizedException('invalid API key');
    request.merchant = merchant;
    return true;
  }
}

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const presented = request.header('x-admin-token') ?? '';
    if (
      !this.config.adminToken ||
      !safeEqual(presented, this.config.adminToken)
    ) {
      throw new UnauthorizedException('admin token rejected');
    }
    return true;
  }
}
