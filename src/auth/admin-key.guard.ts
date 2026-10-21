import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AppConfigService } from '../config/app-config.service';
import { safeEqual } from './api-key';

/** Administration routes use their own key, separate from the consumers'. */
@Injectable()
export class AdminKeyGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const key = context
      .switchToHttp()
      .getRequest<Request>()
      .header('x-admin-key');
    if (!key || !safeEqual(key, this.config.get('ADMIN_API_KEY'))) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
