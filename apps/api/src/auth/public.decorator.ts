import { SetMetadata } from '@nestjs/common';

/** Endpoint'i auth guard'tan muaf tutar */
export const Public = () => SetMetadata('isPublic', true);
