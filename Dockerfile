# syntax=docker/dockerfile:1

# ---- build: full deps + compile ----
FROM node:24-alpine AS build
ENV HUSKY=0
WORKDIR /app
RUN corepack enable
# install deps first (postinstall runs `prisma generate`, so the schema must be present)
COPY package.json yarn.lock ./
COPY prisma ./prisma
RUN yarn install --frozen-lockfile
COPY . .
RUN yarn build

# ---- runner: slim production image ----
FROM node:24-alpine AS runner
ENV NODE_ENV=production
ENV HUSKY=0
ENV PORT=3000
WORKDIR /app
RUN corepack enable
# prod-only deps; skip scripts (prisma CLI is a devDep and absent here)
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production --ignore-scripts && yarn cache clean
# bring over the generated Prisma client and the compiled app
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist
COPY prisma ./prisma
USER node
EXPOSE ${PORT}
CMD ["node", "dist/main.js"]
