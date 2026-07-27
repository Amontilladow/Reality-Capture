import { registerAs } from '@nestjs/config';
export default registerAs('app', () => ({
  port: parseInt(process.env.PORT ?? '3100', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
}));
