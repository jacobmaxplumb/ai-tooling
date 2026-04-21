FROM node:22-alpine

WORKDIR /app

# Install deps first for better layer caching.
COPY package.json package-lock.json* ./
RUN npm install

# Then copy the rest of the project.
COPY tsconfig.json ./
COPY src ./src
COPY public ./public

ENV PORT=3000
EXPOSE 3000

CMD ["npm", "run", "server"]
