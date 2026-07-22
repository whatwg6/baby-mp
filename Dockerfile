# syntax=docker/dockerfile:1.7

FROM node:22.12.0-alpine AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install --global pnpm@10.33.4

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @baby-mp/contracts build
RUN pnpm --filter @baby-mp/api prisma:generate
RUN pnpm --filter @baby-mp/api build
RUN find apps/api/dist packages/contracts/dist -type f \( -name '*.map' -o -name '*.d.ts' \) -delete
RUN pnpm --filter @baby-mp/api deploy --legacy --prod /runtime

FROM node:22.12.0-alpine AS runtime

ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install --global pnpm@10.33.4

WORKDIR /app
COPY --from=build --chown=node:node /runtime ./

USER node
EXPOSE 3000
ENTRYPOINT ["node", "dist/config/runtime-preflight.js"]
CMD ["node", "dist/main.js"]
