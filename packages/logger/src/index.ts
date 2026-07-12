import pino from 'pino';

const options = {
  name: 'codeer',
  level: process.env.LOG_LEVEL ?? 'info',
  redact: ['req.headers.authorization', '*.token', '*.secret', '*.password', '*.privateKey'],
};

export const logger =
  process.env.NODE_ENV === 'production'
    ? pino(options)
    : pino(
        options,
        pino.transport({
          target: 'pino-pretty',
          options: { colorize: true, singleLine: true },
        }),
      );
