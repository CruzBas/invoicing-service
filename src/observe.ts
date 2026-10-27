import { DynamicModule } from '@nestjs/common';

// @nestjs/observe is ESM-only; a static import compiles to require(), which
// the Vercel runtime rejects with ERR_REQUIRE_ESM.
export async function loadObserve() {
  const { createObserveModule } = await import('@nestjs/observe');
  const { ObserveModule, ObserveInstrument } = createObserveModule();
  const observeModule: DynamicModule = ObserveModule.forRoot({
    appKey: process.env.OBSERVE_APP_KEY,
    appSecret: process.env.OBSERVE_APP_SECRET,
    serviceId: 'invoicing-service',
  });
  return { observeModule, ObserveInstrument };
}
